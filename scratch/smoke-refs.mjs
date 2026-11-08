// Second DOM smoke pass: prove extra accounts never reuse a credential reference.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const CLIENT = 'C:\\Users\\Administrator\\repos\\dsh-provider-hub\\plugin\\client.js'
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:55099/' })
const { window } = dom
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) {
  if (window[key] === undefined) continue
  try { globalThis[key] = window[key] } catch { /* read-only globals */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = window
const require = createRequire(import.meta.url)
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react-dom/test-utils')

const failures = []
const check = (ok, label, detail) => {
  if (!ok) failures.push(detail === undefined ? label : `${label}: ${detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : detail === undefined ? '' : ` -> ${detail}`}`)
}
const ok = (value) => ({ ok: true, value })
const view = (ns, value, revision) => ({ ns, autoGenerate: false, schema: { type: 'object' }, applies: 'live', revision, secrets: [], value })
const state = {
  own: { providers: [{ id: 'opencode-go', name: 'OpenCode Go', catalog: true, accounts: [{ id: 'opencode-go-a1', label: 'Primary account', ref: 'OPENCODE_GO_API_KEY' }] }], failover: { enabled: true, codes: ['QUOTA', 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'], maxHops: 2 } },
  pi: { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } },
  ownRevision: 3,
  piRevision: 5,
}
const calls = []
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
    describe: async () => ok({ writable: true, hasDocument: true, namespaces: [view('provider-accounts', structuredClone(state.own), state.ownRevision), view('llm-pi-ai', structuredClone(state.pi), state.piRevision)] }),
    mutate: async (ns, ops, revision) => {
      calls.push({ kind: 'mutate', ns, ops, revision })
      if (ns === 'provider-accounts') { applyOps(state.own, ops); state.ownRevision += 1; return ok(view(ns, structuredClone(state.own), state.ownRevision)) }
      applyOps(state.pi, ops); state.piRevision += 1
      return ok(view(ns, structuredClone(state.pi), state.piRevision))
    },
  },
  credentials: {
    describe: async (refs) => ok(Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }]))),
    set: async (ref) => { calls.push({ kind: 'credentials.set', ref }); return ok(undefined) },
    unset: async (ref) => { calls.push({ kind: 'credentials.unset', ref }); return ok(undefined) },
  },
  llm: { discoverModels: async () => ok([]), listConfigurableProviders: async () => ok([]) },
  $on: () => () => {},
}
let definition
window.__ModuleLoader__ = { load(def) { definition = def } }
await import(pathToFileURL(CLIENT).href + `?t=${Date.now()}`)
const dicts = {}
let registered
const ctx = {
  effect(fn) { fn(); return () => {} },
  on() { return () => {} },
  inject(deps, callback) { callback(this); return () => {} },
  get() {},
  logger: { info() {}, warn() {}, error() {} },
  slots: { inject(slot, callback) { callback(); return () => {} }, register(declaration, component) { registered = { declaration, component }; return () => {} } },
  locale: {
    register(ns, d) { dicts[ns] = d },
    bind(ns) { return (key, vars) => { let text = dicts[ns]?.en?.[key] ?? key; if (vars) for (const [name, value] of Object.entries(vars)) text = String(text).replaceAll(`{${name}}`, String(value)); return text } },
  },
  remote,
}
definition.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(ctx)
const props = registered.declaration.inject()
const container = window.document.getElementById('root')
const root = ReactDOMClient.createRoot(container)
const flush = async (rounds = 10) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
await act(async () => { root.render(React.createElement(registered.component, props)) })
await flush(14)

const byText = (label) => [...container.querySelectorAll('button')].find((element) => (element.textContent ?? '').trim() === label)
const click = async (element, label) => {
  check(element !== undefined, `found control ${label}`)
  if (element === undefined) return
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await flush(10)
}
const typeInto = async (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
  await flush(3)
}
async function addAccount(label, key) {
  await click(byText('Add account'), `Add account (${label})`)
  const inputs = [...container.querySelectorAll('[role="dialog"] input')]
  await typeInto(inputs.find((element) => element.type === 'text'), label)
  await typeInto(inputs.find((element) => element.type === 'password'), key)
  await click(byText('Save account'), `Save account (${label})`)
}

calls.length = 0
await addAccount('Backup account', 'sk-test-aaaaaaaaaaaa')
const first = calls.find((call) => call.kind === 'credentials.set')
check(first?.ref === 'OPENCODE_GO_2_API_KEY', 'first added account skips the in-use base reference', first?.ref)

calls.length = 0
await addAccount('Third account', 'sk-test-bbbbbbbbbbbb')
const second = calls.find((call) => call.kind === 'credentials.set')
check(second !== undefined, 'second added account stored a key')
check(second?.ref === 'OPENCODE_GO_3_API_KEY', 'second added account gets the next free reference', second?.ref)
check(new Set(state.own.providers[0].accounts.map((account) => account.ref)).size === state.own.providers[0].accounts.length, 'provider accounts all have distinct references', JSON.stringify(state.own.providers[0].accounts.map((account) => account.ref)))
check(state.own.providers[0].accounts[2]?.label === 'Third account', 'label saved', JSON.stringify(state.own.providers[0].accounts.map((account) => account.label)))

await act(async () => { root.unmount() })

console.log(`\n${failures.length === 0 ? 'REF SMOKE OK' : `REF SMOKE FAILED (${failures.length})`}`)
for (const failure of failures) console.log(` - ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
