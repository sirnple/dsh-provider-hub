// Two Host regressions found while diagnosing the xAI report:
//  A. tokens must be recorded even when the failover wrapper stops at `finish`
//     (that wrapper closes the accounting iterator, so only a finally block runs).
//  B. the xAI probe reports key validity and that no quota API exists.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'

const ROOT = 'C:/Users/Administrator/repos/dsh-provider-hub/scratch'
const moduleUrl = new URL('index.testable.mjs', import.meta.url).href
let sequence = 0
async function freshModules() {
  sequence += 1
  return await import(`${moduleUrl}?xai=${sequence}`)
}

const ROOT_DIR = `${ROOT}/tmp-xai`
rmSync(ROOT_DIR, { recursive: true, force: true })
process.env.DSH_HOME = ROOT_DIR

/** Fake Cordis context, mirroring scratch/usage-test.mjs. */
async function makeHost(config, options = {}) {
  const { apply, Config } = await freshModules()
  const listeners = []
  const routes = new Map()
  const disposers = []
  const piEntry = { options: { id: 'llm-pi-ai', config: { providers: {} } } }
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
      if (service === 'configEditor') return { entries: () => [piEntry], edit: async (entry, change) => { entry.options.config = change(structuredClone(entry.options.config), {}) } }
      if (service === 'credentials') return { resolve: async () => ({ value: 'xai-key-not-real', configured: true }) }
      return undefined
    },
    effect,
    inject: (deps, callback) => callback(child),
    on: (event, listener) => { listeners.push({ event, listener }) },
    llm: { registerAdapter: () => () => {},
      stream: (options) => {
        const streamListeners = listeners.filter((row) => row.event === 'llm/stream')
        return streamListeners[1].listener(options, () => options[optionsFallback] ?? (async function* () {})())
      },
    },
  }
  const optionsFallback = Symbol('backend')
  apply(ctx, Config(config))
  const streamListeners = listeners.filter((row) => row.event === 'llm/stream')
  return { listeners, streamListeners, routes, disposers, piEntry, ctx }
}

async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

// ---- A. failover enabled, consumer stops at `finish` ------------------------
{
  const host = await makeHost({
    providers: [{
      id: 'opencode-go',
      name: 'OpenCode Go',
      catalog: true,
      accounts: [
        { id: 'a1', label: '主账号', ref: 'OPENCODE_GO_API_KEY' },
        { id: 'a2', label: '工作账号', ref: 'OPENCODE_GO_2_API_KEY' },
      ],
    }],
    failover: { enabled: true, codes: ['QUOTA'], maxHops: 2 },
  })
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'hi' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
    { type: 'usage', usage: { inputTokens: 321, outputTokens: 45 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const options = { provider: 'opencode-go', model: 'm', messages: [] }
  // The failover listener is outermost; it stops reading at `finish`.
  const raw = () => (async function* () { for (const chunk of chunks) yield chunk })()
  // Production order: failover (outer) -> accounting (inner) -> adapter.
  const got = await collect(host.streamListeners[0].listener(options, () => host.streamListeners[1].listener(options, raw)))
  assert.deepEqual(got, chunks, 'the consumer sees every chunk')
  const usageRoute = host.routes.get('/api/provider-accounts-usage')
  const snapshot = await (await usageRoute.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-usage'))).json()
  const row = snapshot.accounts.find((account) => account.ref === 'OPENCODE_GO_API_KEY')
  assert.equal(row.requests, 1, 'the attempt is counted')
  assert.equal(row.input, 321, 'input tokens are recorded despite the early stop')
  assert.equal(row.output, 45, 'output tokens are recorded despite the early stop')
  host.disposers.forEach((dispose) => dispose())
  console.log('ok A tokens survive the failover early stop')
}

// ---- B. xAI probe: valid key, then a rejected key ---------------------------
{
  const realFetch = globalThis.fetch
  const calls = []
  let mode = 'ok'
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, authorization: init?.headers?.authorization })
    if (mode === 'ok') {
      if (target.endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'grok-4' }, { id: 'grok-3' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ name: 'default', created: '2025-01-01T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.endsWith('/v1/api-key')) {
      return new Response(JSON.stringify({ team_id: 'team-1', team_blocked: true, api_key_blocked: false }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ code: 'permission-denied', error: 'Your team has used all available credits or reached its monthly spending limit.' }), { status: 403, headers: { 'content-type': 'application/json' } })
  }
  try {
    const host = await makeHost({
      providers: [{
        id: 'xai',
        name: 'xAI',
        catalog: true,
        accounts: [{ id: 'a1', label: 'Grok', ref: 'XAI_API_KEY' }],
      }, {
        id: 'anthropic',
        name: 'Anthropic',
        catalog: true,
        accounts: [{ id: 'b1', label: 'Claude', ref: 'ANTHROPIC_API_KEY' }],
      }],
      failover: { enabled: false },
    })
    const route = host.routes.get('/api/provider-accounts-balance')
    const first = await (await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))).json()
    const key = 'xai::XAI_API_KEY'
    const entry = first.balances[key]
    assert.ok(entry, 'xAI gets a balance entry')
    assert.equal(entry.kind, 'xai', 'the probe is inferred from the route id')
    assert.equal(entry.ok, true, 'a valid key is reported as ok')
    assert.deepEqual(entry.meters, [], 'xAI publishes no quota windows')
    const fields = Object.fromEntries(entry.fields.map((field) => [field.key, field.value]))
    assert.equal(fields.status, 'active', 'the probe reports the key status')
    assert.equal(fields.keyName, 'default', 'the probe reports the key name')
    assert.equal(fields.modelCount, '2', 'the probe reports how many models the key can list')
    assert.equal(calls[0]?.url, 'https://api.x.ai/v1/models', 'the probe asks the endpoint that reports usability')

    mode = 'rejected'
    const second = await (await route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))).json()
    const rejected = second.balances[key]
    assert.equal(rejected.ok, false, 'an exhausted team is recorded as a failure')
    assert.match(rejected.error, /credits|spending limit/, 'the provider message reaches the page')
    assert.match(rejected.error, /^team_blocked · /, 'a blocked team is named before the provider message')
    host.disposers.forEach((dispose) => dispose())
    console.log('ok B xAI probe reports key status, then the refusal')
  } finally {
    globalThis.fetch = realFetch
  }
}

// ---- C. the explicit key-test route -------------------------------------
{
  const realFetch = globalThis.fetch
  let mode = 'ok'
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (mode === 'ok') {
      if (target.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'grok-4' }] }), { status: 200 })
      return new Response(JSON.stringify({ name: 'default' }), { status: 200 })
    }
    if (target.endsWith('/v1/api-key')) return new Response(JSON.stringify({ team_blocked: true }), { status: 200 })
    return new Response(JSON.stringify({ error: 'Your team has used all available credits or reached its monthly spending limit.' }), { status: 403 })
  }
  try {
    const host = await makeHost({
      providers: [
        { id: 'xai', name: 'xAI', catalog: true, accounts: [{ id: 'a1', label: 'Grok', ref: 'XAI_API_KEY' }] },
        { id: 'anthropic', name: 'Anthropic', catalog: true, accounts: [{ id: 'b1', label: 'Claude', ref: 'ANTHROPIC_API_KEY' }] },
      ],
      failover: { enabled: false },
    })
    const route = host.routes.get('/api/provider-accounts-test')
    assert.equal(typeof route?.fetch, 'function', 'the key-test route is registered')
    const post = (body) => route.fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })).then((response) => response.json())

    const valid = await post({ providerId: 'xai', ref: 'XAI_API_KEY' })
    assert.equal(valid.supported, true)
    assert.equal(valid.ok, true, 'a working key is reported valid')

    mode = 'rejected'
    const invalid = await post({ providerId: 'xai', ref: 'XAI_API_KEY' })
    assert.equal(invalid.ok, false, 'an exhausted team is reported invalid')
    assert.match(invalid.error, /credits|spending limit/, 'the provider message is returned')
    assert.match(invalid.error, /^team_blocked · /, 'the test route names the blocked team too')

    const unknown = await post({ providerId: 'nope' })
    assert.equal(unknown.supported, false, 'an unmanaged provider is unsupported')

    const noProbe = await post({ providerId: 'anthropic' })
    assert.equal(noProbe.supported, false, 'a provider without a probe is unsupported')
    assert.equal(noProbe.reason, 'no-probe', 'the reason names the missing probe')

    const bad = await post({})
    assert.equal(bad.supported, false, 'a request without a provider is refused')
    assert.equal(bad.reason, 'bad-request')
    host.disposers.forEach((dispose) => dispose())
    console.log('ok C the key-test route verifies, rejects, and declines what it cannot probe')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('\nALL XAI CHECKS PASSED')
