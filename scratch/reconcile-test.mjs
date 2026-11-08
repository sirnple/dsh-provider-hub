// Scratch harness for the Host self-healing route repair: a provider that the
// page manages must always have a live llm-pi-ai route, even after another
// surface (the Models page) removed it.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const ROOT = 'C:/Users/Administrator/repos/dsh-provider-accounts/scratch'
const moduleUrl = new URL('index.testable.mjs', import.meta.url).href
let sequence = 0

async function freshModules() {
  sequence += 1
  return await import(`${moduleUrl}?reconcile=${sequence}`)
}

const NOW = Date.now()

/** Write a ledger file the plugin loads at activation. */
function seedLedger(home, balances) {
  mkdirSync(`${home}/storages/provider-accounts`, { recursive: true })
  writeFileSync(`${home}/storages/provider-accounts/usage.json`, JSON.stringify({ version: 1, accounts: {}, balances, updatedAt: NOW }))
}

/** A fake Cordis context whose configEditor mutates one in-memory lm-pi-ai entry. */
function makeHost({ home, route, credentials, providers }) {
  process.env.DSH_HOME = home
  const listeners = []
  const disposers = []
  const edits = []
  const entry = { options: { id: 'llm-pi-ai', config: route === undefined ? {} : { providers: structuredClone(route) } } }
  const ctx = {
    fiber: {},
    logger: { info() {}, warn() {} },
    get: (service) => {
      if (service === 'configEditor') {
        return {
          entries: () => [entry],
          edit: async (target, change) => {
            const next = change(structuredClone(target.options.config ?? {}), {})
            edits.push(structuredClone(next))
            target.options.config = next
          },
        }
      }
      if (service === 'credentials') {
        return {
          resolve: async (ref) => ({ value: 'sk-not-real' }),
          describe: async (ref) => ({ configured: credentials[ref] !== false, source: 'store', writable: true }),
        }
      }
      return undefined
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    inject: (deps, callback) => {
      const services = {}
      if (deps.includes('settings')) services.settings = { configure: () => () => {} }
      if (deps.includes('connection')) {
        services.connection = { fetch: { register: () => () => {} } }
      }
      callback({ ...services, effect: ctx.effect, fiber: {} })
    },
    on: (event, listener) => { listeners.push({ event, listener }) },
    llm: { registerAdapter: () => () => {}, stream: () => { throw new Error('no model call in this harness') } },
  }
  return { ctx, listeners, disposers, edits, entry, providers }
}

async function activate(options) {
  const { apply, Config } = await freshModules()
  const host = makeHost(options)
  apply(host.ctx, Config({
    providers: options.providers,
    failover: { enabled: false },
  }))
  return host
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 350))
const dispose = (host) => host.disposers.forEach((fn) => fn())

const ACCOUNTS = [
  { id: 'a1', label: '主账号', ref: 'OPENCODE_GO_API_KEY_0' },
  { id: 'a2', label: '工作账号', ref: 'OPENCODE_GO_API_KEY_1' },
]
const PROVIDERS = [{ id: 'opencode-go', name: 'OpenCode Go', catalog: true, balanceKind: 'none', accounts: ACCOUNTS }]

// 1. A missing route is recreated at activation, preferring the account whose
//    last balance probe succeeded.
{
  const home = `${ROOT}/tmp-reconcile-1`
  rmSync(home, { recursive: true, force: true })
  seedLedger(home, {
    'opencode-go::OPENCODE_GO_API_KEY_0': { kind: 'opencode-zen', ok: false, fetchedAt: NOW, fields: [], meters: [], error: '403' },
    'opencode-go::OPENCODE_GO_API_KEY_1': { kind: 'opencode-zen', ok: true, fetchedAt: NOW, fields: [], meters: [] },
  })
  const host = await activate({ home, route: undefined, credentials: {}, providers: PROVIDERS })
  await settle()
  assert.equal(host.edits.length, 1, 'one repair edit')
  assert.deepEqual(host.edits[0].providers['opencode-go'], { apiKeyEnv: 'OPENCODE_GO_API_KEY_1', displayName: 'OpenCode Go' }, 'route created with the healthy account and its display name')
  assert.ok(host.listeners.some((row) => row.event === 'llm/adapters-updated'), 'adapter updates are observed')
  assert.ok(host.listeners.some((row) => row.event === 'loader/volatile-update'), 'volatile updates are observed')
  dispose(host)
  console.log('ok 1 missing route recreated, healthy account preferred')
}

// 2. A keyless route is pointed at an account without losing its other fields.
{
  const home = `${ROOT}/tmp-reconcile-2`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({
    home,
    route: { 'opencode-go': { displayName: 'Custom label', models: [{ id: 'm1' }] } },
    credentials: {},
    providers: PROVIDERS,
  })
  await settle()
  assert.equal(host.edits.length, 1, 'one repair edit')
  assert.deepEqual(host.edits[0].providers['opencode-go'], {
    displayName: 'Custom label', models: [{ id: 'm1' }], apiKeyEnv: 'OPENCODE_GO_API_KEY_0',
  }, 'keyless route is pointed at the first account, its own label and models survive')
  dispose(host)
  console.log('ok 2 keyless route pointed at an account')
}

// 3. A route whose reference no longer resolves is repointed.
{
  const home = `${ROOT}/tmp-reconcile-3`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({
    home,
    route: { 'opencode-go': { apiKeyEnv: 'GONE_API_KEY' } },
    credentials: { GONE_API_KEY: false },
    providers: PROVIDERS,
  })
  await settle()
  assert.equal(host.edits.length, 1, 'one repair edit')
  assert.equal(host.edits[0].providers['opencode-go'].apiKeyEnv, 'OPENCODE_GO_API_KEY_0', 'unresolved reference replaced')
  assert.equal(host.edits[0].providers['opencode-go'].displayName, 'OpenCode Go', 'the repointed route gains the provider name')
  dispose(host)
  console.log('ok 3 unresolved reference repointed')
}

// 4. A healthy, already-labelled route is left alone.
{
  const home = `${ROOT}/tmp-reconcile-4`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({
    home,
    route: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY_1', displayName: 'OpenCode Go' } },
    credentials: {},
    providers: PROVIDERS,
  })
  await settle()
  assert.equal(host.edits.length, 0, 'no edit for a healthy route')
  dispose(host)
  console.log('ok 4 healthy route untouched')
}

// 4b. A healthy but nameless route gains the provider's display name once.
{
  const home = `${ROOT}/tmp-reconcile-4b`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({
    home,
    route: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY_1' } },
    credentials: {},
    providers: PROVIDERS,
  })
  await settle()
  assert.equal(host.edits.length, 1, 'one label edit')
  assert.deepEqual(host.edits[0].providers['opencode-go'], { apiKeyEnv: 'OPENCODE_GO_API_KEY_1', displayName: 'OpenCode Go' }, 'only the label was added')
  dispose(host)
  console.log('ok 4b nameless healthy route labelled once')
}

// 5. A provider with no accounts is never materialized.
{
  const home = `${ROOT}/tmp-reconcile-5`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({ home, route: undefined, credentials: {}, providers: [{ ...PROVIDERS[0], accounts: [] }] })
  await settle()
  assert.equal(host.edits.length, 0, 'no route without an account')
  dispose(host)
  console.log('ok 5 account-less provider creates nothing')
}

// 6. A hand-declared (custom) provider is materialized with its endpoint fields.
{
  const home = `${ROOT}/tmp-reconcile-6`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({
    home,
    route: undefined,
    credentials: {},
    providers: [{
      id: 'acme',
      name: 'Acme',
      catalog: false,
      api: 'openai-completions',
      baseURL: 'https://gateway.acme.example/v1',
      models: [{ id: 'acme-think', name: 'Acme Think', contextWindow: 262144, maxTokens: 32768, input: ['text'] }],
      balanceKind: 'none',
      accounts: [{ id: 'a1', label: '主账号', ref: 'ACME_API_KEY' }],
    }],
  })
  await settle()
  assert.equal(host.edits.length, 1, 'one repair edit')
  const profile = host.edits[0].providers.acme
  assert.equal(profile.apiKeyEnv, 'ACME_API_KEY')
  assert.equal(profile.displayName, 'Acme')
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'https://gateway.acme.example/v1')
  assert.equal(profile.models.length, 1)
  dispose(host)
  console.log('ok 6 custom route carries api, endpoint and models')
}

// 7. Removing the route later (e.g. from the Models page) is repaired on the
//    adapter-update signal.
{
  const home = `${ROOT}/tmp-reconcile-7`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({
    home,
    route: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY_1', displayName: 'OpenCode Go' } },
    credentials: {},
    providers: PROVIDERS,
  })
  await settle()
  assert.equal(host.edits.length, 0, 'starts healthy')
  host.entry.options.config = { providers: {} } // what a delete on another surface leaves
  const listener = host.listeners.find((row) => row.event === 'llm/adapters-updated')
  listener.listener()
  await settle()
  assert.equal(host.edits.length, 1, 'the removal triggers one repair')
  assert.ok(host.entry.options.config.providers['opencode-go'], 'route is back')
  assert.equal(host.entry.options.config.providers['opencode-go'].apiKeyEnv, 'OPENCODE_GO_API_KEY_1')
  dispose(host)
  console.log('ok 7 a later removal is repaired on the adapter update')
}

console.log('\nALL RECONCILE CHECKS PASSED')
