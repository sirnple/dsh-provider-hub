import fs from 'node:fs'
// Native Grok Build: device OAuth, token refresh, model catalog, billing and the
// Responses stream translation, all inside the plugin (no external gateway).
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'

const ROOT = 'C:/Users/Administrator/repos/dsh-provider-hub/scratch'
process.env.DSH_HOME = `${ROOT}/tmp-grok`
rmSync(process.env.DSH_HOME, { recursive: true, force: true })

const moduleUrl = new URL('index.testable.mjs', import.meta.url).href

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
const ACCESS = `${b64({ alg: 'none' })}.${b64({ sub: 'user-1', email: 'grok@example.com', tier: 'supergrok' })}.sig`

function sse(frames) {
  return frames.map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`).join('')
}
const TEXT_STREAM = sse([
  { event: 'response.output_item.added', data: { type: 'response.output_item.added', item: { id: 'msg_1', type: 'message' } } },
  { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Hello' } },
  { event: 'response.output_item.done', data: { type: 'response.output_item.done', item: { id: 'msg_1', type: 'message', content: [{ type: 'output_text', text: 'Hello' }] } } },
  { event: 'response.completed', data: { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } } } },
])
const TOOL_STREAM = sse([
  { event: 'response.output_item.added', data: { type: 'response.output_item.added', item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'shell' } } },
  { event: 'response.function_call_arguments.delta', data: { type: 'response.function_call_arguments.delta', item_id: 'fc_1', call_id: 'call_1', delta: '{"cmd":"ls"}' } },
  { event: 'response.output_item.done', data: { type: 'response.output_item.done', item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'shell', arguments: '{"cmd":"ls"}' } } },
  { event: 'response.completed', data: { type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 5 } } } },
])

function makeHost(options = {}) {
  const { registrations, routes, listeners, disposers, effects } = { registrations: [], routes: new Map(), listeners: [], disposers: [], effects: [] }
  const credentials = new Map()
  if (options.tokens !== undefined) credentials.set('GROK_BUILD_OAUTH', JSON.stringify(options.tokens))
  const adapters = new Map()
  const edits = []
  const piEntry = { options: { id: 'llm-pi-ai', config: { providers: options.piProviders ?? {} } } }
  const effect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  }
  const child = {
    effect,
    fiber: {},
    settings: { configure: () => () => {} },
    connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } } },
  }
  const ctx = {
    fiber: {},
    logger: { info() {}, warn() {}, error() {} },
    get: (service) => {
      if (service === 'configEditor') return { entries: () => [piEntry], edit: async (entry, change) => { edits.push(change(structuredClone(entry.options.config), {})) } }
      if (service === 'credentials') {
        return {
          resolve: async (ref) => (credentials.has(ref) ? { value: credentials.get(ref), configured: true } : undefined),
          set: async (ref, value) => { credentials.set(ref, value) },
          unset: async (ref) => { credentials.delete(ref) },
          describe: async (ref) => ({ configured: credentials.has(ref), writable: true }),
        }
      }
      return undefined
    },
    effect,
    inject: (deps, callback) => callback(child),
    on: (event, listener) => { listeners.push({ event, listener }) },
    llm: {
      registerAdapter: (providers, adapter) => { for (const provider of providers) adapters.set(provider, adapter); return () => {} },
      stream: () => { throw new Error('streaming goes through the adapter in this harness') },
    },
  }
  return { ctx, credentials, adapters, routes, edits, piEntry, registrations, disposers }
}

async function activate(options = {}) {
  const { apply, Config } = await import(`${moduleUrl}?grok=${Math.random()}`)
  const host = makeHost(options)
  const providers = options.providers ?? [{
    id: 'grok-build',
    name: 'Grok Build',
    catalog: false,
    accounts: [{ id: 'a1', label: 'Grok', ref: 'GROK_BUILD_OAUTH' }],
  }]
  apply(host.ctx, Config({ providers, failover: { enabled: false } }))
  await new Promise((resolve) => setTimeout(resolve, 60))
  return host
}

const calls = []
let tokenMode = 'pending'
let stream = TEXT_STREAM
globalThis.fetch = async (url, init) => {
  const target = String(url)
  calls.push({ url: target, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body })
  if (target.endsWith('/oauth2/device/code')) {
    return new Response(JSON.stringify({
      device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: 'https://x.ai/device',
      verification_uri_complete: 'https://x.ai/device?code=ABCD-EFGH', interval: 5, expires_in: 1800,
    }), { status: 200 })
  }
  if (target.endsWith('/oauth2/token')) {
    if (tokenMode === 'pending') return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 })
    return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: 'refresh-1', expires_in: 3600 }), { status: 200 })
  }
  if (target.endsWith('/models')) {
    return new Response(JSON.stringify({
      data: [
        { id: 'grok-4.7', context_window: 500000, max_completion_tokens: 1000000 },
        { id: 'grok-hidden', hidden: true },
        { id: 'grok-4.6' },
      ],
    }), { status: 200 })
  }
  if (target.includes('/billing')) {
    return new Response(JSON.stringify({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-03T15:54:34Z', end: '2026-11-10T15:54:34Z' },
        creditUsagePercent: 5,
        productUsage: [{ product: 'GrokImagine', usagePercent: 4 }, { product: 'GrokChat', usagePercent: 1 }],
        prepaidBalance: { val: 0 },
        billingPeriodEnd: '2026-11-10T15:54:34Z',
      },
    }), { status: 200 })
  }
  if (target.includes('/user?include=subscription')) {
    return new Response(JSON.stringify({ email: 'grok@example.com', subscriptionTier: 'GrokPro' }), { status: 200 })
  }
  if (target.endsWith('/responses')) {
    let wantsStream = true
    try {
      wantsStream = JSON.parse(String(init?.body ?? '{}')).stream !== false
    } catch {
      wantsStream = true
    }
    if (!wantsStream) {
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'pong' }] }] }), { status: 200 })
    }
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response('not found', { status: 404 })
}

// ---------------------------------------------------------------- 1. adapter
{
  const host = await activate({ tokens: { accessToken: ACCESS, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } })
  const adapter = host.adapters.get('grok-build')
  assert.ok(adapter, 'the plugin registers a grok-build adapter')
  assert.equal(adapter.providerInfo('grok-build').name, 'Grok Build')
  const models = await adapter.listModels('grok-build')
  assert.deepEqual(models.map((model) => model.id), ['grok-4.7', 'grok-4.6'], 'hidden models are dropped')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 1 adapter registered and lists models')
}

// ------------------------------------------------------------- 2. oauth flow
{
  const host = await activate()
  const start = host.routes.get('/api/provider-accounts-grok/start')
  const started = await (await start.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/start', { method: 'POST' }))).json()
  assert.equal(started.ok, true)
  assert.equal(started.device.userCode, 'ABCD-EFGH')
  assert.equal(started.device.verificationUri, 'https://x.ai/device')
  const deviceCall = calls.find((call) => call.url.endsWith('/oauth2/device/code'))
  assert.match(String(deviceCall.body), /referrer=grok-build/, 'the device request names the CLI referrer')
  assert.equal(deviceCall.headers['x-grok-client-surface'], 'ui')

  const poll = host.routes.get('/api/provider-accounts-grok/poll')
  tokenMode = 'pending'
  const pending = await (await poll.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/poll', { method: 'POST', body: JSON.stringify({ deviceCode: 'dev-1' }) }))).json()
  assert.equal(pending.status, 'pending', 'a pending authorization is reported as pending')

  tokenMode = 'ok'
  const done = await (await poll.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/poll', { method: 'POST', body: JSON.stringify({ deviceCode: 'dev-1' }) }))).json()
  assert.equal(done.status, 'ok')
  assert.equal(done.tokens.email, 'grok@example.com', 'identity claims come from the access token')
  assert.ok(host.credentials.get('GROK_BUILD_OAUTH'), 'the token bundle is stored')

  const status = await (await host.routes.get('/api/provider-accounts-grok/status').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/status'))).json()
  assert.equal(status.signedIn, true)
  assert.equal(status.email, 'grok@example.com')
  assert.equal(status.plan, 'GrokPro', 'billing supplies the plan name')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 2 device flow, token store and status')
}

// ------------------------------------------------------------ 3. token refresh
{
  const host = await activate({
    tokens: { accessToken: ACCESS, refreshToken: 'refresh-1', expiresAt: Date.now() - 1000, email: 'grok@example.com' },
  })
  const status = await (await host.routes.get('/api/provider-accounts-grok/status').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/status'))).json()
  assert.equal(status.signedIn, true)
  const refreshed = JSON.parse(host.credentials.get('GROK_BUILD_OAUTH'))
  assert.ok(refreshed.expiresAt > Date.now(), 'an expired token is refreshed')
  const refreshCall = calls.filter((call) => call.url.endsWith('/oauth2/token')).at(-1)
  assert.match(String(refreshCall.body), /grant_type=refresh_token/)
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 3 expired tokens refresh')
}

// ------------------------------------------------------- 4. responses streaming
{
  const host = await activate({ tokens: { accessToken: ACCESS, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } })
  const adapter = host.adapters.get('grok-build')
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'grok-build', model: 'grok-4.7', system: 'be brief', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) chunks.push(chunk)
  const body = JSON.parse(String(calls.filter((call) => call.url.endsWith('/responses')).at(-1).body))
  assert.equal(body.stream, true)
  assert.equal(body.model, 'grok-4.7')
  assert.deepEqual(body.input[0], { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'be brief' }] })
  assert.deepEqual(chunks.map((chunk) => chunk.type), ['block-start', 'text-delta', 'block-end', 'usage', 'finish'], chunks.map((chunk) => chunk.type).join(','))
  assert.equal(chunks[1].text, 'Hello')
  assert.equal(chunks[2].block.text, 'Hello')
  assert.deepEqual(chunks[3].usage, { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4, totalTokens: 15 })
  assert.equal(chunks[4].reason.kind, 'stop')

  stream = TOOL_STREAM
  const toolChunks = []
  for await (const chunk of adapter.stream({ provider: 'grok-build', model: 'grok-4.7', messages: [{ role: 'user', content: [{ type: 'text', text: 'ls' }] }], tools: [{ name: 'shell', description: 'run', parameters: { type: 'object' } }] })) toolChunks.push(chunk)
  assert.equal(toolChunks.at(-1).reason.kind, 'tool-calls')
  const ended = toolChunks.find((chunk) => chunk.type === 'block-end')
  assert.equal(ended.block.type, 'tool-call')
  assert.equal(ended.block.name, 'shell')
  assert.equal(ended.block.arguments, '{"cmd":"ls"}')
  stream = TEXT_STREAM
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 4 responses stream maps to harness chunks')
}

// -------------------------------------------------------------- 5. billing
{
  const host = await activate({ tokens: { accessToken: ACCESS, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } })
  const route = host.routes.get('/api/provider-accounts-balance')
  const snapshot = await (await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))).json()
  const entry = snapshot.balances['grok-build::GROK_BUILD_OAUTH']
  assert.ok(entry, 'the native provider gets a billing entry')
  assert.equal(entry.ok, true)
  assert.equal(entry.meters[0].id, 'weekly', 'the Build plan meters a rolling weekly window')
  assert.equal(entry.meters[0].percent, 5, 'the upstream percentage is shown as-is')
  assert.equal(entry.meters[0].resetsAt, '2026-11-10T15:54:34Z')
  const fields = Object.fromEntries(entry.fields.map((field) => [field.key, field.value]))
  assert.equal(fields.plan, 'GrokPro', 'the subscription tier names the plan')
  assert.equal(fields.weeklyReset, '2026-11-10T15:54:34Z', 'the reset time is labelled as the weekly reset')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 5 billing drives the quota meters')
}

// ------------------------------------------------- 6. no llm-pi-ai route created
{
  const host = await activate()
  assert.equal(host.edits.length, 0, 'reconcile never creates a pi-ai route for the native provider')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 6 the native provider is not materialized as a pi-ai route')
}

// ---------------------------------------------------------------- 7. probe
{
  const host = await activate({ tokens: { accessToken: ACCESS, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } })
  const probeRoute = host.routes.get('/api/provider-accounts-grok/probe')
  const { probe } = await (await probeRoute.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/probe', { method: 'POST' }))).json()
  assert.equal(probe.ok, true, 'a signed-in account probes clean')
  assert.equal(probe.model, 'grok-4.7')
  assert.equal(probe.models, 2)
  assert.equal(probe.sample, 'pong', 'the probe reports a real reply')
  host.disposers.forEach((dispose) => dispose())

  const cold = await activate()
  const coldProbe = await (await cold.routes.get('/api/provider-accounts-grok/probe').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-grok/probe', { method: 'POST' }))).json()
  assert.equal(coldProbe.probe.ok, false)
  assert.equal(coldProbe.probe.stage, 'auth', 'an unsigned session reports the auth stage')
  cold.disposers.forEach((dispose) => dispose())
  console.log('ok 7 the probe reports stage by stage')
}

// --------------------------------------------- 8. a fresh account gets a quota entry
{
  // Earlier scenarios wrote a balance entry for this route; a fresh sign-in has none.
  rmSync(`${process.env.DSH_HOME}/storages/provider-accounts/usage.json`, { force: true })
  const host = await activate({ tokens: { accessToken: ACCESS, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } })
  await host.routes.get('/api/provider-accounts-usage').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-usage'))
  const deadline = Date.now() + 2000
  let entry
  while (Date.now() < deadline) {
    try {
      entry = JSON.parse(fs.readFileSync(`${process.env.DSH_HOME}/storages/provider-accounts/usage.json`, 'utf8')).balances['grok-build::GROK_BUILD_OAUTH']
    } catch {
      entry = undefined
    }
    if (entry !== undefined) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(entry, 'an account without an entry is probed without waiting for the staleness window')
  assert.equal(entry.ok, true)
  assert.equal(entry.meters[0].id, 'weekly', 'the stored meter is the weekly window')

  // The repair is awaited, so the read that triggered it already carries the quota.
  const snapshot = await (await host.routes.get('/api/provider-accounts-usage').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-usage'))).json()
  const balance = snapshot.balances['grok-build::GROK_BUILD_OAUTH']
  assert.ok(balance, 'the snapshot carries the balance entry')
  assert.equal(balance.meters[0].id, 'weekly', 'the snapshot carries the weekly meter')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 8 a fresh account is probed on the first read')
}

console.log('\nALL GROK CHECKS PASSED')
