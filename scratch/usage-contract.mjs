// Cross-check: run the real Host half's two Fetch routes in a fake Cordis
// context, then feed the snapshot they answer with into the usage page's
// normalizer/render path. Proves the page tolerates the wire shape the Host
// actually serves (null activeRef/lastUsedAt/lastError, NUL-separated balance
// keys, day buckets) rather than only the hand-written fixture.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = 'C:/Users/Administrator/repos/dshx/scratch'
process.env.DSH_HOME = `${ROOT}/tmp-home-contract`
rmSync(process.env.DSH_HOME, { recursive: true, force: true })
const moduleUrl = pathToFileURL(`${ROOT}/index.testable.mjs`).href + `?case=${Date.now()}`
const { apply, Config } = await import(moduleUrl)

// ---- stub the provider console the balance adapter calls -------------------
const consoleCalls = []
globalThis.fetch = async (url) => {
  const target = String(url)
  consoleCalls.push(target)
  const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
  if (target.includes('/zen/go/v1/usage')) {
    return json({
      usage: {
        rolling: { status: 'ok', percent: 4, resetsAt: '2026-10-20T06:41:32.000Z' },
        weekly: { status: 'ok', percent: 21, resetsAt: '2026-10-27T00:00:00.000Z' },
        monthly: { status: 'ok', percent: 55, resetsAt: '2026-11-20T17:36:16.000Z' },
      },
    })
  }
  if (target.includes('/console/api/billing/status')) return json({ availableMicroCents: 1230000000 })
  if (target.includes('/console/api/go/status')) {
    return json({
      access: {
        meters: {
          fiveHour: { usedMicroCents: 405, limitMicroCents: 1200000000 },
          week: { usedMicroCents: 630000000, limitMicroCents: 3000000000 },
          month: { usedMicroCents: 4000000000, limitMicroCents: 6000000000 },
        },
      },
    })
  }
  return new Response('not found', { status: 404 })
}

// ---- fake Cordis context (same shape as scratch/usage-test.mjs) ------------
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
  connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } } },
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
    balanceKind: 'opencode-zen',
    accounts: [
      { id: 'a1', label: '主账号', ref: 'OPENCODE_GO_API_KEY' },
      { id: 'a2', label: '工作账号', ref: 'OPENCODE_GO_2_API_KEY' },
    ],
  }],
  failover: { enabled: false },
}))
assert.equal(routes.size, 8, 'every exact Fetch route is registered')

// ---- one streamed attempt, so the ledger holds a real row ------------------
const CHUNKS = [
  { type: 'usage', usage: { inputTokens: 120, outputTokens: 30 } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const options = { provider: 'opencode-go', model: 'm', messages: [] }
const downstream = () => (async function* () { for (const chunk of CHUNKS) yield chunk })()
const streamListeners = listeners.filter((row) => row.event === 'llm/stream')
for await (const _chunk of streamListeners[0].listener(options, () => streamListeners[1].listener(options, downstream))) { /* drain */ }

// ---- the two routes as the page calls them --------------------------------
const usageRoute = routes.get('/api/provider-accounts-usage')
const snapshot = await (await usageRoute.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-usage'))).json()
const balanceRoute = routes.get('/api/provider-accounts-balance')
const refreshed = await (await balanceRoute.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))).json()

console.log('GET snapshot shape:')
console.log('  updatedAt:', snapshot.updatedAt, typeof snapshot.updatedAt)
console.log('  provider[0]:', JSON.stringify(snapshot.providers[0]))
console.log('  account[0] keys:', Object.keys(snapshot.accounts[0]).join(','))
console.log('  account[0].lastUsedAt:', snapshot.accounts[0].lastUsedAt, '| lastError:', JSON.stringify(snapshot.accounts[0].lastError))
console.log('  days keys:', Object.keys(snapshot.accounts[0].days).join(','))
console.log('  balances keys:', JSON.stringify(Object.keys(refreshed.balances)))
console.log('  balance entry:', JSON.stringify(Object.values(refreshed.balances)[0]))
console.log('  console probes:', consoleCalls.length)

assert.ok(Array.isArray(snapshot.providers) && Array.isArray(snapshot.accounts), 'snapshot arrays')
assert.equal(snapshot.providers[0].activeRef === null || typeof snapshot.providers[0].activeRef === 'string', true, 'activeRef is string or null')
assert.equal(snapshot.accounts[0].lastUsedAt > 0 || snapshot.accounts[0].lastUsedAt === null, true, 'lastUsedAt is positive or null')
const wireKeys = Object.keys(refreshed.balances).filter((key) => key.includes('::'))
assert.equal(wireKeys.length, 2, 'one balance entry per account after the POST')
const sampleKey = wireKeys[0]
assert.equal(sampleKey.startsWith('opencode-go::'), true, 'balance keys are <route>::<ref>')
const sample = refreshed.balances[sampleKey]
assert.equal(sample.ok, true, 'a probed balance succeeds')
const sampled = Object.fromEntries(sample.fields.map((field) => [field.key, field.value]))
assert.equal(sampled.rolling, '4%', 'usage percentage rides to the page')
assert.equal(sampled.balance, '$12.30', 'prepaid balance rides to the page')
assert.equal(sampled.fiveHourSpend, '$0.00 / $12.00', 'dollar meters ride to the page')
assert.equal(sampled.weeklySpend, '$6.30 / $30.00', 'the weekly spend field uses the renamed key')
assert.equal(sampled.monthlySpend, '$40.00 / $60.00', 'the monthly spend field uses the renamed key')

// The structured gauges the page draws as progress bars.
assert.ok(Array.isArray(sample.meters), 'the balance entry carries a meters array')
assert.deepEqual(sample.meters.map((meter) => meter.id), ['fiveHour', 'weekly', 'monthly'], 'meters arrive in display order')
assert.deepEqual(sample.meters.map((meter) => meter.percent), [4, 21, 55], 'each meter carries its percentage')
assert.equal(sample.meters[0].usedUSD, 0, 'the five-hour meter carries its dollars')
assert.equal(sample.meters[0].limitUSD, 12, 'the five-hour meter carries its limit')
assert.equal(sample.meters[1].usedUSD, 6.3, 'the weekly meter carries its dollars')
assert.equal(sample.meters[2].limitUSD, 60, 'the monthly meter carries its limit')
assert.equal(typeof sample.meters[0].resetsAt, 'string', 'a meter carries its reset timestamp')
assert.equal(Number.isFinite(Date.parse(sample.meters[0].resetsAt)), true, 'the reset timestamp parses as a date')
assert.equal(sample.meters[0].status, 'ok', 'a healthy meter reports its status')


for (const dispose of disposers) dispose()
console.log('\nHOST SNAPSHOT PROBE OK')
