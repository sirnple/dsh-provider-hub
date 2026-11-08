/**
 * Native Grok Build support: OAuth device flow, token refresh, model catalog,
 * billing and an `llm` adapter that speaks the Build Responses protocol.
 *
 * Everything here lives inside the plugin — no local gateway, no external
 * service. The only state is the OAuth token bundle stored in the harness
 * credential store under `GROK_BUILD_OAUTH`.
 *
 * @module dsh-provider-hub/grok
 */

/** Public OAuth client of the official Grok Build CLI. */
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const DEVICE_URL = 'https://auth.x.ai/oauth2/device/code'
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const SCOPE = 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write'

/** Upstream API identity, mirroring the official client. */
const BASE_URL = 'https://cli-chat-proxy.grok.com/v1'
const CLIENT_VERSION = '1.0.60'
const CLIENT_IDENTIFIER = 'grok-shell'
const TOKEN_AUTH = 'xai-grok-cli'
const USER_AGENT = `grok-shell/${CLIENT_VERSION} (linux; x86_64)`

/** Credential reference holding the OAuth bundle. */
export const GROK_REF = 'GROK_BUILD_OAUTH'
/** Provider route this adapter serves. */
export const GROK_PROVIDER = 'grok-build'
/** Assumed context window when the catalog omits one. */
const DEFAULT_CONTEXT = 500_000
const DEFAULT_MAX_TOKENS = 100_000

/** Read the stored token bundle; `undefined` when nobody signed in yet. */
export async function readGrokTokens(ctx) {
  const credentials = optionalService(ctx, 'credentials')
  if (typeof credentials?.resolve !== 'function') return undefined
  try {
    const hit = await credentials.resolve(GROK_REF)
    const raw = typeof hit?.value === 'string' ? hit.value : ''
    if (raw.length === 0) return undefined
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Persist the token bundle (write-only credential, like an API key). */
async function saveGrokTokens(ctx, tokens) {
  const credentials = optionalService(ctx, 'credentials')
  if (typeof credentials?.set !== 'function') throw new Error('the credential store is unavailable')
  await credentials.set(GROK_REF, JSON.stringify(tokens))
}

/** Drop the stored bundle. */
export async function clearGrokTokens(ctx) {
  const credentials = optionalService(ctx, 'credentials')
  if (typeof credentials?.unset === 'function') await credentials.unset(GROK_REF)
}

function optionalService(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/** Decode a JWT payload without verifying it; used only for display fields. */
function jwtClaims(token) {
  if (typeof token !== 'string') return {}
  const part = token.split('.')[1]
  if (part === undefined) return {}
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function postForm(url, form, extraHeaders = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...extraHeaders },
    body: new URLSearchParams(form).toString(),
  })
  const text = await response.text()
  let body
  try {
    body = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }
  return { ok: response.ok, status: response.status, body, text }
}

/** Start the device flow: the page shows `userCode` and `verificationUri`. */
export async function startGrokDevice() {
  const answer = await postForm(DEVICE_URL, { client_id: CLIENT_ID, scope: SCOPE, referrer: 'grok-build' }, {
    'x-grok-client-version': CLIENT_VERSION,
    'x-grok-client-surface': 'ui',
  })
  if (!answer.ok) {
    const detail = answer.body !== null && typeof answer.body === 'object' && typeof answer.body.error === 'string'
      ? answer.body.error
      : `device endpoint answered ${answer.status}`
    throw new Error(detail)
  }
  const body = answer.body ?? {}
  if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string') {
    throw new Error('the device endpoint did not return a usable code')
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: typeof body.verification_uri === 'string' ? body.verification_uri : 'https://x.ai/device',
    verificationUriComplete: typeof body.verification_uri_complete === 'string' ? body.verification_uri_complete : undefined,
    intervalMs: Math.max(2, Number(body.interval) || 5) * 1000,
    expiresInMs: Math.max(60, Number(body.expires_in) || 1800) * 1000,
  }
}

/** Store a token payload, keeping the identity claims for the UI. */
async function storeTokenPayload(ctx, payload, previous) {
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : ''
  if (accessToken.length === 0) throw new Error('the token endpoint returned no access_token')
  const claims = jwtClaims(accessToken)
  const tokens = {
    accessToken,
    refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token.length > 0
      ? payload.refresh_token
      : previous?.refreshToken,
    expiresAt: Date.now() + (Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600) * 1000,
    email: typeof claims.email === 'string' ? claims.email : previous?.email,
    userId: typeof claims.sub === 'string' ? claims.sub : previous?.userId,
    tier: typeof claims.tier === 'string' || typeof claims.tier === 'number' ? String(claims.tier) : previous?.tier,
    clientId: CLIENT_ID,
  }
  await saveGrokTokens(ctx, tokens)
  return tokens
}

/**
 * Poll the device endpoint once. Returns `{ status: 'pending' }` while the user
 * has not finished, `{ status: 'ok', tokens }` on success.
 */
export async function pollGrokDevice(ctx, deviceCode) {
  const answer = await postForm(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: CLIENT_ID,
    device_code: deviceCode,
  }, { 'x-grok-client-version': CLIENT_VERSION, 'x-grok-client-surface': 'ui' })
  if (answer.ok) return { status: 'ok', tokens: await storeTokenPayload(ctx, answer.body, await readGrokTokens(ctx)) }
  const code = answer.body !== null && typeof answer.body === 'object' && typeof answer.body.error === 'string'
    ? answer.body.error
    : ''
  if (code === 'authorization_pending') return { status: 'pending' }
  if (code === 'slow_down') return { status: 'pending', slowDown: true }
  if (code === 'access_denied' || code === 'expired_token') {
    return { status: 'denied', message: code }
  }
  const message = answer.body !== null && typeof answer.body === 'object' && typeof answer.body.error_description === 'string'
    ? answer.body.error_description
    : `token endpoint answered ${answer.status}`
  return { status: 'failed', message }
}

/** Refresh the access token when it is close to expiry. */
export async function ensureGrokTokens(ctx) {
  const tokens = await readGrokTokens(ctx)
  if (tokens === undefined) return undefined
  const fresh = typeof tokens.expiresAt === 'number' && tokens.expiresAt - Date.now() > 60_000
  if (fresh) return tokens
  if (typeof tokens.refreshToken !== 'string' || tokens.refreshToken.length === 0) return tokens
  const answer = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: tokens.clientId ?? CLIENT_ID,
    refresh_token: tokens.refreshToken,
  }, { 'x-grok-client-version': CLIENT_VERSION, 'x-grok-client-surface': 'ui' })
  if (!answer.ok) return tokens
  return await storeTokenPayload(ctx, answer.body, tokens)
}

/** The upstream headers every Build request carries. */
function grokHeaders(tokens) {
  return {
    authorization: `Bearer ${tokens.accessToken}`,
    'x-xai-token-auth': TOKEN_AUTH,
    'x-grok-client-version': CLIENT_VERSION,
    'x-grok-client-identifier': CLIENT_IDENTIFIER,
    'x-grok-client-mode': 'headless',
    accept: 'application/json',
    'user-agent': USER_AGENT,
    ...typeof tokens.userId === 'string' && tokens.userId.length > 0 ? { 'x-userid': tokens.userId } : {},
    ...typeof tokens.email === 'string' && tokens.email.length > 0 ? { 'x-email': tokens.email } : {},
  }
}

async function grokJson(ctx, path, init = {}) {
  const tokens = await ensureGrokTokens(ctx)
  if (tokens === undefined) throw new Error('Grok Build is not signed in')
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...grokHeaders(tokens), ...init.headers } })
  const text = await response.text()
  let body
  try {
    body = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }
  return { ok: response.ok, status: response.status, body, text }
}

/** Model ids the signed-in account can use. */
export async function listGrokModels(ctx) {
  const answer = await grokJson(ctx, '/models')
  if (!answer.ok) throw new Error(`models endpoint answered ${answer.status}`)
  const data = Array.isArray(answer.body?.data) ? answer.body.data : []
  const models = []
  const seen = new Set()
  for (const entry of data) {
    const id = typeof entry?.id === 'string' ? entry.id : typeof entry?.model === 'string' ? entry.model : ''
    if (id.length === 0 || entry?.hidden === true || entry?._meta?.hidden === true || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      contextWindow: Number(entry?.context_window ?? entry?.contextWindow) || DEFAULT_CONTEXT,
      maxTokens: Number(entry?.max_completion_tokens ?? entry?.maxCompletionTokens) || DEFAULT_MAX_TOKENS,
    })
  }
  return models
}

/** Read a numeric field that may be a bare number or `{ val }`. */
function creditNumber(value) {
  if (typeof value === 'number') return value
  if (value !== null && typeof value === 'object' && typeof value.val === 'number') return value.val
  if (typeof value === 'string') return Number(value) || 0
  return 0
}

/**
 * Shape one `/billing` answer. The Build control plane reports a percentage over a
 * rolling period (`creditUsagePercent` + `currentPeriod`), per-product shares in
 * `productUsage`, and no dollar limit, so the meter is a period window rather than
 * a monthly budget.
 */
export function shapeGrokBilling(payload, tier) {
  const root = payload?.config !== null && typeof payload?.config === 'object' ? payload.config : payload ?? {}
  const period = root.currentPeriod !== null && typeof root.currentPeriod === 'object' ? root.currentPeriod : {}
  const type = typeof period.type === 'string' ? period.type : ''
  const periodKind = /WEEK/i.test(type) ? 'weekly' : /DAY|HOUR/i.test(type) ? 'fiveHour' : 'monthly'
  const products = Array.isArray(root.productUsage)
    ? root.productUsage
        .filter((entry) => entry !== null && typeof entry?.product === 'string' && typeof entry?.usagePercent === 'number')
        .map((entry) => ({ name: entry.product, percent: entry.usagePercent }))
    : []
  return {
    plan: typeof root.planName === 'string' ? root.planName : typeof tier === 'string' ? tier : undefined,
    percent: creditNumber(root.creditUsagePercent ?? root.credit_usage_percent),
    periodKind,
    periodStart: typeof period.start === 'string' ? period.start : typeof root.billingPeriodStart === 'string' ? root.billingPeriodStart : undefined,
    periodEnd: typeof period.end === 'string' ? period.end : typeof root.billingPeriodEnd === 'string' ? root.billingPeriodEnd : undefined,
    prepaid: creditNumber(root.prepaidBalance),
    onDemandCap: creditNumber(root.onDemandCap),
    onDemandUsed: creditNumber(root.onDemandUsed),
    products,
  }
}

/** Subscription tier, which names the plan in the panel. */
async function grokSubscriptionTier(headers) {
  try {
    const response = await fetch(`${BASE_URL}/user?include=subscription`, { headers })
    if (!response.ok) return undefined
    const body = await response.json()
    return typeof body?.subscriptionTier === 'string' ? body.subscriptionTier : undefined
  } catch {
    return undefined
  }
}

/** Billing snapshot from the Build control plane (plan + rolling quota). */
export async function grokBilling(ctx) {
  const tokens = await ensureGrokTokens(ctx)
  if (tokens === undefined) throw new Error('Grok Build is not signed in')
  const headers = grokHeaders(tokens)
  const answer = await grokJson(ctx, '/billing?format=credits')
  if (!answer.ok) throw new Error(`billing endpoint answered ${answer.status}`)
  return shapeGrokBilling(answer.body, await grokSubscriptionTier(headers))
}

/** Map one harness message onto Responses API input items. */
function toResponsesInput(messages, system) {
  const items = []
  if (typeof system === 'string' && system.length > 0) {
    items.push({ type: 'message', role: 'system', content: [{ type: 'input_text', text: system }] })
  }
  for (const message of Array.isArray(messages) ? messages : []) {
    const blocks = Array.isArray(message?.content) ? message.content : []
    if (message?.role === 'tool') {
      const output = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
      items.push({ type: 'function_call_output', call_id: String(message.toolCallId ?? message.source?.callId ?? ''), output })
      continue
    }
    if (message?.role === 'assistant') {
      for (const block of blocks) {
        if (block?.type === 'text' && block.text.length > 0) {
          items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text }] })
        } else if (block?.type === 'tool-call') {
          items.push({ type: 'function_call', call_id: String(block.id), name: block.name, arguments: block.arguments ?? '{}' })
        }
      }
      continue
    }
    const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
    if (text.length > 0) {
      items.push({ type: 'message', role: message?.role === 'system' || message?.role === 'developer' ? 'system' : 'user', content: [{ type: 'input_text', text }] })
    }
  }
  return items
}

/** Split a text/event-stream body into `{event, data}` frames. */
async function* sseFrames(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  const reader = body.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        let event = ''
        const data = []
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trim())
        }
        if (data.length > 0) yield { event, data: data.join('\n') }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock?.()
  }
}

/**
 * One model call against the Build Responses endpoint, translated into harness
 * chunks (text, reasoning, tool calls, usage, finish).
 */
async function* grokStream(ctx, options) {
  const tokens = await ensureGrokTokens(ctx)
  if (tokens === undefined) {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Grok Build is not signed in', code: 'AUTH' } } }
    return
  }
  const body = {
    model: options.model,
    input: toResponsesInput(options.messages, options.system),
    stream: true,
  }
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    body.tools = options.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    }))
  }
  if (typeof options.reasoningEffort === 'string') body.reasoning = { effort: options.reasoningEffort }
  if (typeof options.temperature === 'number') body.temperature = options.temperature
  if (typeof options.maxTokens === 'number') body.max_output_tokens = options.maxTokens

  let response
  try {
    response = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { ...grokHeaders(tokens), 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: options.signal,
    })
  } catch (error) {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error?.message ?? error), code: 'TRANSPORT' } } }
    return
  }
  if (!response.ok || response.body === null) {
    const text = await response.text().catch(() => '')
    const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'SERVER'
    yield { type: 'finish', reason: { kind: 'error', failure: { message: text.slice(0, 400) || `responses endpoint answered ${response.status}`, code, status: response.status } } }
    return
  }

  let nextIndex = 0
  const indexByItem = new Map()
  let sawToolCall = false
  let usage
  const openBlock = (item, kind) => {
    const index = nextIndex
    nextIndex += 1
    indexByItem.set(item, index)
    return index
  }
  for await (const frame of sseFrames(response.body)) {
    if (frame.data === '[DONE]') break
    let event
    try {
      event = JSON.parse(frame.data)
    } catch {
      continue
    }
    const type = frame.event || event.type || ''
    if (type === 'response.output_item.added') {
      const item = event.item ?? {}
      const key = item.id ?? `item-${nextIndex}`
      if (item.type === 'function_call') {
        sawToolCall = true
        const index = openBlock(key, 'tool-call')
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? '').replace(/^.*\./, ''), argumentsDelta: '' }
      } else {
        const index = openBlock(key, 'text')
        yield { type: 'block-start', index, blockType: 'text' }
      }
      continue
    }
    if (type === 'response.output_text.delta') {
      const index = indexByItem.get(event.item_id ?? '') ?? 0
      if (typeof event.delta === 'string' && event.delta.length > 0) yield { type: 'text-delta', index, text: event.delta }
      continue
    }
    if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
      const key = event.item_id ?? 'reasoning'
      if (!indexByItem.has(key)) {
        const index = openBlock(key, 'reasoning')
        yield { type: 'block-start', index, blockType: 'reasoning' }
      }
      const index = indexByItem.get(key)
      if (typeof event.delta === 'string' && event.delta.length > 0) yield { type: 'reasoning-delta', index, text: event.delta }
      continue
    }
    if (type === 'response.function_call_arguments.delta') {
      const index = indexByItem.get(event.item_id ?? '')
      if (index !== undefined && typeof event.delta === 'string' && event.delta.length > 0) {
        yield { type: 'tool-call-delta', index, id: String(event.call_id ?? ''), argumentsDelta: event.delta }
      }
      continue
    }
    if (type === 'response.output_item.done') {
      const item = event.item ?? {}
      const index = indexByItem.get(item.id ?? '')
      if (index === undefined) continue
      if (item.type === 'function_call') {
        yield { type: 'block-end', index, block: { type: 'tool-call', id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? '').replace(/^.*\./, ''), arguments: typeof item.arguments === 'string' ? item.arguments : '{}' } }
      } else {
        const text = Array.isArray(item.content)
          ? item.content.filter((part) => part?.type === 'output_text' || part?.type === 'text').map((part) => part.text ?? '').join('')
          : ''
        yield { type: 'block-end', index, block: { type: 'text', text } }
      }
      continue
    }
    if (type === 'response.completed' || type === 'response.incomplete') {
      const payload = event.response ?? {}
      if (payload.usage !== null && typeof payload.usage === 'object') {
        usage = {
          inputTokens: Number(payload.usage.input_tokens) || 0,
          outputTokens: Number(payload.usage.output_tokens) || 0,
          cacheReadTokens: Number(payload.usage.input_tokens_details?.cached_tokens) || 0,
          totalTokens: (Number(payload.usage.input_tokens) || 0) + (Number(payload.usage.output_tokens) || 0),
        }
        yield { type: 'usage', usage }
      }
      const reason = type === 'response.incomplete' ? { kind: 'max-tokens' } : sawToolCall ? { kind: 'tool-calls' } : { kind: 'stop' }
      yield { type: 'finish', reason }
      return
    }
    if (type === 'response.failed' || type === 'error') {
      const failure = event.response?.error ?? event.error ?? event
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: String(failure?.message ?? 'the Build request failed').slice(0, 400),
            code: typeof failure?.code === 'string' && failure.code.length > 0 ? failure.code.toUpperCase() : 'PI_AI_ERROR',
          },
        },
      }
      return
    }
  }
  yield { type: 'finish', reason: sawToolCall ? { kind: 'tool-calls' } : { kind: 'stop' } }
}

/**
 * Billing for a stored OAuth bundle, used by the balance probe where only the
 * credential value is available.
 * @param {string} raw - the JSON bundle stored under GROK_BUILD_OAUTH.
 */
export async function grokBillingFromBundle(raw) {
  let tokens
  try {
    tokens = JSON.parse(raw)
  } catch {
    throw new Error('the stored Grok Build credential is not a token bundle')
  }
  if (tokens === null || typeof tokens !== 'object' || typeof tokens.accessToken !== 'string') {
    throw new Error('the stored Grok Build credential has no access token')
  }
  const headers = grokHeaders(tokens)
  const response = await fetch(`${BASE_URL}/billing?format=credits`, { headers })
  const text = await response.text()
  if (!response.ok) throw new Error(`billing endpoint answered ${response.status}`)
  let payload
  try {
    payload = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    payload = undefined
  }
  return shapeGrokBilling(payload, await grokSubscriptionTier(headers))
}

/**
 * Verify the signed-in account end to end: list models, then ask for a tiny
 * completion. Each stage reports its own failure so the page can say which part
 * of the chain broke.
 */
export async function probeGrok(ctx) {
  let tokens
  try {
    tokens = await ensureGrokTokens(ctx)
  } catch (error) {
    return { ok: false, stage: 'token', error: String(error?.message ?? error).slice(0, 300) }
  }
  if (tokens === undefined) return { ok: false, stage: 'auth', error: 'Grok Build is not signed in' }
  let models
  try {
    models = await listGrokModels(ctx)
  } catch (error) {
    return { ok: false, stage: 'models', error: String(error?.message ?? error).slice(0, 300) }
  }
  const model = models[0]?.id
  if (model === undefined) return { ok: false, stage: 'models', error: 'the account lists no usable model' }
  let response
  try {
    response = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { ...grokHeaders(tokens), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
        stream: false,
        max_output_tokens: 16,
      }),
    })
  } catch (error) {
    return { ok: false, stage: 'transport', model, error: String(error?.message ?? error).slice(0, 300) }
  }
  const text = await response.text().catch(() => '')
  if (!response.ok) {
    return { ok: false, stage: 'inference', model, status: response.status, error: summarise(text, response.status) }
  }
  let payload
  try {
    payload = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    payload = undefined
  }
  const sample = Array.isArray(payload?.output)
    ? payload.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .filter((part) => part?.type === 'output_text' || part?.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
        .slice(0, 80)
    : ''
  return { ok: true, stage: 'ok', model, models: models.length, sample }
}

/** Turn an upstream error body into one short line. */
function summarise(text, status) {
  try {
    const parsed = JSON.parse(text)
    const message = parsed?.error?.message ?? parsed?.error ?? parsed?.message
    if (typeof message === 'string' && message.length > 0) return message.slice(0, 300)
  } catch {
    // fall through to the raw text
  }
  return text.length > 0 ? text.slice(0, 300) : `the endpoint answered ${status}`
}

/** The `llm` adapter object (duck-typed LlmAdapter). */
export function createGrokAdapter() {
  const providerInfo = (provider) => ({ id: provider, name: 'Grok Build' })
  const resolveModel = async (provider, model) => ({
    provider,
    id: model,
    name: model,
    context: { contextWindow: DEFAULT_CONTEXT },
    defaultMaxTokens: DEFAULT_MAX_TOKENS,
    reasoning: {
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ],
      defaultEffort: 'high',
    },
  })
  return {
    providerInfo,
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => ({ width: image.width, height: image.height, maxBytes: 1024 * 1024 }),
    async listModels(provider) {
      const models = await listGrokModels(this.ctx)
      return models.map((model) => ({ provider, id: model.id, name: model.id, inputModalities: ['text', 'image'] }))
    },
    resolveModel,
    async prepareCall(provider, model) {
      return { model: await resolveModel(provider, model), stream: (options) => this.stream(options) }
    },
    async *stream(options) {
      yield* grokStream(this.ctx, options)
    },
  }
}

/** Bind the adapter to one plugin context. */
export function bindGrokAdapter(adapter, ctx) {
  adapter.ctx = ctx
  return adapter
}
