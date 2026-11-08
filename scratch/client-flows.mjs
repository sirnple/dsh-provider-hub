// Flow test for the provider-accounts page: catalog add, custom endpoint,
// provider delete with key removal, import-onboarding, and the read-only state.
// Mounts plugin/client.js in jsdom exactly like scratch/smoke-dom.mjs does.
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

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:55099/' })
const { window } = dom
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
	if (window[key] === undefined) continue
	try { globalThis[key] = window[key] } catch { /* read-only globals */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = window

const require = createRequire(import.meta.url)
const React = require('react')
const ReactDOMClient = require('react-dom/client')
const { act } = require('react-dom/test-utils')

function view(ns, value, revision) {
	return { ns, autoGenerate: false, schema: { type: 'object' }, applies: 'live', revision, secrets: [], value }
}
const state = {
	own: {
		providers: [],
		failover: { enabled: false, codes: ['QUOTA'], maxHops: 1 },
	},
	pi: {
		providers: {
			'legacy-x': { apiKeyEnv: 'LEGACY_X_API_KEY', api: 'openai-completions', baseURL: 'https://legacy.example/v1', models: [{ id: 'legacy-1', name: 'Legacy 1' }] },
		},
	},
	ownRevision: 1,
	piRevision: 2,
	writable: true,
	conflictNext: false,
}
const calls = []
const ok = (value) => ({ ok: true, value })
const fail = (code, message) => ({ ok: false, error: { code, message } })

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
		describe: async () => ok({
			writable: state.writable,
			hasDocument: true,
			namespaces: [view(NS, structuredClone(state.own), state.ownRevision), view(PI, structuredClone(state.pi), state.piRevision)],
		}),
		mutate: async (ns, ops, revision) => {
			calls.push({ kind: 'mutate', ns, ops, revision })
			if (state.conflictNext) {
				state.conflictNext = false
				return fail('settings/conflict', 'settings namespace changed since it was read')
			}
			if (ns === NS) {
				applyOps(state.own, ops)
				state.ownRevision += 1
				return ok(view(NS, structuredClone(state.own), state.ownRevision))
			}
			applyOps(state.pi, ops)
			state.piRevision += 1
			return ok(view(PI, structuredClone(state.pi), state.piRevision))
		},
	},
	credentials: {
		describe: async (refs) => {
			calls.push({ kind: 'credentials.describe', refs })
			return ok(Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }])))
		},
		set: async (ref, value) => { calls.push({ kind: 'credentials.set', ref, value }); return ok(undefined) },
		unset: async (ref) => { calls.push({ kind: 'credentials.unset', ref }); return ok(undefined) },
	},
	llm: {
		discoverModels: async (ns, request) => {
			calls.push({ kind: 'discover', ns, request })
			return ok([{ id: 'probe-model', name: 'Probe Model', contextWindow: 64000, maxTokens: 4096, inputModalities: ['text', 'image'] }])
		},
		listConfigurableProviders: async () => ok([]),
	},
	$on: (event, listener) => { listeners.set(event, listener); return () => { listeners.delete(event) } },
}

let definition
window.__ModuleLoader__ = { load(def) { definition = def } }
await import(pathToFileURL(CLIENT).href + `?t=${Date.now()}`)

const listeners = new Map()
const pending = []
const localeDicts = {}
let registered
const ctx = {
	effect(fn) { const dispose = fn(); pending.push(typeof dispose === 'function' ? dispose : () => {}); return () => {} },
	on(event, listener) { listeners.set(event, listener); return () => { listeners.delete(event) } },
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
			return (key) => localeDicts[ns]?.en?.[key] ?? key
		},
	},
	remote,
}
const plugin = definition.factory((name) => {
	if (name === 'react') return React
	return require(name)
})
plugin.apply(ctx)
check(registered?.declaration?.id === 'provider-accounts', 'page registered')

const props = registered.declaration.inject()
const container = window.document.getElementById('root')
const root = ReactDOMClient.createRoot(container)
const flush = async (rounds = 10) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }

await act(async () => { root.render(React.createElement(registered.component, props)) })
await flush(14)

const text = () => window.document.body.textContent ?? ''
const byText = (label, selector = 'button') => [...window.document.querySelectorAll(selector)].find((element) => (element.textContent ?? '').trim() === label)
const click = async (element, label) => {
	check(element !== undefined, `found ${label}`)
	if (element === undefined) return
	await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
	await flush(10)
}
const setValue = (element, value) => {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
	setter?.call(element, value)
	element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const fields = (predicate) => [...window.document.querySelectorAll('[role="dialog"] input, [role="dialog"] select')].filter(predicate)

// ---------------------------------------------------------------- empty state + import
check(text().includes('No provider is configured yet'), 'empty state renders')
check(text().includes('Import existing providers'), 'import card renders')
check(text().includes('legacy-x'), 'import card lists the detected route')
calls.length = 0
await click(byText('Import detected providers'), 'import')
const importWrite = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(importWrite !== undefined, 'import wrote provider-accounts')
check(importWrite?.ops?.[0]?.path?.join('.') === 'providers.0', 'import appends a provider entry', JSON.stringify(importWrite?.ops))
check(importWrite?.ops?.[0]?.value?.catalog === false && importWrite?.ops?.[0]?.value?.baseURL === 'https://legacy.example/v1', 'import copies api/baseURL and marks the route custom', JSON.stringify(importWrite?.ops?.[0]?.value))
check(importWrite?.ops?.[0]?.value?.accounts?.[0]?.ref === 'LEGACY_X_API_KEY', 'import reuses the route reference', JSON.stringify(importWrite?.ops?.[0]?.value?.accounts))
check(text().includes('legacy-x') && text().includes('LEGACY_X_API_KEY'), 'imported provider card renders')

// ---------------------------------------------------------------- catalog add
calls.length = 0
await click(byText('Add provider'), 'Add provider')
check(text().includes('From the catalog'), 'add-provider dialog opened')
const presetButton = [...window.document.querySelectorAll('[role="dialog"] button')].find((element) => (element.textContent ?? '').startsWith('OpenAI'))
await click(presetButton, 'catalog preset OpenAI')
const catalogName = fields((element) => element.tagName === 'INPUT' && element.type === 'text' && element.value === 'OpenAI')[0]
check(catalogName !== undefined, 'provider name defaults to the preset name')
const catalogKey = fields((element) => element.type === 'password')[0]
const catalogLabel = fields((element) => element.type === 'text' && element.value === 'Primary account')[0]
await act(async () => { setValue(catalogLabel, 'Team key') })
await act(async () => { setValue(catalogKey, 'sk-openai-abcdef') })
await flush(4)
await click(byText('Add provider', '[role="dialog"] button'), 'submit catalog provider')
const keyWrite = calls.find((call) => call.kind === 'credentials.set')
check(keyWrite?.ref === 'OPENAI_API_KEY', 'catalog credential ref derives from the route id', keyWrite?.ref)
const routeWrite = calls.find((call) => call.kind === 'mutate' && call.ns === PI)
check(routeWrite?.ops?.[0]?.path?.join('.') === 'providers.openai.apiKeyEnv', 'catalog route writes apiKeyEnv only', JSON.stringify(routeWrite?.ops))
check(routeWrite?.ops?.[0]?.value === 'OPENAI_API_KEY', 'catalog route points at the new key')
const entryWrite = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(entryWrite?.ops?.[0]?.value?.catalog === true, 'catalog provider entry is marked catalog', JSON.stringify(entryWrite?.ops))
check(entryWrite?.ops?.[0]?.path?.join('.') === 'providers.1', 'catalog provider appends after the imported one', JSON.stringify(entryWrite?.ops?.[0]?.path))
check(text().includes('OpenAI') && text().includes('OPENAI_API_KEY'), 'catalog provider card renders')

// ---------------------------------------------------------------- custom endpoint
calls.length = 0
await click(byText('Add provider'), 'Add provider (custom)')
await click(byText('Custom endpoint'), 'custom tab')
const idField = fields((element) => element.type === 'text' && element.value === '')[0]
check(idField !== undefined, 'custom provider id field is present')
await act(async () => { setValue(idField, 'acme-gateway') })
await flush(2)
const textFields = () => fields((element) => element.tagName === 'INPUT' && element.type === 'text')
await act(async () => { setValue(textFields()[1], 'Acme Gateway') })
const urlField = fields((element) => element.type === 'url')[0]
await act(async () => { setValue(urlField, 'https://acme.example/v1') })
const customKey = fields((element) => element.type === 'password')[0]
await act(async () => { setValue(customKey, 'sk-acme-123456') })
await flush(2)
await act(async () => { setValue(textFields()[2], 'Acme main') })
const discover = byText('Discover models')
await click(discover, 'Discover models')
check(calls.some((call) => call.kind === 'discover' && call.request?.baseURL === 'https://acme.example/v1' && call.request?.apiKey === 'sk-acme-123456'), 'discovery probed the draft endpoint', JSON.stringify(calls.filter((call) => call.kind === 'discover')))
check(text().includes('Probe Model') && text().includes('64000 / 4096'), 'discovered model list renders')
await click(byText('Add provider', '[role="dialog"] button'), 'submit custom provider')
const customKeyWrite = calls.filter((call) => call.kind === 'credentials.set').at(-1)
check(customKeyWrite?.ref === 'ACME_GATEWAY_API_KEY', 'custom credential ref derives from the id', customKeyWrite?.ref)
const customRoute = calls.filter((call) => call.kind === 'mutate' && call.ns === PI).at(-1)
const customProfile = customRoute?.ops?.[0]?.value
check(customRoute?.ops?.[0]?.path?.join('.') === 'providers.acme-gateway', 'custom route created wholesale', JSON.stringify(customRoute?.ops?.[0]?.path))
check(customProfile?.baseURL === 'https://acme.example/v1' && customProfile?.api === 'openai-completions', 'custom route carries endpoint and protocol', JSON.stringify(customProfile))
check(customProfile?.models?.[0]?.id === 'probe-model' && customProfile?.models?.[0]?.contextWindow === 64000, 'custom route carries discovered models', JSON.stringify(customProfile?.models))
const customEntry = calls.filter((call) => call.kind === 'mutate' && call.ns === NS).at(-1)?.ops?.[0]?.value
check(customEntry?.catalog === false && customEntry?.models?.[0]?.input?.join(',') === 'text,image', 'custom entry copies models with input modalities', JSON.stringify(customEntry?.models))

// ---------------------------------------------------------------- account edit / delete
const rowByLabel = (label) => [...window.document.querySelectorAll('li.pa-account')].find((element) => (element.textContent ?? '').includes(label))
const rowButton = (label, text) => [...rowByLabel(label).querySelectorAll('button')].find((element) => (element.textContent ?? '').trim() === text)

calls.length = 0
await click(byText('Add account'), 'Add account (existing provider)')
const addLabel = fields((element) => element.type === 'text')[0]
const addKey = fields((element) => element.type === 'password')[0]
await act(async () => { setValue(addLabel, 'Backup X') })
await act(async () => { setValue(addKey, 'sk-legacy-second') })
await flush(2)
await click(byText('Save account', '[role="dialog"] button'), 'save added account')
const addWrite = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
const addedAccounts = addWrite?.ops?.[0]?.value
check(addWrite?.ops?.[0]?.path?.join('.') === 'providers.0.accounts', 'adding an account rewrites the account list only', JSON.stringify(addWrite?.ops?.[0]?.path))
check(addedAccounts?.length === 2 && addedAccounts[1]?.ref === 'LEGACY_X_2_API_KEY', 'a second account gets a free reference', JSON.stringify(addedAccounts))
check(!calls.some((call) => call.kind === 'mutate' && call.ns === PI), 'adding an account does not repoint an existing route')

calls.length = 0
await click(rowButton('Backup X', 'Edit'), 'Edit (second account)')
const editLabel = fields((element) => element.type === 'text')[0]
const editKey = fields((element) => element.type === 'password')[0]
await act(async () => { setValue(editLabel, 'Backup X2') })
await act(async () => { setValue(editKey, 'sk-legacy-rotated') })
await flush(2)
await click(byText('Save account', '[role="dialog"] button'), 'save edited account')
check(calls.some((call) => call.kind === 'credentials.set' && call.ref === 'LEGACY_X_2_API_KEY' && call.value === 'sk-legacy-rotated'), 'editing stores a replacement key', JSON.stringify(calls.filter((call) => call.kind === 'credentials.set')))
const labelWrite = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(labelWrite?.ops?.[0]?.path?.join('.') === 'providers.0.accounts.1.label', 'editing writes only the label path', JSON.stringify(labelWrite?.ops))

// a provider whose route vanished is re-created from the page entry
state.pi.providers = {}
await act(async () => { listeners.get('settings/document-updated')?.() })
await flush(10)
calls.length = 0
await click(rowButton('Backup X2', 'Use'), 'Use (route missing)')
const recreated = calls.find((call) => call.kind === 'mutate' && call.ns === PI)
check(recreated?.ops?.[0]?.path?.join('.') === 'providers.legacy-x', 'activating without a route creates one', JSON.stringify(recreated?.ops))
check(recreated?.ops?.[0]?.value?.apiKeyEnv === 'LEGACY_X_2_API_KEY' && recreated?.ops?.[0]?.value?.baseURL === 'https://legacy.example/v1', 'the re-created route carries the provider endpoint', JSON.stringify(recreated?.ops?.[0]?.value))
state.pi.providers = { 'legacy-x': { apiKeyEnv: 'LEGACY_X_2_API_KEY', api: 'openai-completions', baseURL: 'https://legacy.example/v1', models: [{ id: 'legacy-1', name: 'Legacy 1' }] } }
await act(async () => { listeners.get('settings/document-updated')?.() })
await flush(10)

calls.length = 0
await click(rowButton('Backup X2', 'Delete'), 'Delete (active account)')
await click(byText('Delete account', '[role="dialog"] button'), 'confirm delete account')
const removeWrite = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(removeWrite?.ops?.[0]?.op === 'unset' && removeWrite?.ops?.[0]?.path?.join('.') === 'providers.0.accounts.1', 'removing an account unsets its index', JSON.stringify(removeWrite?.ops))
const repoint = calls.find((call) => call.kind === 'mutate' && call.ns === PI)
check(repoint?.ops?.[0]?.path?.join('.') === 'providers.legacy-x.apiKeyEnv' && repoint?.ops?.[0]?.value === 'LEGACY_X_API_KEY', 'removing the active account repoints the route', JSON.stringify(repoint?.ops))
check(!calls.some((call) => call.kind === 'credentials.unset'), 'keys are kept unless key deletion is chosen')

// ---------------------------------------------------------------- delete provider with keys
calls.length = 0
const deleteButtons = [...window.document.querySelectorAll('button')].filter((element) => (element.textContent ?? '').trim() === 'Delete provider')
await click(deleteButtons[0], 'Delete provider (first card)')
check(text().includes('Also delete the saved keys'), 'delete confirmation offers key deletion')
const checkbox = window.document.querySelector('[role="dialog"] input[type="checkbox"]')
check(checkbox !== undefined, 'delete confirmation has a checkbox')
await act(async () => { checkbox.click() })
await flush(2)
await click(byText('Delete provider', '[role="dialog"] button'), 'confirm delete')
const unsetRoute = calls.find((call) => call.kind === 'mutate' && call.ns === PI)
check(unsetRoute?.ops?.[0]?.op === 'unset' && unsetRoute?.ops?.[0]?.path?.join('.') === 'providers.legacy-x', 'delete unsets the pi-ai route', JSON.stringify(unsetRoute?.ops))
const unsetEntry = calls.find((call) => call.kind === 'mutate' && call.ns === NS)
check(unsetEntry?.ops?.[0]?.op === 'unset' && unsetEntry?.ops?.[0]?.path?.join('.') === 'providers.0', 'delete unsets the provider entry', JSON.stringify(unsetEntry?.ops))
check(calls.some((call) => call.kind === 'credentials.unset' && call.ref === 'LEGACY_X_API_KEY'), 'delete removed the saved key', JSON.stringify(calls.filter((call) => call.kind === 'credentials.unset')))
check(!text().includes('LEGACY_X_API_KEY'), 'deleted provider card is gone')

// ---------------------------------------------------------------- conflict handling
calls.length = 0
state.conflictNext = true
const failoverSwitch = window.document.querySelector('[role="switch"]')
await click(failoverSwitch, 'failover switch during conflict')
const conflictNotice = [...window.document.querySelectorAll('[role="alert"]')].map((element) => element.textContent).join(' | ')
check(conflictNotice.includes('changed elsewhere'), 'conflict is reported inline', conflictNotice)
check(calls.some((call) => call.kind === 'mutate'), 'conflict attempt reached the host')
await flush(6)

// ---------------------------------------------------------------- read-only deployment
state.writable = false
await act(async () => { listeners.get('settings/document-updated')?.() })
await flush(12)
const readOnlyText = text()
check(readOnlyText.includes('read-only'), 'read-only notice renders')
const disabledAdd = [...window.document.querySelectorAll('button')].filter((element) => (element.textContent ?? '').trim() === 'Add provider').every((element) => element.disabled)
check(disabledAdd, 'write controls are disabled while read-only')
check(window.document.querySelector('[role="switch"]')?.disabled === true, 'failover switch is disabled while read-only')

console.log('\n' + (failures.length === 0 ? 'FLOWS OK' : `FLOWS FAILED (${failures.length})`))
for (const failure of failures) console.log(` - ${failure}`)
await act(async () => { root.unmount() })
for (const dispose of pending.reverse()) dispose()
process.exit(failures.length === 0 ? 0 : 1)
