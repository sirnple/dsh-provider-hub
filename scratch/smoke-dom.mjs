// DOM smoke test: mounts the provider-accounts settings page in jsdom, lets its
// effects load fixture data, then drives the real buttons to prove the write flows.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const CLIENT = 'C:\\Users\\Administrator\\repos\\dsh-provider-hub\\plugin\\client.js'
const NS = 'provider-accounts'
const PI = 'llm-pi-ai'

const failures = []
const check = (ok, label, detail) => {
  if (!ok) failures.push(detail === undefined ? label : `${label}: ${detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : detail === undefined ? '' : ` -> ${detail}`}`)
}

// ------------------------------------------------------------------- jsdom
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:55099/' })
const { window } = dom
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) {
  if (window[key] === undefined) continue
  try { globalThis[key] = window[key] } catch { /* navigator & co. are read-only on globalThis */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// The key test posts to the Host probe route; answer it from a switchable stub.
const probeCalls = []
let probeAnswer = { supported: true, ok: true }
globalThis.fetch = async (url, init) => {
  const target = String(url)
  probeCalls.push({ url: target, body: init?.body })
  const answer = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) })
  if (target.endsWith('/provider-accounts-grok/status')) return answer({ ok: true, signedIn: false })
  if (target.endsWith('/provider-accounts-grok/start')) {
    return answer({ ok: true, device: { deviceCode: 'dev-1', userCode: 'ABCD-EFGH', verificationUri: 'https://x.ai/device', intervalMs: 2000, expiresInMs: 60000 } })
  }
  if (target.endsWith('/provider-accounts-grok/poll')) return answer({ ok: true, status: 'pending' })
  if (target.endsWith('/provider-accounts-grok/probe')) return answer({ ok: true, probe: { ok: true, stage: 'ok', model: 'grok-4.7', models: 2, sample: 'pong' } })
  if (target.endsWith('/provider-accounts-usage')) {
    const today = (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` })()
    return answer({
      updatedAt: Date.now(),
      providers: [
        { id: 'opencode-go', name: 'OpenCode Go' },
        { id: 'grok-build', name: 'Grok Build' },
      ],
      accounts: [
        { providerId: 'opencode-go', ref: 'OPENCODE_GO_MAIN_API_KEY', label: 'Main account', requests: 12, failures: 1, days: { [today]: { requests: 12, input: 900, output: 300, failures: 1 } } },
        { providerId: 'grok-build', ref: 'GROK_BUILD_OAUTH', label: 'Grok Build account', requests: 2, failures: 0, days: { [today]: { requests: 2, input: 120, output: 40, failures: 0 } } },
      ],
      balances: {
        'opencode-go::OPENCODE_GO_MAIN_API_KEY': { ok: true, meters: [ { id: 'fiveHour', percent: 4 }, { id: 'weekly', percent: 22 }, { id: 'monthly', percent: 34 } ] },
        'grok-build::GROK_BUILD_OAUTH': { ok: true, meters: [ { id: 'weekly', percent: 5 } ] },
      },
    })
  }
  return answer(probeAnswer)
}
globalThis.window = window

const require = createRequire(import.meta.url)
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react-dom/test-utils')

// ---------------------------------------------------------------- fixtures
function view(ns, value, revision) {
  return { ns, autoGenerate: false, schema: { type: 'object' }, applies: 'live', revision, secrets: [], value }
}
const state = {
  own: {
    providers: [
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        catalog: true,
        accounts: [
          { id: 'main', label: 'Main account', ref: 'OPENCODE_GO_MAIN_API_KEY' },
          { id: 'work', label: 'Work account', ref: 'OPENCODE_GO_WORK_API_KEY' },
        ],
      },
      {
        id: 'grok-build',
        name: 'Grok Build',
        catalog: false,
        accounts: [{ id: 'grok-build-a1', label: 'Grok Build account', ref: 'GROK_BUILD_OAUTH' }],
      },
    ],
    failover: { enabled: true, codes: ['QUOTA', 'AUTH'], maxHops: 2 },
  },
  pi: { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_MAIN_API_KEY', models: [{ id: 'm1' }] } } },
  ownRevision: 4,
  piRevision: 9,
}
const calls = []
const ok = (value) => ({ ok: true, value })

// apply settings.mutate path ops to the fixture so the store stays consistent
function applyOps(target, ops) {
  for (const op of ops) {
    const path = op.path.slice()
    let node = target
    while (path.length > 1) {
      const head = path.shift()
      if (node[head] === undefined || node[head] === null) node[head] = /^\d+$/.test(path[0]) ? [] : {}
      node = node[head]
    }
    if (op.op === 'set') node[path[0]] = structuredClone(op.value)
    else if (Array.isArray(node)) node.splice(Number(path[0]), 1)
    else delete node[path[0]]
  }
}

const remote = {
  settings: {
    describe: async () => ok({ writable: true, hasDocument: true, namespaces: [view(NS, structuredClone(state.own), state.ownRevision), view(PI, structuredClone(state.pi), state.piRevision)] }),
    mutate: async (ns, ops, revision) => {
      calls.push({ kind: 'mutate', ns, ops, revision })
      if (ns === NS) { applyOps(state.own, ops); state.ownRevision += 1; return ok(view(NS, structuredClone(state.own), state.ownRevision)) }
      applyOps(state.pi, ops); state.piRevision += 1
      return ok(view(PI, structuredClone(state.pi), state.piRevision))
    },
  },
  credentials: {
    describe: async (refs) => { calls.push({ kind: 'credentials.describe', refs }); return ok(Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }]))) },
    set: async (ref, value) => { calls.push({ kind: 'credentials.set', ref }); return ok(undefined) },
    unset: async (ref) => { calls.push({ kind: 'credentials.unset', ref }); return ok(undefined) },
  },
  llm: {
    discoverModels: async (ns, request) => { calls.push({ kind: 'discover', ns, request }); return ok([{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }]) },
    listConfigurableProviders: async () => ok([{ provider: 'opencode-go', displayName: 'OpenCode Go', settingsNs: PI, settingsPath: ['providers', 'opencode-go'] }]),
  },
  $on: () => () => {},
}

// ------------------------------------------------------- module loader stub
let definition
window.__ModuleLoader__ = { load(def) { definition = def } }
await import(pathToFileURL(CLIENT).href + `?t=${Date.now()}`)
check(definition !== undefined, 'client module registered')

const pending = []
const localeDicts = {}
let registered
const ctx = {
  effect(fn) { const dispose = fn(); pending.push(typeof dispose === 'function' ? dispose : () => {}); return () => {} },
  on() { return () => {} },
  inject(deps, callback) { const value = callback(this); return () => { if (typeof value === 'function') value() } },
  get() { return undefined },
  logger: { info() {}, warn() {}, error() {} },
  slots: {
    inject(slot, callback) { const dispose = callback(); pending.push(typeof dispose === 'function' ? dispose : () => {}); return () => {} },
    register(declaration, component) { registered = { declaration, component }; return () => {} },
  },
  locale: {
    register(ns, dicts) { localeDicts[ns] = dicts },
    bind(ns) {
      return (key, vars) => {
        let text = localeDicts[ns]?.en?.[key] ?? key
        if (vars !== undefined) for (const [name, value] of Object.entries(vars)) text = String(text).replaceAll(`{${name}}`, String(value))
        return text
      }
    },
  },
  remote,
}
const plugin = definition.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module: ${name}`)
})
plugin.apply(ctx)
check(registered?.declaration?.id === 'provider-accounts', 'settings.section registered')

// ------------------------------------------------------------------- mount
const props = registered.declaration.inject()
const container = window.document.getElementById('root')
const root = ReactDOMClient.createRoot(container)
const flush = async (rounds = 8) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }

await act(async () => { root.render(React.createElement(registered.component, props)) })
await flush(14)

const text = () => container.textContent ?? ''
const byText = (label, selector = 'button') => [...container.querySelectorAll(selector)].find((element) => (element.textContent ?? '').trim() === label)
const click = async (element, label) => {
  check(element !== undefined, `found control ${label}`)
  if (element === undefined) return
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await flush(10)
}
const input = (element, value) => {
  if (element === undefined) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}

check(text().includes('OpenCode Go'), 'provider card renders')
check(text().includes('Main account'), 'account rows render')
check(text().includes('Work account'), 'second account renders')
check(container.querySelectorAll('button').length > 4, 'page has interactive controls', String(container.querySelectorAll('button').length))

// 1. activate the second account -> llm-pi-ai apiKeyEnv rewrite
const useButtons = [...container.querySelectorAll('button')].filter((element) => (element.textContent ?? '').trim() === 'Use')
check(useButtons.length === 1, 'only non-active accounts offer Use', String(useButtons.length))
check(text().includes('Current'), 'active account shows the Current badge')
calls.length = 0
await click(useButtons[0], 'Use (second account)')
const activation = calls.find((call) => call.kind === 'mutate' && call.ns === PI)
check(activation !== undefined, 'activation wrote llm-pi-ai')
check(activation?.ops?.[0]?.path?.join('.') === 'providers.opencode-go.apiKeyEnv', 'activation targets the route apiKeyEnv', JSON.stringify(activation?.ops))
check(activation?.ops?.[0]?.value === 'OPENCODE_GO_WORK_API_KEY', 'activation selects the Work reference', JSON.stringify(activation?.ops))
check(state.pi.providers['opencode-go'].apiKeyEnv === 'OPENCODE_GO_WORK_API_KEY', 'fixture route now points at Work')

// 2. add an account through the dialog
calls.length = 0
await click(byText('Add account'), 'Add account')
check(text().includes('Account name'), 'account dialog opened')
const dialog = container.querySelector('[role="dialog"]')
check(dialog !== undefined, 'account dialog is a role=dialog modal')
const textInputs = [...container.querySelectorAll('[role="dialog"] input')]
const labelInput = textInputs.find((element) => element.type === 'text')
const keyInput = textInputs.find((element) => element.type === 'password')
await act(async () => { input(labelInput, 'Backup account') })
await act(async () => { input(keyInput, 'sk-test-1234567890') })
await flush(6)
await click(byText('Save account'), 'Save account')
const storedKey = calls.find((call) => call.kind === 'credentials.set')
check(storedKey !== undefined, 'account dialog stored a credential', JSON.stringify(calls.map((call) => call.kind)))
check(/^OPENCODE_GO(_[0-9]+)?_API_KEY$/.test(storedKey?.ref ?? ''), 'credential reference is derived from the route', storedKey?.ref)
const accountWrite = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(accountWrite !== undefined, 'account dialog wrote the provider-accounts namespace')
check(JSON.stringify(accountWrite?.ops ?? '').includes('Backup account'), 'account label written', JSON.stringify(accountWrite?.ops))
check(state.own.providers[0].accounts.length === 3, 'fixture gained a third account', String(state.own.providers[0].accounts.length))

// 3. toggle automatic failover
const failoverSwitch = container.querySelector('[role="switch"]')
check(failoverSwitch !== undefined, 'failover switch renders')
calls.length = 0
await click(failoverSwitch, 'failover switch')
const toggle = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(toggle !== undefined, 'failover toggle wrote settings', JSON.stringify(calls.map((call) => call.kind)))
check(JSON.stringify(toggle?.ops ?? '').includes('failover'), 'failover op targets the failover field', JSON.stringify(toggle?.ops))
check(state.own.failover.enabled === false, 'fixture failover disabled', JSON.stringify(state.own.failover))

// 3b. per-provider account switcher
const switcher = container.querySelector('.pa-switcher')
check(switcher !== null, 'the account switcher renders on the provider card')
const switchButtons = [...(switcher?.querySelectorAll('button') ?? [])]
check(switchButtons.length === 3, 'account switcher exposes one button per account', String(switchButtons.length))
check(switchButtons.filter((button) => button.getAttribute('aria-pressed') === 'true').length === 1, 'exactly one account is pressed')
check((switcher?.textContent ?? '').includes('Switch account'), 'the switcher is labelled')
check((switcher?.textContent ?? '').includes('takes effect on the next model request'), 'the switcher explains when a switch applies')
const mainSwitch = switchButtons.find((button) => (button.textContent ?? '').trim() === 'Main account')
check(mainSwitch !== undefined && mainSwitch.getAttribute('aria-pressed') === 'false', 'the inactive account offers a switch button')
calls.length = 0
await click(mainSwitch, 'switcher: Main account')
const switched = calls.find((call) => call.kind === 'mutate' && call.ns === PI)
check(switched !== undefined, 'clicking the switcher writes llm-pi-ai', JSON.stringify(calls.map((call) => call.kind)))
check(switched?.ops?.[0]?.path?.join('.') === 'providers.opencode-go.apiKeyEnv', 'the switch targets the route reference', JSON.stringify(switched?.ops))
check(switched?.ops?.[0]?.value === 'OPENCODE_GO_MAIN_API_KEY', 'the switch selects the clicked account', JSON.stringify(switched?.ops))
check(state.pi.providers['opencode-go'].apiKeyEnv === 'OPENCODE_GO_MAIN_API_KEY', 'fixture route now points at Main')
check(container.querySelector('[role="dialog"]') === null, 'a switch needs no dialog')

// 3c. a Test click verifies the key through the Host probe
{
  const firstRow = container.querySelector('li.pa-account')
  const testButton = [...(firstRow?.querySelectorAll('button') ?? [])].find((node) => (node.textContent ?? '').trim() === 'Test')
  check(testButton !== undefined, 'the account row offers a Test button')
  probeCalls.length = 0
  probeAnswer = { supported: true, ok: true }
  await click(testButton, 'Test (account)')
  const probe = probeCalls.find((call) => call.url === '/api/provider-accounts-test')
  check(probe !== undefined, 'the test posts to the Host probe route', probeCalls.map((call) => call.url).join(','))
  check((probe?.body ?? '').includes('"providerId":"opencode-go"'), 'the probe names the provider', probe?.body)
  check((probe?.body ?? '').includes('"ref":"'), 'the probe names the account reference', probe?.body)
  check((firstRow?.textContent ?? '').includes('Key accepted'), 'a verified key says so', firstRow?.textContent?.slice(0, 120))

  probeCalls.length = 0
  probeAnswer = { supported: false, reason: 'no-probe' }
  await click(testButton, 'Test (account, no probe)')
  check((firstRow?.textContent ?? '').includes('catalogue models only'), 'without a probe the result is labelled unverified', firstRow?.textContent?.slice(0, 160))

  probeCalls.length = 0
  probeAnswer = { supported: true, ok: false, error: 'Incorrect API key provided.' }
  await click(testButton, 'Test (account, rejected)')
  check((firstRow?.textContent ?? '').includes('Incorrect API key provided'), 'a rejected key shows the provider message', firstRow?.textContent?.slice(0, 160))
}

// 3e. the native provider card explains the absent pi-ai route
{
  const nativeCard = [...container.querySelectorAll('.pa-card')].find((card) => (card.textContent ?? '').includes('grok-build'))
  check(nativeCard !== undefined, 'the native provider card renders')
  check((nativeCard.textContent ?? '').includes('built-in adapter'), 'the native card explains the missing pi-ai route', (nativeCard.textContent ?? '').slice(0, 140))
  const createRoute = [...nativeCard.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === 'Create route')
  check(createRoute === undefined, 'the native card hides create-route')
  const nativeText = nativeCard.textContent ?? ''
  check(!nativeText.includes('Switch account'), 'the native card hides the account switcher', nativeText.slice(0, 120))
  const nativeButtons = [...nativeCard.querySelectorAll('button')].map((node) => (node.textContent ?? '').trim())
  check(nativeButtons.includes('Sign in'), 'the native card offers sign-in', nativeButtons.join('|') + ' :: ' + nativeText.slice(0, 300))
  check(nativeButtons.filter((label) => label === 'Test').length >= 2, 'both the provider and the account offer a test', nativeButtons.join('|'))
  const opencodeCard = [...container.querySelectorAll('.pa-card')].find((card) => (card.textContent ?? '').includes('opencode-go'))
  const opencodeRow = opencodeCard?.querySelector('.pa-account')
  check(opencodeRow !== undefined && opencodeRow.querySelectorAll('[role="progressbar"]').length === 3, 'OpenCode Go shows its three quota meters', String(opencodeRow?.querySelectorAll('[role="progressbar"]').length))
  check((opencodeRow?.textContent ?? '').includes('Today'), 'OpenCode Go shows today\'s ledger line', (opencodeRow?.textContent ?? '').slice(0, 120))
  const accountRow = nativeCard.querySelector('.pa-account')
  const meter = accountRow?.querySelector('[role="progressbar"]')
  check(meter !== undefined, 'the quota meter sits on the account row', (accountRow?.textContent ?? '').slice(0, 160))
  const headerText = nativeCard.querySelector('.pa-cardHead')?.textContent ?? ''
  check(!headerText.includes('%'), 'the provider header carries no quota number', headerText)
  probeCalls.length = 0
  const testButton = [...nativeCard.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === 'Test')
  await click(testButton, 'native provider test')
  check(probeCalls.some((call) => call.url.endsWith('/provider-accounts-grok/probe')), 'the native test hits the probe route', probeCalls.map((call) => call.url).join(','))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  check((nativeCard.textContent ?? '').includes('Works: grok-4.7'), 'the probe result is shown', (nativeCard.textContent ?? '').slice(0, 200))
}

// 4. add-provider dialog lists catalog presets
await click(byText('Add provider'), 'Add provider')
const presetsShown = text().includes('OpenCode Go') && container.querySelectorAll('button').length > 6
check(presetsShown, 'add-provider dialog renders provider choices')

// 4b. the Grok Build preset signs in instead of taking a key
{
  await click(byText('From the catalog'), 'catalog mode')
  const grokPresetButton = [...container.querySelectorAll('button')].find((node) => (node.textContent ?? '').includes('Grok Build (OAuth)'))
  await click(grokPresetButton, 'Grok Build preset')
  const dialog = container.querySelector('[role="dialog"]')
  const labels = [...(dialog?.querySelectorAll('.pa-label') ?? [])].map((node) => (node.textContent ?? '').trim())
  check(!labels.includes('API key'), 'the OAuth preset hides the API key field', labels.join('|'))
  check(!labels.includes('Credential reference'), 'the OAuth preset hides the reference field', labels.join('|'))
  const signIn = [...(dialog?.querySelectorAll('button') ?? [])].find((node) => (node.textContent ?? '').trim() === 'Sign in')
  check(signIn !== undefined, 'the OAuth preset offers sign-in')
  probeCalls.length = 0
  await click(signIn, 'sign in from the dialog')
  check(probeCalls.some((call) => call.url.endsWith('/provider-accounts-grok/start')), 'sign-in starts the device flow', probeCalls.map((call) => call.url).join(','))
  check((dialog?.textContent ?? '').includes('ABCD-EFGH'), 'the dialog shows the device code', (dialog?.textContent ?? '').slice(0, 160))
  // back to the custom form: the Huawei MaaS template fills endpoint + protocol
  await act(async () => { window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await click(byText('Add provider'), 'Add provider (vendor template)')
  await click(byText('Custom endpoint'), 'Custom endpoint mode')
  await click(byText('华为云 MaaS'), 'Huawei MaaS template')
  const templateFields = [...container.querySelectorAll('[role="dialog"] input, [role="dialog"] select')].map((node) => node.value ?? '')
  check(templateFields.includes('https://api-ap-southeast-1.modelarts-maas.com/v1'), 'the vendor template fills the endpoint', templateFields.join('|'))
  check(templateFields.includes('openai-completions'), 'the vendor template fills the protocol', templateFields.join('|'))
  check(templateFields.includes('HUAWEI_MAAS_API_KEY'), 'the vendor template fills the credential reference', templateFields.join('|'))
  await click(byText('WorkBuddy（网关）'), 'WorkBuddy template')
  const workbuddyFields = [...container.querySelectorAll('[role="dialog"] input, [role="dialog"] select')].map((node) => node.value ?? '')
  check(workbuddyFields.includes('http://127.0.0.1:8000/v1'), 'the WorkBuddy template fills the gateway endpoint', workbuddyFields.join('|'))
  check(workbuddyFields.includes('WORKBUDDY_API_KEY'), 'the WorkBuddy template fills its credential reference', workbuddyFields.join('|'))
  check((container.textContent ?? '').includes('workbuddy2api'), 'the WorkBuddy hint names the gateway', (container.textContent ?? '').slice(-240))
  await act(async () => { window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await act(async () => { window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
}

// 5. delete provider confirmation
await click(byText('Delete provider'), 'Delete provider')
check(text().toLowerCase().includes('delete'), 'delete provider confirmation renders')
await act(async () => { window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

console.log('\nfinal text sample:', text().slice(0, 400).replace(/\s+/g, ' '))

await act(async () => { root.unmount() })
for (const dispose of pending.reverse()) dispose()
check(true, 'unmounted and disposed cleanly')

console.log(`\n${failures.length === 0 ? 'DOM SMOKE OK' : `DOM SMOKE FAILED (${failures.length})`}`)
for (const failure of failures) console.log(` - ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
