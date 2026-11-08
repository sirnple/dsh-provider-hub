// Scratch behavioral harness for the usage ledger + its two Fetch routes.
// Every scenario imports a fresh module instance (module-level ledger state) so
// assertions stay independent; persistence scenarios share one temporary home.
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'

const ROOT = 'C:/Users/Administrator/repos/dsh-provider-accounts/scratch'
const moduleUrl = new URL('index.testable.mjs', import.meta.url).href
let sequence = 0

/** A fresh copy of the plugin module, so its in-memory ledger starts empty. */
async function freshModules() {
  sequence += 1
  return await import(`${moduleUrl}?case=${sequence}`)
}

/**
 * Apply the real plugin against a fake Cordis context.
 * @param where - temporary Harness home for this scenario.
 * @returns listeners, exact Fetch routes, disposers.
 */
async function makeHost(where, options = {}) {
  process.env.DSH_HOME = where
  if (options.clean !== false) rmSync(where, { recursive: true, force: true })
  const { apply, Config } = await freshModules()
  const listeners = []
  const routes = new Map()
  const disposers = []
  const piEntry = {
    options: { id: 'llm-pi-ai', config: { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } } },
  }
  const effect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  }
  const child = {
    effect,
    fiber: {},
    settings: { configure: () => () => {} },
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    },
  }
  const ctx = {
    fiber: {},
    logger: { info() {}, warn() {} },
    get: (service) => {
      if (service === 'configEditor') return { entries: () => [piEntry], edit: async () => undefined }
      if (service === 'credentials') return { resolve: async () => ({ value: 'sk-not-real' }) }
      return undefined
    },
    effect,
    inject: (deps, callback) => callback(child),
    on: (event, listener) => { listeners.push({ event, listener }) },
    llm: { registerAdapter: () => () => {}, stream: () => { throw new Error('no failover expected in this harness') } },
  }
  apply(ctx, Config({
    providers: [{
      id: 'opencode-go',
      name: 'OpenCode Go',
      catalog: true,
      ...(options.balanceKind === undefined ? { balanceKind: 'none' } : { balanceKind: options.balanceKind }),
      accounts: [
        { id: 'a1', label: '主账号', ref: 'OPENCODE_GO_API_KEY' },
        { id: 'a2', label: '工作账号', ref: 'OPENCODE_GO_2_API_KEY' },
      ],
    }],
    failover: { enabled: false },
  }))
  const streamListeners = listeners.filter((row) => row.event === 'llm/stream')
  assert.equal(streamListeners.length, 2, 'two llm/stream listeners')
  assert.equal(routes.size, 8, 'every exact Fetch route is registered')
  return { listeners, streamListeners, routes, disposers }
}

const USAGE_CHUNKS = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hello' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, reasoningTokens: 3 } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const FAILURE_CHUNKS = [
  { type: 'usage', usage: { inputTokens: 5, outputTokens: 0 } },
  { type: 'finish', reason: { kind: 'error', failure: { message: 'quota exhausted', code: 'QUOTA' } } },
]

/** Run one chunk script through the real listener chain. */
async function runStream(host, chunks, provider = 'opencode-go') {
  const options = { provider, model: 'm', messages: [] }
  const downstream = () => (async function* () { for (const chunk of chunks) yield chunk })()
  const out = []
  for await (const chunk of host.streamListeners[0].listener(options, () => host.streamListeners[1].listener(options, downstream))) out.push(chunk)
  return out
}

/** Read the page's GET snapshot. */
async function readSnapshot(host) {
  const route = host.routes.get('/api/provider-accounts-usage')
  assert.equal(typeof route?.fetch, 'function', 'GET route registered')
  const response = await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-usage'))
  assert.equal(response.status, 200)
  return await response.json()
}

// --- 1. A successful stream is accounted to the active account ---------------
{
  const host = await makeHost(`${ROOT}/tmp-home-usage-1`)
  const out = await runStream(host, USAGE_CHUNKS)
  assert.deepEqual(out, USAGE_CHUNKS, 'chunks pass through unchanged')
  const snapshot = await readSnapshot(host)
  assert.equal(snapshot.accounts.length, 2, 'one row per configured account')
  const row = snapshot.accounts.find((account) => account.ref === 'OPENCODE_GO_API_KEY')
  assert.equal(row.active, true, 'route apiKeyEnv marks the active account')
  assert.equal(row.requests, 1)
  assert.equal(row.input, 100)
  assert.equal(row.output, 20)
  assert.equal(row.cacheRead, 7)
  assert.equal(row.reasoning, 3)
  assert.equal(row.failures, 0)
  assert.ok(row.lastUsedAt > 0)
  const today = Object.keys(row.days)[0]
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(row.days[today].requests, 1)
  assert.equal(row.days[today].input, 100)
  assert.equal(snapshot.providers[0].id, 'opencode-go')
  assert.equal(snapshot.providers[0].activeRef, 'OPENCODE_GO_API_KEY')
  assert.deepEqual(snapshot.balances, {})
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 1 successful stream accounted to the active account')
}

// --- 2. A terminal failure is recorded with its code -------------------------
{
  const host = await makeHost(`${ROOT}/tmp-home-usage-2`)
  await runStream(host, FAILURE_CHUNKS)
  const snapshot = await readSnapshot(host)
  const row = snapshot.accounts.find((account) => account.ref === 'OPENCODE_GO_API_KEY')
  assert.equal(row.requests, 1)
  assert.equal(row.failures, 1)
  assert.equal(row.lastError.code, 'QUOTA')
  assert.equal(row.input, 5)
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 2 terminal failure recorded with its code')
}

// --- 3. Unmanaged providers are not counted ---------------------------------
{
  const host = await makeHost(`${ROOT}/tmp-home-usage-3`)
  await runStream(host, USAGE_CHUNKS, 'deepseek-official')
  const snapshot = await readSnapshot(host)
  const total = snapshot.accounts.reduce((sum, account) => sum + account.requests, 0)
  assert.equal(total, 0, 'unmanaged route leaves the ledger alone')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 3 unmanaged providers are not counted')
}

// --- 4. The ledger persists to the Harness home ------------------------------
{
  const home = `${ROOT}/tmp-home-usage-4`
  const host = await makeHost(home)
  await runStream(host, USAGE_CHUNKS)
  host.disposers.forEach((dispose) => dispose())
  const parsed = JSON.parse(readFileSync(`${home}/storages/provider-accounts/usage.json`, 'utf8'))
  assert.equal(parsed.version, 1)
  const key = 'opencode-go::OPENCODE_GO_API_KEY'
  assert.ok(parsed.accounts[key], 'row persisted')
  assert.equal(parsed.accounts[key].input, 100)
  assert.ok(parsed.updatedAt > 0)
  console.log('ok 4 ledger persisted to $DSH_HOME/storages/provider-accounts/usage.json')
}

// --- 5. A fresh activation reloads the persisted rows ------------------------
{
  const home = `${ROOT}/tmp-home-usage-5`
  const first = await makeHost(home)
  await runStream(first, USAGE_CHUNKS)
  first.disposers.forEach((dispose) => dispose())

  const second = await makeHost(home, { clean: false }) // new module instance, same home
  const snapshot = await readSnapshot(second)
  const row = snapshot.accounts.find((account) => account.ref === 'OPENCODE_GO_API_KEY')
  assert.equal(row.requests, 1, 'persisted requests reloaded')
  assert.equal(row.input, 100, 'persisted tokens reloaded')
  second.disposers.forEach((dispose) => dispose())
  console.log('ok 5 a fresh activation reloads persisted usage')
}

// --- 6. The balance route answers even with no adapter -----------------------
{
  const host = await makeHost(`${ROOT}/tmp-home-usage-6`)
  const route = host.routes.get('/api/provider-accounts-balance')
  assert.equal(typeof route?.fetch, 'function', 'POST route registered')
  const response = await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(Array.isArray(body.accounts))
  assert.deepEqual(body.balances, {})
  host.disposers.forEach((dispose) => dispose())
  console.log('ok 6 balance route answers without a provider adapter')
}

// --- 7. The OpenCode adapter turns the provider payload into balance fields --
{
  const realFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    seen.push({ target, authorization: init?.headers?.authorization })
    if (target.includes('/zen/go/v1/usage')) {
      return new Response(JSON.stringify({
        usage: {
          rolling: { status: 'ok', percent: 0, resetsAt: '2026-10-20T06:41:32.000Z' },
          weekly: { status: 'ok', percent: 12.5, resetsAt: '2026-10-27T00:00:00.000Z' },
          monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-20T17:36:16.000Z' },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('/console/api/billing/status')) {
      return new Response(JSON.stringify({ availableMicroCents: 1230000000, mode: 'prepaid' }), { status: 200 })
    }
    if (target.includes('/console/api/go/status')) {
      return new Response(JSON.stringify({
        access: {
          meters: {
            fiveHour: { usedMicroCents: 405, limitMicroCents: 1200000000, resetsAt: '2026-10-20T06:41:32Z' },
            week: { usedMicroCents: 405, limitMicroCents: 3000000000 },
            month: { usedMicroCents: 405, limitMicroCents: 6000000000 },
          },
        },
      }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
  try {
    const host = await makeHost(`${ROOT}/tmp-home-usage-7`, { balanceKind: 'opencode-zen' })
    const route = host.routes.get('/api/provider-accounts-balance')
    const response = await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))
    assert.equal(response.status, 200)
    const body = await response.json()
    const key = 'opencode-go::OPENCODE_GO_API_KEY'
    const balance = body.balances[key]
    assert.ok(balance, 'balance row exists for the active account')
    assert.equal(balance.ok, true, 'adapter succeeded')
    assert.equal(balance.kind, 'opencode-zen')
    const fields = Object.fromEntries(balance.fields.map((field) => [field.key, field.value]))
    assert.equal(fields.rolling, '0%')
    assert.equal(fields.weekly, '12.5%')
    assert.equal(fields.monthly, '100%')
    assert.equal(fields.balance, '$12.30')
    assert.equal(fields.fiveHourSpend, '$0.00 / $12.00')
    assert.equal(fields.weeklySpend, '$0.00 / $30.00')
    assert.equal(fields.monthlyStatus, 'rate-limited')
    assert.equal(fields.weeklyReset, '2026-10-27T00:00:00.000Z')
    // Structured gauges: the page draws these as progress bars.
    assert.ok(Array.isArray(balance.meters), 'balance carries structured meters')
    const gauge = Object.fromEntries(balance.meters.map((meter) => [meter.id, meter]))
    assert.deepEqual(Object.keys(gauge).sort(), ['fiveHour', 'monthly', 'weekly'])
    assert.equal(gauge.fiveHour.percent, 0, 'gauge fiveHour percent')
    assert.equal(gauge.weekly.percent, 12.5, 'gauge weekly percent')
    assert.equal(gauge.monthly.percent, 100, 'gauge monthly percent')
    assert.equal(gauge.monthly.status, 'rate-limited', 'gauge monthly status')
    assert.equal(gauge.weekly.resetsAt, '2026-10-27T00:00:00.000Z', 'gauge weekly reset')
    assert.equal(gauge.fiveHour.usedUSD, 0, 'gauge fiveHour used dollars')
    assert.equal(gauge.fiveHour.limitUSD, 12, 'gauge fiveHour limit dollars')
    assert.equal(gauge.weekly.limitUSD, 30, 'gauge weekly limit dollars')
    assert.equal(gauge.monthly.limitUSD, 60, 'gauge monthly limit dollars')
    const usageCalls = seen.filter((call) => call.target.includes('/zen/go/v1/usage'))
    assert.ok(usageCalls.length >= 1, 'usage endpoint probed')
    assert.equal(usageCalls[0].authorization, 'Bearer sk-not-real', 'credential forwarded as a bearer token')
    host.disposers.forEach((dispose) => dispose())
    console.log('ok 7 OpenCode adapter maps usage, dollars and balance')
  } finally {
    globalThis.fetch = realFetch
  }
}

// --- 8. A refused probe is recorded, not thrown ------------------------------
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 })
  try {
    const host = await makeHost(`${ROOT}/tmp-home-usage-8`, { balanceKind: 'opencode-zen' })
    const route = host.routes.get('/api/provider-accounts-balance')
    const response = await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))
    assert.equal(response.status, 200, 'route still answers')
    const body = await response.json()
    const key = 'opencode-go::OPENCODE_GO_API_KEY'
    assert.equal(body.balances[key].ok, false)
    assert.match(body.balances[key].error, /401/)
    host.disposers.forEach((dispose) => dispose())
    console.log('ok 8 a refused probe is recorded, not thrown')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('\nALL USAGE CHECKS PASSED')
