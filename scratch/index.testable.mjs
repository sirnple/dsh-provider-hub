/**
 * Host half of the `dsh-provider-accounts` bundle — "模型提供商与账号".
 *
 * The browser page keeps providers and their accounts in this plugin's settings
 * namespace; here we declare that namespace, keep the generic settings form off,
 * fail a model call over to the next stored account when an attempt dies on a
 * quota / credential error before producing content, and account per-account
 * token usage that the "用量与余额" page reads over an authenticated HTTP route.
 *
 * Failover uses pi-ai's per-request `apiKeyEnv` resolution: rewriting
 * `llm-pi-ai.providers[route].apiKeyEnv` changes which credential the very next
 * request resolves. The rewrite goes through `configEditor.edit`, which persists
 * the profile patch and applies through the normal Loader path (a volatile-only
 * change updates the running pi-ai refs in place, without a restart).
 *
 * Usage accounting writes nothing to configuration: an in-memory ledger is
 * persisted to `$DSH_HOME/storages/provider-accounts/usage.json` and served to
 * the page by two exact Fetch routes on the authenticated `/api` bridge.
 *
 * @module dsh-provider-accounts
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import z from 'file:///C:/Users/Administrator/repos/dsh-provider-accounts/asar/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs'
import {
  GROK_PROVIDER,
  bindGrokAdapter,
  clearGrokTokens,
  createGrokAdapter,
  ensureGrokTokens,
  grokBillingFromBundle,
  pollGrokDevice,
  probeGrok,
  readGrokTokens,
  startGrokDevice,
} from 'file:///C:/Users/Administrator/repos/dsh-provider-accounts/plugin/grok.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'providerAccounts'

/** The one Loader entry failover reads and edits; no other row is ever touched. */
const PI_AI_ENTRY_ID = 'llm-pi-ai'

/**
 * Private marker on the copied options of an internal retry. Its presence tells
 * the `llm/stream` listener that this call is driven by the outer failover loop,
 * so the listener must not start a second, nested account cycle.
 */
const FAILOVER_STATE = Symbol('provider-accounts/failover')

/**
 * Chunk types that count as model output. An error is retryable only while none
 * of them has been emitted: after the first content chunk a retry would
 * duplicate work the caller has already observed.
 */
const CONTENT_CHUNKS = new Set([
  'block-start',
  'text-delta',
  'reasoning-delta',
  'tool-call-delta',
  'block-end',
])

/** Defensive mirror of the schema defaults, used only if `failover` resolves to nothing. */
const DEFAULT_FAILOVER = Object.freeze({
  enabled: true,
  codes: Object.freeze(['QUOTA', 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL']),
  maxHops: 2,
})

/** Where the page reads the ledger: authenticated exact Fetch routes on the `/api` bridge. */
const USAGE_ROUTE = '/api/provider-accounts-usage'
const BALANCE_ROUTE = '/api/provider-accounts-balance'
const TEST_ROUTE = '/api/provider-accounts-test'
const GROK_ROUTE = '/api/provider-accounts-grok'

/** How often a dirty ledger is flushed to disk. */
const USAGE_FLUSH_MS = 10_000
/** Day buckets older than this are dropped on load and on write. */
const USAGE_RETENTION_DAYS = 90

/** The Host's plugin configuration; the page reads and writes this namespace. */
export const Config = z.object({
  /** Third-party providers; accounts are tried in their configured order. */
  providers: z.array(z.object({
    /** pi-ai provider route id (`opencode-go`, a custom route, …). */
    id: z.string().required(),
    /** Display name shown by the page. */
    name: z.string(),
    /** `true` = installed pi-ai catalog route, which only needs `apiKeyEnv`. */
    catalog: z.boolean().default(true),
    /** Custom routes only: `'openai-completions' | 'openai-responses' | 'anthropic-messages'`. */
    api: z.string(),
    /** Custom routes only: endpoint base URL. */
    baseURL: z.string(),
    /** Custom routes only: models the route serves. */
    models: z.array(z.object({
      id: z.string().required(),
      name: z.string(),
      contextWindow: z.natural(),
      maxTokens: z.natural(),
      input: z.array(z.string()),
    })).default([]),
    /**
     * Optional balance/quota probe for this provider: `''` (none) or a known
     * adapter name implemented by this plugin (`opencode-zen`). Unknown names
     * are simply not probed.
     */
    balanceKind: z.string(),
    /** One provider's credentials; `ref` is a credential-store reference name. */
    accounts: z.array(z.object({
      id: z.string().required(),
      label: z.string().required(),
      /** Reference of a stored API key, e.g. `OPENCODE_GO_WORK_API_KEY`. */
      ref: z.string().required(),
    })).default([]),
  })).default([]).volatile(),
  /** Automatic failover policy; read live on every `llm/stream` call. */
  failover: z.object({
    enabled: z.boolean().default(true),
    /**
     * Failure codes that trigger a switch: "this account cannot serve the
     * request" signals from pi-ai. `RATE_LIMIT` is deliberately absent — the
     * retry middleware already backs off on it, and rotating there would burn
     * through accounts on a transient limit.
     */
    codes: z.array(z.string()).default(['QUOTA', 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL']),
    /** Maximum account switches per model call. */
    maxHops: z.natural().default(2),
  }).default({}).volatile(),
})

/**
 * The account this plugin's configuration designates as active for a provider:
 * the head of the account list, which is also the first one tried. The
 * authoritative live value for a route is always the route's own `apiKeyEnv`.
 *
 * @param {object|undefined} provider - one `providers[]` entry from {@link Config}.
 * @returns {{ id: string, label: string, ref: string }|undefined} the first account, if any.
 */
export function activeAccount(provider) {
  return Array.isArray(provider?.accounts) ? provider.accounts[0] : undefined
}

/**
 * Unwrap a possibly-volatile configuration field.
 *
 * Every `.volatile()` field is a stable reference object; the Loader pushes new
 * values into that same reference (`_commitVolatile` in cordis-plugin-loader).
 * Reading through `.get()` per request is therefore what makes configuration
 * live. Plain values pass through unchanged.
 *
 * @param {unknown} value - a raw value or a volatile reference.
 * @param {unknown} fallback - value used when the field is absent.
 * @returns {unknown} the current value, or `fallback`.
 */
function liveValue(value, fallback) {
  let resolved = value
  if (resolved !== null && typeof resolved === 'object' && typeof resolved.get === 'function') {
    try {
      resolved = resolved.get()
    } catch {
      return fallback
    }
  }
  return resolved === undefined || resolved === null ? fallback : resolved
}

/** Live list of configured providers, ignoring entries without a route id. */
function configuredProviders(config) {
  const value = liveValue(config?.providers, [])
  if (!Array.isArray(value)) return []
  return value.filter((provider) => typeof provider?.id === 'string' && provider.id.length > 0)
}

/**
 * Read the `llm-pi-ai` route profile currently configured for one provider.
 * Accepts a raw llm-pi-ai config (`{ providers: { [route]: profile } }`, as on a
 * Loader entry) or a resolved config whose `providers` is a volatile reference.
 *
 * @param {object|undefined} config - an llm-pi-ai config object.
 * @param {object|string|undefined} provider - a provider entry, or its route id.
 * @returns {object|undefined} the route profile, or `undefined` when unconfigured.
 */
export function currentRouteProfile(config, provider) {
  const id = typeof provider === 'string' ? provider : provider?.id
  if (typeof id !== 'string' || id.length === 0) return undefined
  const table = liveValue(config?.providers, undefined)
  if (table === null || typeof table !== 'object') return undefined
  return table[id]
}

/**
 * Live failover policy, normalized for the request path.
 * @param {object|undefined} config - this plugin's configuration.
 * @returns {{ enabled: boolean, codes: Set<string>, maxHops: number }} the policy.
 */
function failoverPolicy(config) {
  const value = liveValue(config?.failover, DEFAULT_FAILOVER)
  const enabled = typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_FAILOVER.enabled
  const rawCodes = Array.isArray(value?.codes) ? value.codes : DEFAULT_FAILOVER.codes
  const codes = new Set(rawCodes.filter((code) => typeof code === 'string' && code.length > 0))
  const hops = value?.maxHops
  const maxHops = typeof hops === 'number' && Number.isFinite(hops) && hops >= 0
    ? Math.floor(hops)
    : DEFAULT_FAILOVER.maxHops
  return { enabled, codes, maxHops }
}

/** Read an optional Cordis service without an inject requirement. */
function optionalService(ctx, serviceName) {
  try {
    return ctx.get(serviceName)
  } catch {
    return undefined
  }
}

/** Warn without ever letting diagnostics break a model call. */
function warn(ctx, message, error) {
  try {
    const detail = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`provider-accounts: ${message}: ${detail}`)
  } catch {
    // Logging must never fail the request.
  }
}

/** One-line message of an unknown thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

/** The `llm-pi-ai` Loader entry, or `undefined` when the profile has none. */
function piAiEntry(ctx) {
  const editor = optionalService(ctx, 'configEditor')
  if (typeof editor?.entries !== 'function') return undefined
  try {
    return editor.entries().find((row) => row?.options?.id === PI_AI_ENTRY_ID)
  } catch {
    return undefined
  }
}

/**
 * The credential reference one provider route currently resolves: the route's
 * own `apiKeyEnv`, falling back to the first configured account.
 *
 * @param {object} ctx - plugin context.
 * @param {object} provider - one `providers[]` entry.
 * @returns {string|undefined} the reference in use, or `undefined` when keyless.
 */
function currentRef(ctx, provider) {
  const route = currentRouteProfile(piAiEntry(ctx)?.options?.config, provider)
  const ref = typeof route?.apiKeyEnv === 'string' && route.apiKeyEnv.length > 0 ? route.apiKeyEnv : undefined
  const resolved = ref ?? activeAccount(provider)?.ref
  if (typeof provider?.id === 'string' && typeof resolved === 'string' && resolved.length > 0) {
    lastRefByProvider.set(provider.id, resolved)
  }
  return resolved
}

/**
 * The account to restore when a route must be (re)created: the reference the
 * route last served when it is still one of the provider's accounts, else the
 * account whose balance probe succeeded, else the first usable account.
 *
 * @param {object} provider - one providers[] entry.
 * @returns {{ id: string, label: string, ref: string }|undefined} the account to serve.
 */
function restoreAccount(provider) {
  const accounts = (Array.isArray(provider?.accounts) ? provider.accounts : [])
    .filter((account) => typeof account?.ref === 'string' && account.ref.length > 0)
  const remembered = lastRefByProvider.get(provider?.id)
  if (typeof remembered === 'string') {
    const match = accounts.find((account) => account.ref === remembered)
    if (match !== undefined) return match
  }
  return preferredAccount(provider)
}

// ---------------------------------------------------------------------------
// Usage ledger
// ---------------------------------------------------------------------------

/**
 * In-memory usage ledger, one row per provider route and credential reference.
 * Shape: `{ accounts: { "<route>\u0000<ref>": row }, balances: {}, updatedAt }`.
 */
const usage = { accounts: {}, balances: {}, updatedAt: 0 }
/** Whether the in-memory ledger has changes not yet on disk. */
let usageDirty = false

/**
 * The credential reference each provider last served, learned from the live
 * route. A repair after the route disappears keeps the account the user chose
 * instead of falling back to the first configured one.
 */
const lastRefByProvider = new Map()

/** Absolute path of the persisted ledger. */
function usageFile() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const home = configured.length > 0 ? configured : join(homedir(), '.dsh')
  return join(home, 'storages', 'provider-accounts', 'usage.json')
}

/** Key one account inside the ledger and in the page snapshot (`<route>::<ref>`). */
function usageKey(providerId, ref) {
  return `${providerId}::${ref}`
}

/** Local calendar day (`YYYY-MM-DD`) of one timestamp. */
function localDay(at = Date.now()) {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** A non-negative integer from an unknown value. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Trim the ledger to the retention window and normalize every row. */
function pruneUsage() {
  const cutoff = Date.now() - USAGE_RETENTION_DAYS * 86_400_000
  const accounts = {}
  for (const [key, raw] of Object.entries(usage.accounts)) {
    if (raw === null || typeof raw !== 'object') continue
    const row = {
      providerId: typeof raw.providerId === 'string' ? raw.providerId : '',
      ref: typeof raw.ref === 'string' ? raw.ref : '',
      requests: count(raw.requests),
      failures: count(raw.failures),
      switches: count(raw.switches),
      input: count(raw.input),
      output: count(raw.output),
      cacheRead: count(raw.cacheRead),
      cacheWrite: count(raw.cacheWrite),
      reasoning: count(raw.reasoning),
      lastUsedAt: typeof raw.lastUsedAt === 'number' ? raw.lastUsedAt : 0,
      lastError: raw.lastError !== null && typeof raw.lastError === 'object'
        ? { code: String(raw.lastError.code ?? ''), message: String(raw.lastError.message ?? '').slice(0, 300), at: count(raw.lastError.at) }
        : undefined,
      days: {},
    }
    if (row.providerId.length === 0 || row.ref.length === 0) continue
    for (const [day, bucket] of Object.entries(raw.days ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || bucket === null || typeof bucket !== 'object') continue
      if (Date.parse(`${day}T00:00:00`) < cutoff) continue
      row.days[day] = {
        requests: count(bucket.requests),
        failures: count(bucket.failures),
        input: count(bucket.input),
        output: count(bucket.output),
      }
    }
    accounts[key] = row
  }
  usage.accounts = accounts
  const balances = {}
  for (const [key, raw] of Object.entries(usage.balances)) {
    if (raw === null || typeof raw !== 'object') continue
    const fetchedAt = typeof raw.fetchedAt === 'number' ? raw.fetchedAt : 0
    if (fetchedAt < cutoff) continue
    balances[key] = {
      kind: String(raw.kind ?? ''),
      ok: raw.ok === true,
      fetchedAt,
      fields: Array.isArray(raw.fields)
        ? raw.fields.filter((field) => field !== null && typeof field === 'object').slice(0, 16).map((field) => ({ key: String(field.key ?? ''), value: String(field.value ?? '') }))
        : [],
      meters: Array.isArray(raw.meters)
        ? raw.meters.filter((meter) => meter !== null && typeof meter === 'object').slice(0, 8).map((meter) => ({
            id: String(meter.id ?? ''),
            percent: typeof meter.percent === 'number' && Number.isFinite(meter.percent) ? Math.min(100, Math.max(0, meter.percent)) : undefined,
            usedUSD: typeof meter.usedUSD === 'number' && Number.isFinite(meter.usedUSD) ? meter.usedUSD : undefined,
            limitUSD: typeof meter.limitUSD === 'number' && Number.isFinite(meter.limitUSD) ? meter.limitUSD : undefined,
            resetsAt: typeof meter.resetsAt === 'string' ? meter.resetsAt : undefined,
            status: typeof meter.status === 'string' ? meter.status : undefined,
          }))
        : [],
      error: raw.ok === true ? undefined : String(raw.error ?? '').slice(0, 300),
    }
  }
  usage.balances = balances
}

/** Load the persisted ledger; a missing or unreadable file starts empty. */
function loadUsage() {
  try {
    const parsed = JSON.parse(readFileSync(usageFile(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      usage.accounts = parsed.accounts !== null && typeof parsed.accounts === 'object' ? parsed.accounts : {}
      usage.balances = parsed.balances !== null && typeof parsed.balances === 'object' ? parsed.balances : {}
      usage.updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    }
  } catch {
    // First run, or a ledger from a newer version: start from what is readable.
  }
  pruneUsage()
}

/** Flush the ledger to disk when it changed; accounting must never throw into a request. */
function saveUsage() {
  if (!usageDirty) return
  const file = usageFile()
  try {
    pruneUsage()
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    usage.updatedAt = Date.now()
    writeFileSync(temporary, JSON.stringify({ version: 1, ...usage }), 'utf8')
    renameSync(temporary, file)
    usageDirty = false
  } catch {
    // Keep the dirty flag so a later flush can retry.
  }
}

/** One ledger row, created on first use. */
function usageRow(providerId, ref) {
  const key = usageKey(providerId, ref)
  let row = usage.accounts[key]
  if (row === undefined) {
    row = {
      providerId,
      ref,
      requests: 0,
      failures: 0,
      switches: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      lastUsedAt: 0,
      days: {},
    }
    usage.accounts[key] = row
  }
  if (row.days === undefined || row.days === null || typeof row.days !== 'object') row.days = {}
  return row
}

/** Today's bucket of one ledger row. */
function usageDay(row, at = Date.now()) {
  const day = localDay(at)
  let bucket = row.days[day]
  if (bucket === undefined) {
    bucket = { requests: 0, failures: 0, input: 0, output: 0 }
    row.days[day] = bucket
  }
  return bucket
}

/** Record the start of one model attempt for an account. */
function recordAttempt(providerId, ref) {
  const row = usageRow(providerId, ref)
  row.requests += 1
  row.lastUsedAt = Date.now()
  usageDay(row).requests += 1
  usageDirty = true
}

/** Record one settled attempt's token usage and terminal failure, if any. */
function recordOutcome(providerId, ref, tokenUsage, failure) {
  const row = usageRow(providerId, ref)
  if (tokenUsage !== null && typeof tokenUsage === 'object') {
    const input = count(tokenUsage.inputTokens)
    const output = count(tokenUsage.outputTokens)
    const cacheRead = count(tokenUsage.cacheReadTokens)
    const cacheWrite = count(tokenUsage.cacheWriteTokens)
    const reasoning = count(tokenUsage.reasoningTokens)
    row.input += input
    row.output += output
    row.cacheRead += cacheRead
    row.cacheWrite += cacheWrite
    row.reasoning += reasoning
    const bucket = usageDay(row)
    bucket.input += input
    bucket.output += output
  }
  if (failure !== null && typeof failure === 'object') {
    row.failures += 1
    usageDay(row).failures += 1
    row.lastError = {
      code: typeof failure.code === 'string' ? failure.code : '',
      message: typeof failure.message === 'string' ? failure.message.slice(0, 300) : '',
      at: Date.now(),
    }
  }
  usageDirty = true
}

/** Record that failover handed one request from `fromRef` to `toRef`. */
function recordSwitch(providerId, fromRef, toRef, failure) {
  if (typeof fromRef === 'string' && fromRef.length > 0) {
    const row = usageRow(providerId, fromRef)
    row.switches += 1
    row.failures += 1
    usageDay(row).failures += 1
    row.lastError = {
      code: typeof failure?.code === 'string' ? failure.code : '',
      message: typeof failure?.message === 'string' ? failure.message.slice(0, 300) : '',
      at: Date.now(),
    }
  }
  if (typeof toRef === 'string' && toRef.length > 0) usageRow(providerId, toRef)
  usageDirty = true
}

/** Render one account row of the snapshot the page consumes. */
function accountSnapshot(provider, account, entry, active) {
  const row = entry ?? {}
  return {
    providerId: provider.id,
    providerName: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id,
    ref: account.ref,
    label: typeof account.label === 'string' && account.label.length > 0 ? account.label : account.ref,
    active: active === true,
    requests: count(row.requests),
    failures: count(row.failures),
    switches: count(row.switches),
    input: count(row.input),
    output: count(row.output),
    cacheRead: count(row.cacheRead),
    cacheWrite: count(row.cacheWrite),
    reasoning: count(row.reasoning),
    lastUsedAt: count(row.lastUsedAt) || null,
    lastError: row.lastError ?? null,
    days: row.days ?? {},
  }
}

/**
 * The complete read model behind the "用量与余额" page.
 *
 * @param {object} ctx - plugin context, used to read the live route references.
 * @param {object} config - this plugin's configuration.
 * @returns {object} JSON-safe snapshot of providers, per-account usage and balances.
 */
function usageSnapshot(ctx, config) {
  const providers = []
  const accounts = []
  for (const provider of configuredProviders(config)) {
    const activeRef = currentRef(ctx, provider)
    providers.push({
      id: provider.id,
      name: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id,
      catalog: provider.catalog !== false,
      balanceKind: balanceKindFor(provider),
      activeRef: activeRef ?? null,
    })
    for (const account of Array.isArray(provider.accounts) ? provider.accounts : []) {
      if (typeof account?.ref !== 'string' || account.ref.length === 0) continue
      accounts.push(accountSnapshot(provider, account, usage.accounts[usageKey(provider.id, account.ref)], account.ref === activeRef))
    }
  }
  return {
    updatedAt: usage.updatedAt,
    providers,
    accounts,
    balances: usage.balances,
  }
}

// ---------------------------------------------------------------------------
// Provider balance probes
// ---------------------------------------------------------------------------

/** Fetch JSON with a hard timeout; never logs the request or its credential. */
async function fetchJson(url, init, timeoutMs = 8000) {
  if (typeof fetch !== 'function') throw new Error('this Host has no fetch implementation')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let body
    try {
      body = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: response.status, ok: response.ok, body, text: text.slice(0, 4000) }
  } finally {
    clearTimeout(timer)
  }
}

/** Format one number as a currency-ish string without assuming the currency. */
function money(value, currency) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return undefined
  const amount = Math.abs(numeric) >= 100 ? numeric.toFixed(2) : numeric.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return typeof currency === 'string' && currency.length > 0 ? `${amount} ${currency}` : amount
}

/**
 * Adapters that interrogate a provider's own console for quota/balance data.
 * A provider opts in with `balanceKind`; an unknown kind is never probed.
 * Each adapter returns `{ fields: [{ key, value }] }` and throws on refusal.
 *
 * Keys are stable tokens the page localizes when it knows them (`balance`,
 * `used`, `limit`, `remaining`, `resetAt`); any other key is shown verbatim.
 */
const BALANCE_ADAPTERS = new Map()

/** Read the first defined number from a list of candidate paths. */
function pickNumber(source, paths) {
  for (const path of paths) {
    let node = source
    for (const segment of path.split('.')) {
      node = node !== null && typeof node === 'object' ? node[segment] : undefined
    }
    if (typeof node === 'number' && Number.isFinite(node)) return node
    if (typeof node === 'string' && node.trim().length > 0 && Number.isFinite(Number(node))) return Number(node)
  }
  return undefined
}

/** Known console URLs of the OpenCode Go / Zen subscriptions. */
const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const OPENCODE_GO_STATUS_URL = 'https://opencode.ai/console/api/go/status'
const OPENCODE_BILLING_URL = 'https://opencode.ai/console/api/billing/status'

/** A US-dollar number from the provider's integer micro-cent amount (1e-8 USD). */
function microCentsToUSD(value) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return undefined
  return Math.round((numeric / 1e8) * 100) / 100
}

/** A US-dollar string from the provider's integer micro-cent amount (1e-8 USD). */
function dollarsFromMicroCents(value) {
  const numeric = microCentsToUSD(value)
  if (numeric === undefined) return undefined
  return `$${numeric.toFixed(2)}`
}

/**
 * OpenCode Go / Zen: the officially served usage percentages plus the console's
 * dollar meters and prepaid balance. The percentage endpoint is the contract;
 * the `console/api/*` calls are undocumented enrichment that may fail alone.
 */
BALANCE_ADAPTERS.set('opencode-zen', async ({ key }) => {
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
  const fields = []
  /** One gauge per usage window; the console adds exact dollars when it answers. */
  const gauges = new Map()
  const gauge = (id) => {
    let found = gauges.get(id)
    if (found === undefined) {
      found = { id, percent: undefined, usedUSD: undefined, limitUSD: undefined, resetsAt: undefined, status: undefined }
      gauges.set(id, found)
    }
    return found
  }
  const usage = await fetchJson(OPENCODE_USAGE_URL, { headers })
  if (!usage.ok) throw new Error(`usage endpoint answered ${usage.status}`)
  const windows = usage.body?.usage
  if (windows === null || typeof windows !== 'object') throw new Error('usage response carried no windows')
  for (const [name, id] of [['rolling', 'fiveHour'], ['weekly', 'weekly'], ['monthly', 'monthly']]) {
    const window = windows[name]
    if (window === null || typeof window !== 'object') continue
    if (typeof window.percent === 'number' && Number.isFinite(window.percent)) gauge(id).percent = window.percent
    if (typeof window.resetsAt === 'string') gauge(id).resetsAt = window.resetsAt
    if (typeof window.status === 'string') gauge(id).status = window.status
    // Textual mirror, for accessibility and for a client that only renders fields.
    if (typeof window.percent === 'number') fields.push({ key: name, value: `${Math.round(window.percent * 100) / 100}%` })
    if (typeof window.resetsAt === 'string') fields.push({ key: `${name}Reset`, value: window.resetsAt })
    if (typeof window.status === 'string' && window.status !== 'ok') fields.push({ key: `${name}Status`, value: window.status })
  }

  // Undocumented console endpoints: dollars per window and the prepaid balance.
  try {
    const billing = await fetchJson(OPENCODE_BILLING_URL, { headers })
    if (billing.ok) {
      const balance = dollarsFromMicroCents(pickNumber(billing.body, ['availableMicroCents', 'balanceMicroCents']))
      if (balance !== undefined) fields.push({ key: 'balance', value: balance })
    }
  } catch {
    // Console is optional.
  }
  try {
    const status = await fetchJson(OPENCODE_GO_STATUS_URL, { headers })
    if (status.ok && status.body !== null && typeof status.body === 'object') {
      const meters = status.body.access?.meters
      for (const [meter, id] of [['fiveHour', 'fiveHour'], ['week', 'weekly'], ['month', 'monthly']]) {
        const entry = meters?.[meter]
        if (entry === null || typeof entry !== 'object') continue
        const used = microCentsToUSD(entry.usedMicroCents)
        const limit = microCentsToUSD(entry.limitMicroCents)
        if (used !== undefined && limit !== undefined) {
          const found = gauge(id)
          found.usedUSD = used
          found.limitUSD = limit
          const formattedUsed = dollarsFromMicroCents(entry.usedMicroCents)
          const formattedLimit = dollarsFromMicroCents(entry.limitMicroCents)
          if (formattedUsed !== undefined && formattedLimit !== undefined) {
            fields.push({ key: `${id}Spend`, value: `${formattedUsed} / ${formattedLimit}` })
          }
        }
        if (typeof entry.resetsAt === 'string' && gauge(id).resetsAt === undefined) gauge(id).resetsAt = entry.resetsAt
      }
    }
  } catch {
    // Console is optional.
  }
  return { fields, meters: [...gauges.values()] }
})

/** DeepSeek's documented balance endpoint. */
BALANCE_ADAPTERS.set('deepseek', async ({ key }) => {
  const response = await fetchJson('https://api.deepseek.com/user/balance', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`balance endpoint answered ${response.status}`)
  const info = Array.isArray(response.body?.balance_infos) ? response.body.balance_infos[0] : undefined
  if (info === null || typeof info !== 'object') throw new Error('balance response carried no balance_infos')
  const currency = typeof info.currency === 'string' ? info.currency : ''
  const fields = []
  for (const [field, source] of [['balance', 'total_balance'], ['granted', 'granted_balance'], ['toppedUp', 'topped_up_balance']]) {
    const value = info[source]
    if (typeof value === 'string' || typeof value === 'number') {
      fields.push({ key: field, value: currency.length > 0 ? `${value} ${currency}` : String(value) })
    }
  }
  if (response.body.is_available === false) fields.push({ key: 'status', value: 'unavailable' })
  return { fields }
})

/** OpenRouter's credits endpoint: purchased credits and lifetime usage. */
BALANCE_ADAPTERS.set('openrouter', async ({ key }) => {
  const response = await fetchJson('https://openrouter.ai/api/v1/credits', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`credits endpoint answered ${response.status}`)
  const total = pickNumber(response.body, ['data.total_credits'])
  const used = pickNumber(response.body, ['data.total_usage'])
  const fields = []
  if (total !== undefined) fields.push({ key: 'limit', value: money(total) ?? String(total) })
  if (used !== undefined) fields.push({ key: 'used', value: money(used) ?? String(used) })
  if (total !== undefined && used !== undefined) fields.push({ key: 'balance', value: money(total - used) ?? String(total - used) })
  const meters = []
  if (total !== undefined && total > 0 && used !== undefined) {
    meters.push({
      id: 'credits',
      percent: Math.min(100, Math.max(0, (used / total) * 100)),
      usedUSD: used,
      limitUSD: total,
      resetsAt: undefined,
      status: undefined,
    })
  }
  return { fields, meters }
})

/**
 * xAI publishes no usage, quota or credits endpoint on its public API: the only
 * way to see spend is the console, which needs a signed-in session. This probe
 * therefore checks the key itself and reports that no quota API exists, so the
 * page can say so instead of staying silent.
 */
BALANCE_ADAPTERS.set('xai', async ({ key }) => {
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
  // `/v1/models` is the endpoint that answers "may this team make requests": an
  // exhausted credit balance or monthly spending limit comes back as 403 with the
  // reason, while `/v1/api-key` stays 200 because the key itself is fine.
  const models = await fetchJson('https://api.x.ai/v1/models', { headers })
  if (!models.ok) {
    const detail = models.body !== null && typeof models.body === 'object' && typeof models.body.error === 'string'
      ? models.body.error
      : `endpoint answered ${models.status}`
    // `/v1/api-key` keeps answering 200 while the team is blocked, and names the
    // reason there: a blocked team is a billing/credits state, not a bad key.
    let flag = ''
    try {
      const info = await fetchJson('https://api.x.ai/v1/api-key', { headers })
      const body = info.body !== null && typeof info.body === 'object' ? info.body : {}
      if (info.ok && body.team_blocked === true) flag = 'team_blocked · '
      else if (info.ok && body.api_key_blocked === true) flag = 'api_key_blocked · '
    } catch {
      // Keep the models message; the flag is extra context.
    }
    throw new Error(flag + detail)
  }
  const fields = [{ key: 'status', value: 'active' }]
  const listed = models.body !== null && typeof models.body === 'object' && Array.isArray(models.body.data)
    ? models.body.data.length
    : undefined
  if (listed !== undefined) fields.push({ key: 'modelCount', value: String(listed) })
  try {
    const info = await fetchJson('https://api.x.ai/v1/api-key', { headers })
    const body = info.body !== null && typeof info.body === 'object' ? info.body : {}
    if (info.ok && typeof body.name === 'string' && body.name.length > 0) fields.push({ key: 'keyName', value: body.name })
  } catch {
    // The key name is decoration; the models call already decided usability.
  }
  return { fields, meters: [] }
})

/**
 * Grok Build billing: the OAuth bundle is the "key", and `/billing?format=credits`
 * reports the plan and the monthly quota window.
 */
BALANCE_ADAPTERS.set(GROK_PROVIDER, async ({ key }) => {
  const billing = await grokBillingFromBundle(key)
  const fields = []
  if (billing.plan !== undefined) fields.push({ key: 'plan', value: billing.plan })
  const resetKey = billing.periodKind === 'weekly' ? 'weeklyReset' : billing.periodKind === 'fiveHour' ? 'rollingReset' : 'monthlyReset'
  if (billing.periodEnd !== undefined) fields.push({ key: resetKey, value: billing.periodEnd })
  if (billing.prepaid > 0) fields.push({ key: 'toppedUp', value: billing.prepaid.toFixed(2) })
  // The Build plan meters a rolling period percentage, not dollars of budget.
  const meters = [{
    id: billing.periodKind,
    percent: billing.percent,
    resetsAt: billing.periodEnd,
    status: billing.percent >= 100 ? 'rate-limited' : 'ok',
  }]
  return { fields, meters }
})

/**
 * Balance adapters inferred from a route id when the provider entry predates the
 * `balanceKind` field (or omits it). An explicit configured kind always wins.
 */
const BALANCE_KIND_BY_ROUTE = new Map([
  ['opencode-go', 'opencode-zen'],
  ['opencode', 'opencode-zen'],
  ['deepseek', 'deepseek'],
  ['openrouter', 'openrouter'],
  ['xai', 'xai'],
  ['grok-build', 'grok-build'],
])

/**
 * The balance adapter a provider uses: its configured `balanceKind`, else one
 * inferred from the route id, else none.
 *
 * @param {object|undefined} provider - one `providers[]` entry.
 * @returns {string} an adapter name, or `''` when the provider has no probe.
 */
function balanceKindFor(provider) {
  const configured = typeof provider?.balanceKind === 'string' ? provider.balanceKind.trim() : ''
  if (configured.length > 0) return configured
  return BALANCE_KIND_BY_ROUTE.get(provider?.id) ?? ''
}

/**
 * Fetch one provider's balance/quota payload.
 *
 * @param {{key: string, provider: object, account: object}} input - credential value and route facts.
 * @returns {Promise<{fields: {key: string, value: string}[], meters?: object[]}>} the rendered fields
 *   and the structured gauges the page draws as progress bars.
 */
async function probeProviderBalance(input) {
  const adapter = BALANCE_ADAPTERS.get(balanceKindFor(input.provider))
  if (adapter === undefined) throw new Error(`no balance probe for route "${input.provider?.id ?? ''}"`)
  return adapter(input)
}

/** How stale a balance snapshot may get before a read refreshes it in the background. */
const BALANCE_STALE_MS = 5 * 60_000
/**
 * Version of the balance shape this Host writes. A stored entry from an older
 * shape (for example one parsed before the Grok weekly window existed) is probed
 * again instead of being trusted for the whole staleness window.
 */
const BALANCE_SHAPE_VERSION = 2
/** When the last probe round finished. */
let lastBalanceProbeAt = 0
/** Whether a background probe round is already running. */
let balanceProbeRunning = false

/**
 * Validate one account's stored key by running its provider probe.
 *
 * Catalogue-backed discovery never calls the provider, so it cannot tell a good
 * key from a rejected one; this path performs the real request and records the
 * outcome in the balance snapshot, which the page then renders.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - this plugin's configuration.
 * @param {string} providerId - provider route id.
 * @param {string|undefined} ref - credential reference; omitted picks the current one.
 * @returns {Promise<object>} `{ supported, ok, ref?, error?, reason? }`.
 */
async function testAccountKey(ctx, config, providerId, ref) {
  const provider = configuredProviders(config).find((candidate) => candidate.id === providerId)
  if (provider === undefined) return { supported: false, reason: 'unknown-provider' }
  const accounts = (Array.isArray(provider.accounts) ? provider.accounts : [])
    .filter((candidate) => typeof candidate?.ref === 'string' && candidate.ref.length > 0)
  const wanted = ref ?? currentRef(ctx, provider)
  const account = accounts.find((candidate) => candidate.ref === wanted) ?? accounts[0]
  if (account === undefined) return { supported: false, reason: 'unknown-account' }
  const kind = balanceKindFor(provider)
  if (!BALANCE_ADAPTERS.has(kind)) return { supported: false, reason: 'no-probe', kind }

  const key = usageKey(provider.id, account.ref)
  const record = (ok, fields, meters, error) => {
    usage.balances[key] = { kind, ok, fetchedAt: Date.now(), fields, meters, error }
    usageDirty = true
    saveUsage()
  }
  const credentials = optionalService(ctx, 'credentials')
  let value = ''
  try {
    const resolved = typeof credentials?.resolve === 'function' ? await credentials.resolve(account.ref) : undefined
    value = typeof resolved?.value === 'string' ? resolved.value : ''
  } catch {
    value = ''
  }
  if (value.length === 0) {
    const error = `credential "${account.ref}" is not configured`
    record(false, [], [], error)
    return { supported: true, ok: false, ref: account.ref, error }
  }
  try {
    const result = await probeProviderBalance({ key: value, provider, account })
    record(true, result.fields ?? [], result.meters ?? [], undefined)
    return { supported: true, ok: true, ref: account.ref }
  } catch (error) {
    const message = messageOf(error).slice(0, 300)
    record(false, [], [], message)
    return { supported: true, ok: false, ref: account.ref, error: message }
  }
}

/**
 * Refresh balances in the background when the snapshot is old, so the header
 * pill stays current without the page asking: the read answers immediately with
 * what is cached and the refresh lands on the next poll.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - this plugin's configuration.
 */
/**
 * Whether some configured account has no balance entry yet. A provider added
 * after the last probe round (a fresh OAuth sign-in, say) must not wait out the
 * staleness window before it can show a quota.
 */
function hasUnprobedAccount(config) {
  for (const provider of configuredProviders(config)) {
    if (!BALANCE_ADAPTERS.has(balanceKindFor(provider))) continue
    for (const account of Array.isArray(provider.accounts) ? provider.accounts : []) {
      if (typeof account?.ref !== 'string' || account.ref.length === 0) continue
      const entry = usage.balances[usageKey(provider.id, account.ref)]
      if (entry === undefined || entry.version !== BALANCE_SHAPE_VERSION) return true
    }
  }
  return false
}

function maybeRefreshBalances(ctx, config) {
  if (balanceProbeRunning) return undefined
  const missing = hasUnprobedAccount(config)
  // A missing (or outdated) entry means the provider, the account or this Host's
  // parsing is new; staleness alone must not hide a quota for five minutes.
  if (Date.now() - lastBalanceProbeAt < BALANCE_STALE_MS && !missing) return undefined
  balanceProbeRunning = true
  const round = refreshBalances(ctx, config)
    .then(() => {
      lastBalanceProbeAt = Date.now()
      saveUsage()
    })
    .catch((error) => warn(ctx, 'balance probe failed', error))
    .finally(() => { balanceProbeRunning = false })
  // Only a repair is worth waiting for; a plain staleness refresh stays in the
  // background so the snapshot answers immediately.
  return missing ? round : undefined
}

/**
 * Refresh every configured account's balance snapshot, tolerating individual
 * failures so one unreachable console never blanks the whole page.
 *
 * @param {object} ctx - plugin context (reads the credential service).
 * @param {object} config - this plugin's configuration.
 * @returns {Promise<number>} how many probes ran.
 */
async function refreshBalances(ctx, config) {
  const credentials = optionalService(ctx, 'credentials')
  let probed = 0
  for (const provider of configuredProviders(config)) {
    const kind = balanceKindFor(provider)
    if (!BALANCE_ADAPTERS.has(kind)) continue
    for (const account of Array.isArray(provider.accounts) ? provider.accounts : []) {
      if (typeof account?.ref !== 'string' || account.ref.length === 0) continue
      const key = usageKey(provider.id, account.ref)
      let outcome
      try {
        const resolved = credentials !== undefined && typeof credentials.resolve === 'function'
          ? await credentials.resolve(account.ref)
          : undefined
        const value = typeof resolved?.value === 'string' ? resolved.value : ''
        if (value.length === 0) throw new Error(`credential "${account.ref}" is not configured`)
        const result = await probeProviderBalance({ key: value, provider, account })
        outcome = { kind, ok: true, version: BALANCE_SHAPE_VERSION, fetchedAt: Date.now(), fields: result.fields ?? [], meters: result.meters ?? [], error: undefined }
      } catch (error) {
        outcome = { kind, ok: false, version: BALANCE_SHAPE_VERSION, fetchedAt: Date.now(), fields: [], meters: [], error: messageOf(error).slice(0, 300) }
      }
      usage.balances[key] = outcome
      probed += 1
    }
  }
  usageDirty = true
  lastBalanceProbeAt = Date.now()
  return probed
}

/**
 * The pi-ai profile a page-managed provider materializes as.
 *
 * A catalog route needs only its credential reference - pi-ai fills endpoint,
 * protocol and model catalog. A hand-declared route spells all three out, and
 * only the fields its provider entry actually carries are emitted.
 *
 * @param {object} provider - one providers[] entry.
 * @param {string} ref - credential reference of the account to serve.
 * @returns {object} the route profile written into llm-pi-ai.
 */
function routeProfileForProvider(provider, ref) {
  const profile = { apiKeyEnv: ref }
  if (typeof provider?.name === 'string' && provider.name.length > 0) profile.displayName = provider.name
  if (provider?.catalog === false) {
    if (typeof provider.api === 'string' && provider.api.length > 0) profile.api = provider.api
    if (typeof provider.baseURL === 'string' && provider.baseURL.length > 0) profile.baseURL = provider.baseURL
    if (Array.isArray(provider.models) && provider.models.length > 0) {
      profile.models = provider.models.filter((model) => typeof model?.id === 'string' && model.id.length > 0)
    }
  }
  return profile
}

/**
 * The account a provider should serve when its route has to be (re)created:
 * the first account whose last balance probe succeeded, else the first account
 * that has a reference. Balance success is the only health signal this Host
 * already holds, so a working account wins over a listed-but-refused one.
 *
 * @param {object} provider - one providers[] entry.
 * @returns {{ id: string, label: string, ref: string }|undefined} the account, if any.
 */
function preferredAccount(provider) {
  const accounts = Array.isArray(provider?.accounts) ? provider.accounts : []
  const usable = accounts.filter((account) => typeof account?.ref === 'string' && account.ref.length > 0)
  for (const account of usable) {
    const balance = usage.balances[usageKey(provider.id, account.ref)]
    if (balance !== undefined && balance.ok === true) return account
  }
  return usable[0]
}

/** Whether the credential service says one reference currently resolves to a value. */
async function refResolves(ctx, ref) {
  const credentials = optionalService(ctx, 'credentials')
  if (typeof credentials?.describe !== 'function') return true
  try {
    const info = await credentials.describe(ref)
    return info === undefined || info.configured !== false
  } catch {
    return true
  }
}

/**
 * Ensure every managed provider with at least one usable account has a live
 * llm-pi-ai route pointing at one of its references.
 *
 * Rules, in order: a missing route is created from the provider entry; an
 * existing route without apiKeyEnv is pointed at the preferred account; a route
 * whose reference no longer resolves is repointed. A healthy route is never
 * touched, so manual edits to models, headers or field order survive.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - this plugin's configuration.
 * @returns {Promise<number>} how many routes were created or repointed.
 */
async function ensureManagedRoutes(ctx, config) {
  const editor = optionalService(ctx, 'configEditor')
  if (typeof editor?.edit !== 'function' || typeof editor?.entries !== 'function') return 0
  const entry = editor.entries().find((row) => row?.options?.id === PI_AI_ENTRY_ID)
  if (entry === undefined) return 0

  const repairs = []
  for (const provider of configuredProviders(config)) {
    // This provider is served by our own adapter, so it must not gain a
    // pi-ai route: registering both would be a DUPLICATE_ADAPTER conflict.
    if (provider.id === GROK_PROVIDER) continue
    const accounts = (Array.isArray(provider.accounts) ? provider.accounts : [])
      .filter((account) => typeof account?.ref === 'string' && account.ref.length > 0)
    if (accounts.length === 0) continue
    const route = currentRouteProfile(entry.options?.config, provider)
    const ref = typeof route?.apiKeyEnv === 'string' && route.apiKeyEnv.length > 0 ? route.apiKeyEnv : undefined
    if (route === undefined) {
      const account = restoreAccount(provider)
      if (account !== undefined) repairs.push({ provider, action: 'create', ref: account.ref })
      continue
    }
    if (ref === undefined) {
      const account = restoreAccount(provider)
      if (account !== undefined) repairs.push({ provider, action: 'point', ref: account.ref })
      continue
    }
    if (await refResolves(ctx, ref)) {
      lastRefByProvider.set(provider.id, ref)
      if (typeof provider.name === 'string' && provider.name.length > 0
        && (typeof route.displayName !== 'string' || route.displayName.length === 0)) {
        repairs.push({ provider, action: 'label', ref })
      }
      continue
    }
    const account = restoreAccount(provider) ?? accounts[0]
    if (account.ref !== ref) repairs.push({ provider, action: 'repoint', ref: account.ref })
  }
  if (repairs.length === 0) return 0

  await editor.edit(entry, (current) => {
    const providers = current !== null && typeof current === 'object'
      && current.providers !== null && typeof current.providers === 'object'
      ? current.providers
      : {}
    const next = { ...providers }
    for (const { provider, action, ref } of repairs) {
      if (action === 'create') {
        next[provider.id] = routeProfileForProvider(provider, ref)
        continue
      }
      const profile = providers[provider.id] !== null && typeof providers[provider.id] === 'object'
        ? providers[provider.id]
        : {}
      const labeled = typeof provider.name === 'string' && provider.name.length > 0
        && (typeof profile.displayName !== 'string' || profile.displayName.length === 0)
        ? { displayName: provider.name }
        : {}
      next[provider.id] = action === 'label'
        ? { ...profile, ...labeled }
        : { ...profile, ...labeled, apiKeyEnv: ref }
    }
    return { ...current, providers: next }
  })
  for (const { provider, ref } of repairs) lastRefByProvider.set(provider.id, ref)
  ctx.logger?.warn?.('provider-accounts: repaired ' + repairs.length + ' llm-pi-ai route(s): '
    + repairs.map(({ provider, action, ref }) => provider.id + ' ' + action + ' -> ' + ref).join(', '))
  return repairs.length
}
// ---------------------------------------------------------------------------
// Account failover
// ---------------------------------------------------------------------------

/**
 * Point the route at its next untried account.
 *
 * The route's current `apiKeyEnv` names the attempt that just failed. Accounts
 * are scanned in list order after it, wrapping around, skipping every reference
 * already in `tried`. The chosen reference is written into the `llm-pi-ai` entry
 * through `configEditor.edit`, which persists the profile patch and resolves
 * after Loader reconciliation, so the following retry resolves the new key.
 *
 * @param {object} ctx - plugin context.
 * @param {object} provider - the provider whose call failed.
 * @param {Set<string>} tried - credential references already attempted for this request.
 * @param {number} maxHops - maximum account switches allowed for this request.
 * @param {object|undefined} failure - the terminal failure that triggered the hop.
 * @returns {Promise<object|undefined>} the switched-to account, or `undefined` when no hop is possible.
 */
async function switchAccount(ctx, provider, tried, maxHops, failure) {
  const accounts = (Array.isArray(provider?.accounts) ? provider.accounts : [])
    .filter((account) => typeof account?.ref === 'string' && account.ref.length > 0)
  if (accounts.length < 2) return undefined

  const editor = optionalService(ctx, 'configEditor')
  if (typeof editor?.edit !== 'function' || typeof editor?.entries !== 'function') return undefined
  const entry = editor.entries().find((row) => row?.options?.id === PI_AI_ENTRY_ID)
  if (entry === undefined) return undefined

  // The live route profile names the account this attempt used. Falling back to
  // the head of the list keeps the scan moving when the route has no apiKeyEnv
  // yet (custom route, first use).
  const route = currentRouteProfile(entry.options?.config, provider)
  const currentRefValue = typeof route?.apiKeyEnv === 'string' && route.apiKeyEnv.length > 0
    ? route.apiKeyEnv
    : accounts[0].ref

  // Each attempt contributes exactly one reference and `maxHops` counts
  // switches, so a budget of N allows N switches after the original attempt.
  tried.add(currentRefValue)
  if (tried.size > maxHops) return undefined

  const start = accounts.findIndex((account) => account.ref === currentRefValue)
  let candidate
  for (let step = 1; step <= accounts.length && candidate === undefined; step += 1) {
    // `start` may be -1 when the route points at a reference that is not a
    // stored account; the first probe then lands on accounts[0].
    const account = accounts[(start + step) % accounts.length]
    if (!tried.has(account.ref)) candidate = account
  }
  if (candidate === undefined) return undefined

  await editor.edit(entry, (current) => {
    const providers = current !== null && typeof current === 'object'
      && current.providers !== null && typeof current.providers === 'object'
      ? current.providers
      : {}
    const profile = providers[provider.id] !== null && typeof providers[provider.id] === 'object'
      ? providers[provider.id]
      : {}
    return { ...current, providers: { ...providers, [provider.id]: { ...profile, apiKeyEnv: candidate.ref } } }
  })
  recordSwitch(provider.id, currentRefValue, candidate.ref, failure)
  return candidate
}

/** Whether one terminal chunk is a failure this policy wants to retry. */
function isRetryableFinish(chunk, policy) {
  if (chunk?.type !== 'finish' || chunk.reason?.kind !== 'error') return false
  const code = chunk.reason.failure?.code
  return typeof code === 'string' && policy.codes.has(code)
}

/**
 * Wrap one model call in the account failover loop.
 *
 * The first attempt consumes the downstream `next()` stream. On a retryable
 * terminal failure before any content chunk, the route is switched to the next
 * untried account and the call is re-issued through `ctx.llm.stream`. The retry
 * carries {@link FAILOVER_STATE} so any other listener forwards it directly and
 * this loop, not a nested one, decides further hops. Exhausted hops yield the
 * original failure unchanged; successful calls are a chunk-for-chunk
 * pass-through. `for await` closes the upstream iterator when the consumer
 * returns or throws.
 *
 * @param {object} ctx - plugin context.
 * @param {object} provider - the provider named by the request.
 * @param {{ codes: Set<string>, maxHops: number }} policy - live failover policy.
 * @param {object} options - the original generate options, treated as immutable.
 * @param {() => AsyncIterable<object>} next - downstream `llm/stream` chain.
 * @returns {AsyncIterable<object>} the chunk stream.
 */
function failoverStream(ctx, provider, policy, options, next) {
  return (async function* failover() {
    const carried = options?.[FAILOVER_STATE]
    const tried = carried instanceof Set ? carried : new Set()
    let attempt = next

    for (;;) {
      let emittedContent = false
      let terminal

      for await (const chunk of attempt()) {
        if (chunk !== null && typeof chunk === 'object' && CONTENT_CHUNKS.has(chunk.type)) {
          emittedContent = true
        }
        // `finish` is terminal: decide about it before the caller observes it,
        // and never forward chunks that follow it.
        if (chunk?.type === 'finish') {
          terminal = chunk
          break
        }
        yield chunk
      }

      if (terminal === undefined) return

      if (!emittedContent && options?.signal?.aborted !== true && isRetryableFinish(terminal, policy)) {
        try {
          const failure = terminal.reason?.failure
          const account = await switchAccount(ctx, provider, tried, policy.maxHops, failure)
          if (account !== undefined) {
            const retryStream = ctx.llm.stream({ ...options, [FAILOVER_STATE]: tried })
            attempt = () => retryStream
            continue
          }
        } catch (error) {
          // A failed switch (concurrent edit, Loader refusal, …) must surface as
          // the model error the caller expected, not as a plugin crash.
          warn(ctx, 'account switch failed, forwarding the model error', error)
        }
      }

      yield terminal
      return
    }
  })()
}

/**
 * Wrap one model call in the usage ledger.
 *
 * Registered *inside* the failover listener (Cordis runs the first-registered
 * waterfall listener outermost), so it observes every attempt — including the
 * failure the outer loop is about to retry — and attributes it to the account
 * the route resolved for that attempt.
 *
 * @param {object} provider - the provider named by the request.
 * @param {string} ref - the credential reference this attempt resolves.
 * @param {() => AsyncIterable<object>} next - downstream `llm/stream` chain.
 * @returns {AsyncIterable<object>} the unchanged chunk stream.
 */
function usageStream(provider, ref, next) {
  return (async function* accounting() {
    let tokenUsage
    let failure
    recordAttempt(provider.id, ref)
    try {
      for await (const chunk of next()) {
        if (chunk !== null && typeof chunk === 'object') {
          if (chunk.type === 'usage' && chunk.usage !== undefined) tokenUsage = chunk.usage
          else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') failure = chunk.reason.failure
        }
        yield chunk
      }
    } finally {
      // The failure wrapper breaks at the terminal chunk, which closes this
      // iterator: only a finally block can still account the attempt.
      recordOutcome(provider.id, ref, tokenUsage, failure)
    }
  })()
}

/** JSON response for the page's exact Fetch routes. */
function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Plugin entry point.
 *
 * Registers the config schema, opts out of the auto-generated settings page,
 * installs the usage ledger with its two read routes, and installs the failover
 * listener. Every configuration read happens per request through the volatile
 * references, so page edits and the failover toggle take effect without
 * reloading the plugin.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - validated {@link Config} value holding volatile references.
 */
export function apply(ctx, config) {
  const providers = configuredProviders(config)
  const accountCount = providers.reduce(
    (total, provider) => total + (Array.isArray(provider.accounts) ? provider.accounts.length : 0),
    0,
  )
  ctx.logger?.info?.(
    `provider-accounts: ${providers.length} provider(s), ${accountCount} account(s); `
    + `automatic failover ${failoverPolicy(config).enabled ? 'enabled' : 'disabled'}`,
  )

  loadUsage()
  ctx.effect(() => {
    const timer = setInterval(saveUsage, USAGE_FLUSH_MS)
    return () => {
      clearInterval(timer)
      saveUsage()
    }
  }, 'provider-accounts: usage ledger flush')

  // Self-healing routes: the page owns the provider list, so the routes it names
  // must exist even if another surface removed one. Adapter updates signal that
  // the route set changed; our own config changes arrive as volatile updates.
  // Repairs are debounced and a healthy route is left untouched, so the loop
  // settles after one pass.
  let reconcileTimer = null
  let reconcileRunning = false
  const runReconcile = () => {
    if (reconcileRunning) {
      reconcileTimer = setTimeout(runReconcile, 200)
      return
    }
    reconcileRunning = true
    void ensureManagedRoutes(ctx, config)
      .catch((error) => warn(ctx, 'route repair failed', error))
      .finally(() => { reconcileRunning = false })
  }
  const scheduleReconcile = () => {
    if (reconcileTimer !== null) return
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      runReconcile()
    }, 150)
  }
  ctx.effect(() => () => {
    if (reconcileTimer !== null) clearTimeout(reconcileTimer)
    reconcileTimer = null
  }, 'provider-accounts: route repair timer')
  // Native Grok Build: the plugin owns the OAuth session and the protocol, so
  // the route exists as long as this plugin is mounted.
  ctx.effect(() => {
    // A stale route with the same name (an older hand-declared `grok-build` route)
    // would make registration throw; keep the rest of the plugin alive and say so.
    try {
      return ctx.llm.registerAdapter([GROK_PROVIDER], bindGrokAdapter(createGrokAdapter(), ctx))
    } catch (error) {
      warn(ctx, 'grok build adapter registration failed', error)
      return () => {}
    }
  }, 'provider-accounts: grok build adapter')

  ctx.inject(['connection'], (child) => {
    if (typeof child.connection?.fetch?.register !== 'function') return
    const route = (path, methods, handler) => child.effect(() => child.connection.fetch.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          return jsonResponse(await handler(request))
        } catch (error) {
          return jsonResponse({ ok: false, error: messageOf(error).slice(0, 300) })
        }
      },
    }))
    const body = async (request) => {
      try {
        const parsed = await request.json()
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }
    route(GROK_ROUTE + '/start', ['POST'], async () => ({ ok: true, device: await startGrokDevice() }))
    route(GROK_ROUTE + '/poll', ['POST'], async (request) => {
      const input = await body(request)
      const deviceCode = typeof input.deviceCode === 'string' ? input.deviceCode : ''
      if (deviceCode.length === 0) return { ok: false, error: 'missing deviceCode' }
      const result = await pollGrokDevice(ctx, deviceCode)
      return { ok: true, ...result }
    })
    route(GROK_ROUTE + '/status', ['GET'], async () => {
      const tokens = await readGrokTokens(ctx)
      if (tokens === undefined) return { ok: true, signedIn: false }
      const fresh = await ensureGrokTokens(ctx)
      let billing
      try {
        billing = await grokBillingFromBundle(JSON.stringify(fresh ?? tokens))
      } catch {
        billing = undefined
      }
      return {
        ok: true,
        signedIn: true,
        email: tokens.email,
        userId: tokens.userId,
        expiresAt: (fresh ?? tokens).expiresAt,
        plan: billing?.plan,
        quota: billing === undefined ? undefined : {
          percent: billing.percent,
          period: billing.periodKind,
          periodEnd: billing.periodEnd,
        },
      }
    })
    route(GROK_ROUTE + '/probe', ['POST'], async () => ({ ok: true, probe: await probeGrok(ctx) }))
    route(GROK_ROUTE + '/logout', ['POST'], async () => {
      await clearGrokTokens(ctx)
      return { ok: true }
    })
  })

  ctx.on('llm/adapters-updated', scheduleReconcile)
  ctx.on('loader/volatile-update', scheduleReconcile)
  scheduleReconcile()

  // The page owns this namespace, so the generic generated form stays hidden.
  // `settings` is an optional service outside the desktop profile, hence the
  // nested-injection pattern.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // Read surface for the usage page: authenticated exact Fetch routes on the
  // `/api` bridge, so the browser needs no Remote contribution of its own.
  ctx.inject(['connection'], (child) => {
    if (typeof child.connection?.fetch?.register !== 'function') return
    child.effect(() => child.connection.fetch.register({
      path: USAGE_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const repair = maybeRefreshBalances(ctx, config)
        if (repair !== undefined) {
          await Promise.race([repair, new Promise((resolve) => setTimeout(resolve, 4_000))])
        }
        return jsonResponse(usageSnapshot(ctx, config))
      },
    }))
    child.effect(() => child.connection.fetch.register({
      path: TEST_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body = {}
        try {
          body = await request.json()
        } catch {
          body = {}
        }
        const providerId = body !== null && typeof body === 'object' && typeof body.providerId === 'string' ? body.providerId : ''
        if (providerId.length === 0) return jsonResponse({ supported: false, reason: 'bad-request' })
        const ref = body !== null && typeof body === 'object' && typeof body.ref === 'string' && body.ref.length > 0 ? body.ref : undefined
        return jsonResponse(await testAccountKey(ctx, config, providerId, ref))
      },
    }))
    child.effect(() => child.connection.fetch.register({
      path: BALANCE_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          await refreshBalances(ctx, config)
          saveUsage()
        } catch (error) {
          warn(ctx, 'balance refresh failed', error)
        }
        return jsonResponse(usageSnapshot(ctx, config))
      },
    }))
    // A cold start probes balances once so the page opens with a number when
    // the provider console answers; a failure is just a redacted inline note.
    void refreshBalances(ctx, config).then(saveUsage).catch((error) => warn(ctx, 'balance probe failed', error))
  })

  ctx.on('llm/stream', (options, next) => {
    try {
      // An internal retry re-enters the waterfall: the outer failover loop owns
      // the hop budget, so this pass is a plain pass-through.
      if (options?.[FAILOVER_STATE] !== undefined) return next()

      const providerId = options?.provider
      if (typeof providerId !== 'string' || providerId.length === 0) return next()

      // Common path: routes this plugin does not manage cost one list scan.
      const provider = configuredProviders(config).find((candidate) => candidate.id === providerId)
      if (provider === undefined) return next()

      const accounts = Array.isArray(provider.accounts) ? provider.accounts : []
      if (accounts.length < 2) return next()

      const policy = failoverPolicy(config)
      if (!policy.enabled) return next()

      return failoverStream(ctx, provider, policy, options, next)
    } catch (error) {
      warn(ctx, 'failover setup failed, forwarding the request untouched', error)
      return next()
    }
  })

  // Accounting is the innermost listener, so it sees every attempt's chunks.
  ctx.on('llm/stream', (options, next) => {
    try {
      const providerId = options?.provider
      if (typeof providerId !== 'string' || providerId.length === 0) return next()
      const provider = configuredProviders(config).find((candidate) => candidate.id === providerId)
      if (provider === undefined) return next()
      const ref = currentRef(ctx, provider)
      if (typeof ref !== 'string' || ref.length === 0) return next()
      return usageStream(provider, ref, next)
    } catch (error) {
      warn(ctx, 'usage accounting failed, forwarding the request untouched', error)
      return next()
    }
  })
}

/** Required: failover re-issues the call through `ctx.llm.stream`. */
export const inject = ['llm']
