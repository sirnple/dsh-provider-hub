// Compact usage popover harness: the header pill opens a small panel with one
// row per account (meters + usage line + sparkline), replacing the old page.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const CLIENT = 'C:\\Users\\Administrator\\repos\\dsh-provider-accounts\\plugin\\client.js'
const USAGE = '/api/provider-accounts-usage'
const BALANCE = '/api/provider-accounts-balance'
const POLL_MS = 15_000
const DOLLAR = String.fromCharCode(36)

const failures = []
const check = (ok, label, detail) => {
  if (!ok) failures.push(detail === undefined ? label : `${label}: ${detail}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : detail === undefined ? '' : ` -> ${detail}`}`)
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:55099/' })
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

const NOW = Date.now()
const day = (at = NOW) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const METERS = [
  { id: 'fiveHour', percent: 4, usedUSD: 0, limitUSD: 12, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString(), status: 'ok' },
  { id: 'weekly', percent: 21, usedUSD: 0, limitUSD: 30, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString(), status: 'ok' },
  { id: 'monthly', percent: 100, usedUSD: 40, limitUSD: 60, resetsAt: new Date(NOW + 20 * 86_400_000).toISOString(), status: 'rate-limited' },
]
function snapshot(overrides = {}) {
  return {
    updatedAt: NOW - 60_000,
    providers: [
      { id: 'opencode-go', name: 'OpenCode Go', catalog: true, balanceKind: 'opencode-zen', activeRef: 'OPENCODE_GO_API_KEY' },
      { id: 'deepseek', name: 'DeepSeek', catalog: true, balanceKind: 'deepseek', activeRef: 'DEEPSEEK_API_KEY' },
    ],
    accounts: [
      {
        providerId: 'opencode-go', providerName: 'OpenCode Go', ref: 'OPENCODE_GO_API_KEY', label: '主账号', active: true,
        requests: 12, failures: 1, switches: 0, input: 12_000, output: 300, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        lastUsedAt: NOW - 180_000, lastError: { code: 'QUOTA', message: 'insufficient quota', at: NOW - 240_000 },
        days: { [day()]: { requests: 12, failures: 1, input: 12_000, output: 300 } },
      },
      {
        providerId: 'opencode-go', providerName: 'OpenCode Go', ref: 'OPENCODE_GO_2_API_KEY', label: '工作账号', active: false,
        requests: 0, failures: 0, switches: 2, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        lastUsedAt: null, lastError: null, days: {},
      },
      {
        providerId: 'deepseek', providerName: 'DeepSeek', ref: 'DEEPSEEK_API_KEY', label: 'DeepSeek', active: true,
        requests: 3, failures: 0, switches: 0, input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        lastUsedAt: NOW - 60_000, lastError: null, days: { [day()]: { requests: 3, failures: 0, input: 100, output: 20 } },
      },
    ],
    balances: {
      'opencode-go::OPENCODE_GO_API_KEY': {
        kind: 'opencode-zen', ok: true, fetchedAt: NOW - 120_000,
        fields: [{ key: 'balance', value: `${DOLLAR}12.34` }, { key: 'weeklySpend', value: `${DOLLAR}0.00 / ${DOLLAR}30.00` }],
        meters: structuredClone(METERS), error: null,
      },
      'deepseek::DEEPSEEK_API_KEY': {
        kind: 'deepseek', ok: true, fetchedAt: NOW - 120_000,
        fields: [{ key: 'balance', value: `${DOLLAR}5.00 CNY` }, { key: 'granted', value: `${DOLLAR}1.00 CNY` }],
        meters: [], error: null,
      },
    },
    ...overrides,
  }
}

const fetchCalls = []
let usageResponder = () => jsonResponse(200, snapshot())
let balanceResponder = () => jsonResponse(200, snapshot())
function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, body, text: JSON.stringify(body) }
}
globalThis.fetch = async (url, init) => {
  const call = { url: String(url), method: init?.method ?? 'GET', credentials: init?.credentials, at: Date.now() }
  fetchCalls.push(call)
  const answer = call.method === 'POST' ? balanceResponder() : usageResponder()
  return {
    ok: answer.ok,
    status: answer.status,
    json: async () => {
      if (typeof answer.body === 'string') throw new SyntaxError('not json')
      return answer.body
    },
    text: async () => (typeof answer.text === 'string' ? answer.text : JSON.stringify(answer.body)),
  }
}

const intervals = []
const cleared = []
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
globalThis.setInterval = (fn, ms, ...rest) => {
  const id = realSetInterval(fn, ms, ...rest)
  intervals.push({ id, ms })
  return id
}
globalThis.clearInterval = (id) => {
  cleared.push(id)
  return realClearInterval(id)
}

let definition
window.__ModuleLoader__ = { load(def) { definition = def } }
await import(pathToFileURL(CLIENT).href + `?t=${Date.now()}`)

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async (rounds = 10) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await tick() }) }

function makeRemote() {
  const view = (ns, value, revision) => ({ ns, autoGenerate: false, schema: { type: 'object' }, applies: 'live', revision, secrets: [], value })
  return {
    settings: {
      describe: async () => ({
        ok: true,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: [
            view('provider-accounts', { providers: [], failover: { enabled: true, codes: [], maxHops: 2 } }, 1),
            view('llm-pi-ai', { providers: {} }, 2),
          ],
        },
      }),
      mutate: async () => ({ ok: true, value: view('provider-accounts', {}, 2) }),
    },
    credentials: {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => ({ ok: true, value: undefined }),
      unset: async () => ({ ok: true, value: undefined }),
    },
    llm: {
      discoverModels: async () => ({ ok: true, value: [] }),
      listConfigurableProviders: async () => ({ ok: true, value: [] }),
    },
    $on: () => () => {},
  }
}

function setup(locale = 'en') {
  const registrations = []
  const dicts = {}
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    on() { return () => {} },
    inject(deps, callback) { const value = callback(this); return () => { if (typeof value === 'function') value() } },
    get() { return undefined },
    logger: { info() {}, warn() {}, error() {} },
    slots: {
      inject(slot, callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
      register(declaration, component) { registrations.push({ declaration, component }); return () => {} },
    },
    locale: {
      register(ns, dictionaries) { dicts[ns] = dictionaries },
      bind(ns) {
        return (key, vars) => {
          let text = dicts[ns]?.[locale]?.[key] ?? key
          if (vars !== undefined) for (const [name, value] of Object.entries(vars)) text = String(text).replaceAll(`{${name}}`, String(value))
          return text
        }
      },
    },
    remote: makeRemote(),
  }
  definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module: ${name}`)
  }).apply(ctx)
  return { registrations, dicts, disposers }
}

let mountCount = 0
async function mount(locale = 'en') {
  mountCount += 1
  const { registrations, dicts } = setup(locale)
  const registration = registrations.find((entry) => entry.declaration?.id === 'provider-usage')
  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = ReactDOMClient.createRoot(host)
  const props = registration.declaration.inject()
  await act(async () => { root.render(React.createElement(registration.component, props)) })
  await flush(14)
  const pill = host.querySelector('.pa-hud')
  if (pill !== null) {
    await act(async () => { pill.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await flush(10)
  }
  const container = window.document.body
  return {
    registration,
    registrations,
    dicts,
    host,
    pill,
    container,
    text: () => container.textContent ?? '',
    unmount: async () => {
      await act(async () => { root.unmount() })
      host.remove()
    },
  }
}

// ------------------------------------------------------- 1. registration shape
{
  const { registrations, dicts } = setup()
  const usage = registrations.find((entry) => entry.declaration?.id === 'provider-usage')
  const accounts = registrations.find((entry) => entry.declaration?.id === 'provider-accounts')
  check(registrations.length === 2, 'both surfaces register', String(registrations.length))
  check(usage?.declaration?.name === 'conversation.session.header.utilities', 'usage lives in the conversation header', usage?.declaration?.name)
  check(usage?.declaration?.order === 20, 'usage pill order is 20', String(usage?.declaration?.order))
  check(usage?.declaration?.label() === 'Usage & balance', 'pill label comes from the dictionary', usage?.declaration?.label())
  check(accounts?.declaration?.name === 'settings.section', 'the providers page stays a settings section', accounts?.declaration?.name)
  check(registrations.every((entry) => entry.declaration?.id !== 'provider-usage' || entry.declaration?.name !== 'settings.section'), 'usage is not in the settings nav any more')
  const en = dicts['provider-accounts']?.en ?? {}
  const zh = dicts['provider-accounts']?.zh ?? {}
  check(Object.keys(en).length === Object.keys(zh).length && Object.keys(en).every((key) => key in zh), 'dictionaries stay at key parity', `${Object.keys(en).length} en / ${Object.keys(zh).length} zh`)
  check(typeof en.usageLine === 'string' && typeof zh.usageLine === 'string', 'the compact usage line is localized', en.usageLine)
  check(typeof en.sparkLabel === 'string' && typeof zh.sparkLabel === 'string', 'the sparkline label is localized', en.sparkLabel)
}

// ------------------------------------------------------------ 2. pill + panel
{
  const page = await mount()
  const text = page.text()
  check(page.pill !== null, 'the header pill renders')
  check(page.pill?.getAttribute('aria-haspopup') === 'dialog', 'the pill advertises a dialog')
  check(page.pill?.getAttribute('aria-expanded') === 'true', 'clicking the pill expands it', page.pill?.getAttribute('aria-expanded'))
  check(!/[0-9]/.test(page.pill?.textContent ?? ''), 'the collapsed pill shows no numeric percentage', page.pill?.textContent)
  check(!(page.pill?.textContent ?? '').includes(DOLLAR), 'the collapsed pill shows no balance', page.pill?.textContent)
  check(page.pill?.querySelectorAll('.pa-hudBar').length === 3, 'the collapsed pill draws one bar per window of the quota-bearing provider', String(page.pill?.querySelectorAll('.pa-hudBar').length))
  check((page.pill?.getAttribute('title') ?? '').length > 0, 'the pill keeps a hover/tooltip summary', page.pill?.getAttribute('title'))
  check(page.container.querySelector('.pa-hudPanel') !== null, 'the panel renders in a portal')
  check(page.container.querySelector('.pu-pop') !== null, 'the panel uses the compact layout')
  check(text.includes('Usage and balance'), 'the panel keeps a short title')
  check(text.includes('Updated 1 min ago'), 'the snapshot age renders once', text.slice(0, 120))
  const blocks = [...page.container.querySelectorAll('.pu-block')]
  check(blocks.length === 2, 'one block per provider', String(blocks.length))
  const rows = [...page.container.querySelectorAll('.pu-row')]
  check(rows.length === 3, 'one row per account', String(rows.length))
  check(page.container.querySelectorAll('.pa-badge').length === 2, 'each active account is badged once', String(page.container.querySelectorAll('.pa-badge').length))
  check([...page.container.querySelectorAll('.pu-rowLabel')].map((node) => node.textContent).join(',') === '主账号,工作账号,DeepSeek', 'account labels render in order', [...page.container.querySelectorAll('.pu-rowLabel')].map((node) => node.textContent).join(','))

  const metered = rows[0]
  const meters = [...metered.querySelectorAll('[role="progressbar"]')]
  check(meters.length === 3, 'the metered row carries three progress bars', String(meters.length))
  check(meters.map((node) => node.getAttribute('aria-valuenow')).join(',') === '4,21,100', 'each bar reports its window', meters.map((node) => node.getAttribute('aria-valuenow')).join(','))
  check(meters.map((node) => node.querySelector('.pu-fill')?.style.width).join(',') === '4%,21%,100%', 'each fill matches its percentage', meters.map((node) => node.querySelector('.pu-fill')?.style.width).join(','))
  check(meters[2]?.querySelector('.pu-fill')?.getAttribute('class')?.includes('pu-gaugeFillDanger'), 'a fully used, rate-limited window fills with the danger tone', meters[2]?.querySelector('.pu-fill')?.getAttribute('class'))
  check((meters[0]?.getAttribute('aria-valuetext') ?? '') === `4% · ${DOLLAR}0.00 / ${DOLLAR}12.00`, 'the accessible value carries the dollars', meters[0]?.getAttribute('aria-valuetext'))
  check((meters[0]?.closest('.pu-meter')?.getAttribute('title') ?? '').includes(METERS[0].resetsAt), 'the title carries the exact reset time', meters[0]?.closest('.pu-meter')?.getAttribute('title'))
  check([...metered.querySelectorAll('.pu-meterTag')].map((node) => node.textContent).join(',') === '5h,wk,mo', 'the compact meter tags are short', [...metered.querySelectorAll('.pu-meterTag')].map((node) => node.textContent).join(','))
  check(metered.querySelector('.pu-chip')?.textContent === `${DOLLAR}12.34`, 'the account keeps its prepaid chip', metered.querySelector('.pu-chip')?.textContent)

  const usageText = metered.querySelector('.pu-usageText')?.textContent ?? ''
  check(usageText.includes('Today') && usageText.includes('12 req') && usageText.includes('1 fail'), 'the usage line carries today tokens, requests and failures', usageText)
  const spark = metered.querySelector('.pu-spark')
  check(spark?.querySelectorAll('rect').length === 14, 'the sparkline draws 14 bars', String(spark?.querySelectorAll('rect').length))
  check((spark?.getAttribute('aria-label') ?? '').includes('Daily tokens'), 'the sparkline is described for assistive tech', spark?.getAttribute('aria-label'))
  check(metered.querySelector('.pu-error')?.textContent.includes('QUOTA'), 'the last error stays one line', metered.querySelector('.pu-error')?.textContent)
  check(rows[1]?.querySelector('.pu-spark') === null, 'an account without day buckets draws no sparkline')
  check(rows[1]?.querySelector('[role="progressbar"]') === null, 'an account without a probe draws no meters')

  const fallback = rows[2]?.querySelector('.pu-quota')
  check(fallback !== null && fallback.querySelectorAll('[role="progressbar"]').length === 0, 'a balance-only account draws chips, not bars')
  check((fallback?.textContent ?? '').includes(`${DOLLAR}5.00 CNY`) && (fallback?.textContent ?? '').includes(`${DOLLAR}1.00 CNY`), 'the field chips carry the balances', fallback?.textContent)
  await page.unmount()
}

// --------------------------------------------------------- 3. empty and errors
{
  usageResponder = () => jsonResponse(200, { updatedAt: 0, providers: [], accounts: [], balances: {} })
  const empty = await mount()
  check(empty.container.querySelectorAll('.pu-block').length === 0, 'an empty snapshot draws no blocks')
  check((empty.container.querySelector('.pu-empty')?.textContent ?? '').length > 0, 'an empty snapshot explains itself', empty.container.querySelector('.pu-empty')?.textContent)
  await empty.unmount()
}
{
  usageResponder = () => jsonResponse(404, {})
  const unsupported = await mount()
  const emptyText = unsupported.container.querySelector('.pu-empty')?.textContent ?? ''
  check(emptyText.length > 0, 'a 404 explains the Host has no usage service', emptyText)
  check([...unsupported.container.querySelectorAll('button')].some((node) => (node.textContent ?? '').trim() === 'Retry'), 'the unsupported state offers retry')
  await unsupported.unmount()
}
{
  usageResponder = () => jsonResponse(200, '<html>not json</html>')
  const broken = await mount()
  check((broken.container.querySelector('.pu-error')?.textContent ?? '').length > 0, 'a non-JSON body is reported inline', broken.container.querySelector('.pu-error')?.textContent)
  await broken.unmount()
}

// ------------------------------------------------------------ 4. refresh flows
{
  usageResponder = () => jsonResponse(200, snapshot())
  const page = await mount()
  const before = fetchCalls.filter((call) => call.url === USAGE).length
  // The local snapshot refresh is gone by design: opening the panel reads once and
  // a slow poll keeps it fresh, so only the balance action stays in the header.
  const localRefresh = [...page.container.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === 'Refresh')
  check(localRefresh === undefined, 'the panel no longer offers a local refresh')
  check(before >= 1, 'mounting the panel read the snapshot once', String(before))
  balanceResponder = () => jsonResponse(200, snapshot())
  const balanceButton = [...page.container.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === 'Refresh balances')
  await act(async () => { balanceButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await flush(8)
  const posted = fetchCalls.find((call) => call.method === 'POST')
  check(posted?.url === BALANCE, 'the balance button posts to the balance route', posted?.url)
  check((page.container.textContent ?? '').toLowerCase().includes('refreshed'), 'a balance refresh reports success', page.container.querySelector('[role="status"]')?.textContent)
  await page.unmount()
}

// ------------------------------------------------------------ 5. poll lifecycle
{
  usageResponder = () => jsonResponse(200, snapshot())
  const page = await mount()
  const pollers = intervals.filter((timer) => timer.ms === POLL_MS)
  check(pollers.length === mountCount, 'every mounted panel starts one 20 s poll', String(pollers.length))
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  const before = fetchCalls.length
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, POLL_MS + 40)) })
  check(fetchCalls.length === before, 'a hidden document is not polled', String(fetchCalls.length - before))
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => 'visible' })
  await act(async () => { window.document.dispatchEvent(new window.Event('visibilitychange')) })
  await flush(6)
  check(fetchCalls.length > before, 'becoming visible refreshes once', String(fetchCalls.length - before))
  const pollId = pollers[pollers.length - 1]?.id
  await page.unmount()
  check(cleared.includes(pollId), 'the poll is cleared on unmount', `${pollId} not in [${cleared.join(',')}]`)
}

// --------------------------------------------------------------- 6. zh render
{
  usageResponder = () => jsonResponse(200, snapshot())
  const page = await mount('zh')
  const text = page.text()
  check(text.includes('用量与余额'), 'the panel title is translated', text.slice(0, 40))
  const zhRow = page.container.querySelectorAll('.pu-row')[0]
  check([...zhRow.querySelectorAll('.pu-meterTag')].map((node) => node.textContent).join(',') === '5h,周,月', 'the Chinese tags are short', [...zhRow.querySelectorAll('.pu-meterTag')].map((node) => node.textContent).join(','))
  check(text.includes('今日') && text.includes('请求') && text.includes('失败'), 'the Chinese usage line composes', page.container.querySelector('.pu-usageText')?.textContent)
  await page.unmount()
}

// ------------------------------------------- 7. provider without a quota probe
{
  usageResponder = () => jsonResponse(200, snapshot({
    providers: [{ id: 'xai', name: 'xAI', catalog: true, activeRef: 'XAI_API_KEY' }],
    accounts: [{
      providerId: 'xai', providerName: 'xAI', ref: 'XAI_API_KEY', label: 'Grok', active: true,
      requests: 2, failures: 0, switches: 0, input: 40, output: 9, cacheRead: 0, cacheWrite: 0, reasoning: 0,
      lastUsedAt: NOW - 60_000, lastError: null, days: {},
    }],
    balances: {},
  }))
  const page = await mount()
  const chips = [...(page.container.querySelectorAll('.pu-blockHead .pa-chip') ?? [])].map((node) => node.textContent)
  check(chips.includes('No quota API'), 'a provider without a probe says so', chips.join(','))
  check(page.container.querySelector('[role="progressbar"]') === null, 'no meters are invented for it')
  check((page.container.querySelector('.pu-usageText')?.textContent ?? '').includes('2 req'), 'local usage still renders for it', page.container.querySelector('.pu-usageText')?.textContent)
  await page.unmount()
}

globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval

console.log(`\n${failures.length === 0 ? 'USAGE DOM OK' : `USAGE DOM FAILED (${failures.length})`}`)
for (const failure of failures) console.log(` - ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
