// Make the non-catalog vendors ordinary presets: the catalog list now carries
// their endpoint and protocol, and picking one discovers models and creates a
// declared route — no separate "vendor template" relay.
import fs from 'node:fs'

const FILE = 'C:/Users/Administrator/repos/dsh-provider-hub/plugin/client.js'
let source = fs.readFileSync(FILE, 'utf8')
const log = []
const write = () => fs.writeFileSync(FILE, source)
function once(search, replacement, label) {
  const count = source.split(search).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1, found ${count}`)
  source = source.replace(search, replacement)
  log.push(label)
  write()
}
function cut(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`${label}: start missing`)
  const end = source.indexOf(endMarker, start)
  if (end < 0) throw new Error(`${label}: end missing`)
  source = source.slice(0, start) + replacement + source.slice(end)
  log.push(label)
  write()
}

// 1. presets carry the declared endpoint/protocol for non-catalog vendors.
once(
  `\t\t\t{ id: 'grok-build', name: 'Grok Build (OAuth)', env: 'GROK_BUILD_OAUTH', oauth: true },`,
  `\t\t\t{ id: 'grok-build', name: 'Grok Build (OAuth)', env: 'GROK_BUILD_OAUTH', oauth: true },
\t\t\t{ id: 'huawei-maas', name: '华为云 MaaS', env: 'HUAWEI_MAAS_API_KEY', baseURL: 'https://api-ap-southeast-1.modelarts-maas.com/v1', api: 'openai-completions', hintKey: 'presetHuaweiMaasHint' },
\t\t\t{ id: 'workbuddy', name: 'WorkBuddy（网关）', env: 'WORKBUDDY_API_KEY', baseURL: 'http://127.0.0.1:8000/v1', api: 'openai-completions', hintKey: 'presetWorkbuddyHint' },`,
  'declared presets',
)

// 2. drop the template table and its fill action.
cut(
  `\t\t/**\n\t\t * Vendors that speak an OpenAI-compatible API but are not in the pi-ai`,
  `\t\t/** The three API protocols pi-ai accepts for a hand-declared route. */`,
  '',
  'drop template table',
)
cut(
  `\t\t\t/** Fill the custom-endpoint draft from a vendor template. */`,
  `\t\t\tconst discover = async () => {`,
  '',
  'drop fill action',
)

// 3. drop both template blocks (custom form + catalog form).
cut(
  `\t\t\t\th('div', { key: 'templates', className: 'pa-field' },`,
  `\t\t\t\th(Field, { key: 'id', id: \`\${fieldId}-cid\`, label: t('customId'), hint: t('customIdHint') },`,
  '',
  'drop custom template row',
)
cut(
  `\t\t\t\t// Vendors outside the pi-ai catalog still deserve a first-class entry`,
  `\t\t\t\th(Field, { key: 'name', id: \`\${fieldId}-name\`, label: t('providerName') },`,
  '',
  'drop catalog template row',
)

// 4. a declared preset discovers its own models in the catalog form.
once(
  `\t\t\tconst [oauthError, setOauthError] = React.useState(null)`,
  `\t\t\tconst [oauthError, setOauthError] = React.useState(null)
\t\t\t// Declared presets (endpoint + protocol in the preset itself) discover their
\t\t\t// models before the provider can be created.
\t\t\tconst [declaredModels, setDeclaredModels] = React.useState([])
\t\t\tconst [declaredBusy, setDeclaredBusy] = React.useState(false)
\t\t\tconst [declaredError, setDeclaredError] = React.useState(null)`,
  'declared state',
)

once(
  `\t\t\tconst submit = async () => {`,
  `\t\t\t/** Discover models for a declared preset, from the catalog form. */
\t\t\tconst discoverDeclared = async () => {
\t\t\t\tif (preset === undefined || preset.baseURL === undefined || declaredBusy) return
\t\t\t\tconst failure = apiKeyFailure(key.trim())
\t\t\t\tif (failure !== undefined) {
\t\t\t\t\tsetDeclaredError(t(failure))
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\tsetDeclaredBusy(true)
\t\t\t\tsetDeclaredError(null)
\t\t\t\tsetDeclaredModels([])
\t\t\t\tconst result = await operations.discover({ baseURL: preset.baseURL, api: preset.api, apiKey: key.trim() })
\t\t\t\tsetDeclaredBusy(false)
\t\t\t\tif (result.kind !== 'found') {
\t\t\t\t\tsetDeclaredError(result.message ?? t('testFailedLoad'))
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\tconst found = result.models.map(discoveredModel).filter((model) => model !== undefined)
\t\t\t\tif (found.length === 0) {
\t\t\t\t\tsetDeclaredError(t('discoverEmpty'))
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\tsetDeclaredModels(found)
\t\t\t}
\t\t\tconst submit = async () => {`,
  'declared discover',
)

// 5. submit creates a declared route for those presets.
once(
  `\t\t\t\t\t\t: preset.oauth === true
\t\t\t\t\t\t\t? (oauthStatus !== 'ok'
\t\t\t\t\t\t\t\t? { kind: 'invalid', key: 'grokLoginRequired' }
\t\t\t\t\t\t\t\t: await operations.ensureGrokProvider({ index: state.providers.length, label: label.trim().length > 0 ? label.trim() : oauthEmail ?? t('grokAccount') }))
\t\t\t\t\t\t\t: await operations.addCatalogProvider({ preset, name, label, key, ref: ref.trim() }))`,
  `\t\t\t\t\t\t: preset.oauth === true
\t\t\t\t\t\t\t? (oauthStatus !== 'ok'
\t\t\t\t\t\t\t\t? { kind: 'invalid', key: 'grokLoginRequired' }
\t\t\t\t\t\t\t\t: await operations.ensureGrokProvider({ index: state.providers.length, label: label.trim().length > 0 ? label.trim() : oauthEmail ?? t('grokAccount') }))
\t\t\t\t\t\t\t: preset.baseURL !== undefined
\t\t\t\t\t\t\t\t? (declaredModels.length === 0
\t\t\t\t\t\t\t\t\t? { kind: 'invalid', key: 'declaredNeedsModels' }
\t\t\t\t\t\t\t\t\t: await operations.addCustomProvider({
\t\t\t\t\t\t\t\t\t\tid: preset.id,
\t\t\t\t\t\t\t\t\t\tname,
\t\t\t\t\t\t\t\t\t\tapi: preset.api,
\t\t\t\t\t\t\t\t\t\tbaseURL: preset.baseURL,
\t\t\t\t\t\t\t\t\t\tmodels: declaredModels,
\t\t\t\t\t\t\t\t\t\tlabel,
\t\t\t\t\t\t\t\t\t\tkey,
\t\t\t\t\t\t\t\t\t\tref: ref.trim(),
\t\t\t\t\t\t\t\t\t}))
\t\t\t\t\t\t\t\t: await operations.addCatalogProvider({ preset, name, label, key, ref: ref.trim() }))`,
  'declared submit',
)

// 6. the catalog form shows the hint, the discover button and the result.
once(
  `\t\t\t\th('p', { key: 'hint', className: 'pa-hint' }, t('chooseProviderHint')),`,
  `\t\t\t\th('p', { key: 'hint', className: 'pa-hint' }, t('chooseProviderHint')),
\t\t\t\tpreset?.hintKey === undefined ? null : h('p', { key: 'presetHint', className: 'pa-hint' }, t(preset.hintKey)),
\t\t\t\tpreset?.baseURL === undefined ? null : h('div', { key: 'declared', className: 'pa-field' },
\t\t\t\t\th('p', { className: 'pa-hint' }, copy(t('declaredEndpoint'), { url: preset.baseURL })),
\t\t\t\t\th('div', { className: 'pa-rowActions' },
\t\t\t\t\t\th('button', {
\t\t\t\t\t\t\ttype: 'button',
\t\t\t\t\t\t\tclassName: 'pa-btnSecondary pa-btnSmall',
\t\t\t\t\t\t\tdisabled: busy || declaredBusy,
\t\t\t\t\t\t\tonClick: () => { void discoverDeclared() },
\t\t\t\t\t\t}, t(declaredBusy ? 'discovering' : 'discover')),
\t\t\t\t\t\tdeclaredModels.length === 0 ? null : h('span', { className: 'pa-chip' }, copy(t('discoverFound'), { count: declaredModels.length }))),
\t\t\t\t\tdeclaredError === null ? null : h('p', { className: 'pa-hint pa-error', role: 'alert' }, declaredError)),`,
  'catalog declared row',
)

// 7. labels: replace the template wording with per-preset hints.
once(
  `\t\t\tvendorTemplates: 'Vendor templates',
\t\t\tvendorTemplatesHint: 'Or start from a vendor template: it fills the custom form and switches tabs.',
\t\t\tvendorHuaweiMaasHint: 'Huawei Cloud MaaS: an OpenAI-compatible endpoint plus an API key from the ModelArts console. Swap the region segment (ap-southeast-1) for the one your console shows.',
\t\t\tvendorWorkbuddyHint: 'WorkBuddy has no public API: run the workbuddy2api gateway locally, create a key in its /admin panel, then point this route at it.',`,
  `\t\t\tpresetHuaweiMaasHint: 'Huawei Cloud MaaS: an OpenAI-compatible endpoint plus an API key from the ModelArts console. Swap the region segment (ap-southeast-1) for the one your console shows.',
\t\t\tpresetWorkbuddyHint: 'WorkBuddy has no public API: run the workbuddy2api gateway locally, create a key in its /admin panel, then paste that key here.',
\t\t\tdeclaredEndpoint: 'This preset declares its own endpoint: {url}',
\t\t\tdeclaredNeedsModels: 'Discover the models first.',
\t\t\tdiscovering: 'Discovering…',
\t\t\tdiscoverFound: '{count} models found',`,
  'en labels',
)
once(
  `\t\t\tvendorTemplates: '厂商模板',
\t\t\tvendorTemplatesHint: '也可以从厂商模板开始：会自动切到自定义端点并填好表单。',
\t\t\tvendorHuaweiMaasHint: '华为云 MaaS：OpenAI 兼容端点 + ModelArts 控制台创建的 API Key。把 ap-southeast-1 换成你控制台所在区域。',
\t\t\tvendorWorkbuddyHint: 'WorkBuddy 没有公开 API：本地跑 workbuddy2api 网关，在它的 /admin 面板创建密钥，再把这条路由指向该网关。',`,
  `\t\t\tpresetHuaweiMaasHint: '华为云 MaaS：OpenAI 兼容端点 + ModelArts 控制台创建的 API Key。把 ap-southeast-1 换成你控制台所在区域。',
\t\t\tpresetWorkbuddyHint: 'WorkBuddy 没有公开 API：本地跑 workbuddy2api 网关，在它的 /admin 面板创建密钥后把密钥填在这里。',
\t\t\tdeclaredEndpoint: '该预设自带端点：{url}',
\t\t\tdeclaredNeedsModels: '请先探测模型。',
\t\t\tdiscovering: '探测中…',
\t\t\tdiscoverFound: '找到 {count} 个模型',`,
  'zh labels',
)

console.log(`patched ${log.length}: ${log.join(', ')}`)
