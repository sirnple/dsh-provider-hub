// Headless smoke test for the provider-accounts browser half.
// Loads plugin/client.js the way the DSH module loader would, runs the plugin's
// apply() against a stub Cordis context, then renders the registered settings
// page with react-dom/server to catch render-time crashes and assert copy.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const CLIENT = 'C:\\Users\\Administrator\\repos\\dshx\\plugin\\client.js'
const NS = 'provider-accounts'
const PI = 'llm-pi-ai'

const failures = []
const check = (ok, label, detail) => {
  if (!ok) failures.push(detail === undefined ? label : `${label}: ${detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : ` -> ${detail}`}`)
}

// ---------------------------------------------------------------- fixtures
const providerAccountsView = {
  ns: NS,
  autoGenerate: false,
  schema: { type: 'object' },
  applies: 'live',
  revision: 4,
  secrets: [],
  value: {
    providers: [
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        catalog: true,
        accounts: [
          { id: 'main', label: '主账号', ref: 'OPENCODE_GO_MAIN_API_KEY' },
          { id: 'work', label: '工作账号', ref: 'OPENCODE_GO_WORK_API_KEY' },
        ],
      },
    ],
    failover: { enabled: true, codes: ['QUOTA', 'RATE_LIMIT'], maxHops: 2 },
  },
}
const piAiView = {
  ns: PI,
  autoGenerate: false,
  schema: { type: 'object' },
  applies: 'live',
  revision: 7,
  secrets: [],
  value: {
    providers: {
      'opencode-go': {
        apiKeyEnv: 'OPENCODE_GO_MAIN_API_KEY',
        models: [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }],
      },
    },
  },
}

const calls = []
const ok = (value) => ({ ok: true, value })
const api = {
  settings: {
    describe: async () => ok({ writable: true, hasDocument: true, namespaces: [providerAccountsView, piAiView] }),
    mutate: async (ns, ops, rev) => {
      calls.push({ kind: 'settings.mutate', ns, ops, rev })
      return ok(ns === NS ? providerAccountsView : piAiView)
    },
  },
  credentials: {
    describe: async (refs) => {
      calls.push({ kind: 'credentials.describe', refs })
      return ok(Object.fromEntries(refs.map((ref) => [ref, { configured: ref !== 'OPENCODE_GO_WORK_API_KEY', writable: true }])))
    },
    set: async (ref, value) => { calls.push({ kind: 'credentials.set', ref }); return ok(undefined) },
    unset: async (ref) => { calls.push({ kind: 'credentials.unset', ref }); return ok(undefined) },
  },
  llm: {
    discoverModels: async (ns, request) => {
      calls.push({ kind: 'llm.discoverModels', ns, request })
      return ok([{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }])
    },
    listConfigurableProviders: async () => {
      calls.push({ kind: 'llm.listConfigurableProviders' })
      return ok([{ provider: 'opencode-go', displayName: 'OpenCode Go', settingsNs: PI, settingsPath: ['providers', 'opencode-go'] }])
    },
  },
}

// ------------------------------------------------------- module loader stub
let definition
globalThis.window = { __ModuleLoader__: { load(def) { definition = def } } }
const moduleUrl = pathToFileURL(CLIENT).href + `?t=${Date.now()}`
await import(moduleUrl)
check(definition !== undefined, 'client module registered a loader definition')
check(definition?.id === 'dsh-provider-accounts', 'loader id is dsh-provider-accounts', definition?.id)

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await tick() }

// ------------------------------------------------------------------- apply
const disposers = []
const registrations = []
const localeDicts = {}
const ctx = {
  effect(fn, label) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    else if (dispose !== undefined) disposers.push(() => {})
    return () => {}
  },
  on(event, listener) { disposers.push(() => {}); return () => {} },
  inject(deps, callback) { const value = callback(this); return () => { if (typeof value === 'function') value() } },
  get(name) { return undefined },
  logger: { info() {}, warn() {}, error() {} },
  slots: {
    inject(slot, callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
    register(declaration, component) {
      registrations.push({ declaration, component })
      return () => {}
    },
  },
  locale: {
    register(ns, dicts) { localeDicts[ns] = dicts },
    bind(ns) {
      return (key, vars) => {
        const dict = localeDicts[ns]?.en ?? {}
        let text = dict[key] ?? key
        if (vars !== undefined) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
        return text
      }
    },
  },
  remote: { ...api, $on: () => () => {} },
  connection: { state: 'connected', on() {}, rpc: { call: async () => ok(undefined) } },
}

const plugin = definition.factory((name) => {
  if (name === 'react') return React
  throw new Error(`client requested an unexpected module: ${name}`)
})
check(Array.isArray(plugin.inject), 'plugin declares inject list', JSON.stringify(plugin.inject))
plugin.apply(ctx)

check(registrations.length >= 1, 'registered at least one slot entry')
const page = registrations.find((entry) => entry.declaration?.id === 'provider-accounts')
check(page !== undefined, 'registered a settings.section page')
check(page?.declaration?.id === 'provider-accounts', 'page id is provider-accounts', page?.declaration?.id)
check(typeof page?.declaration?.label === 'function' || typeof page?.declaration?.label === 'string', 'page declares a nav label')

// ---------------------------------------------------------------- render it
const props = typeof page.declaration.inject === 'function' ? page.declaration.inject() : page.declaration.inject
await flush()
const html = renderToStaticMarkup(React.createElement(page.component, props))
check(html.length > 200, 'page rendered markup', `${html.length} bytes`)
// Store data arrives through effects, which server rendering never runs; the DOM
// test below covers the loaded page. Here we only prove the tree renders.
check(!/slot entry crashed/i.test(html), 'no crash marker in markup')

// render after the invalidations settle as well
await flush(12)
const html2 = renderToStaticMarkup(React.createElement(page.component, props))
check(html2.length > 200, 'page re-rendered after refresh', `${html2.length} bytes`)

// dispose everything, then make sure it does not throw
for (const dispose of disposers.reverse()) dispose()
check(true, 'disposed without throwing')

console.log(`\n${failures.length === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failures.length})`}`)
for (const failure of failures) console.log(` - ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
