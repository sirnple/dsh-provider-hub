// Add one-click vendor templates to the custom-endpoint form, starting with
// Huawei Cloud MaaS (OpenAI-compatible endpoint + API key).
import fs from 'node:fs'

const FILE = 'C:/Users/Administrator/repos/dsh-provider-hub/plugin/client.js'
let source = fs.readFileSync(FILE, 'utf8')
const done = []
function once(search, replacement, label) {
  const count = source.split(search).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1, found ${count}`)
  source = source.replace(search, replacement)
  done.push(label)
  fs.writeFileSync(FILE, source)
}
function insertAt(marker, block, label) {
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`${label}: marker missing`)
  const lineStart = source.lastIndexOf('\n', at) + 1
  source = source.slice(0, lineStart) + block + source.slice(lineStart)
  done.push(label)
  fs.writeFileSync(FILE, source)
}

// 1. the template table, next to PROTOCOLS.
insertAt(
  '\t\t/** The three API protocols pi-ai accepts for a hand-declared route. */',
  `\t\t/**
\t\t * Vendors that speak an OpenAI-compatible API but are not in the pi-ai
\t\t * catalog. Filling the form from one of these leaves the route hand-declared:
\t\t * the endpoint, the protocol and the credential reference are pre-set, the key
\t\t * stays the user's.
\t\t */
\t\tconst PROVIDER_TEMPLATES = [
\t\t\t{
\t\t\t\tid: 'huawei-maas',
\t\t\t\tname: '华为云 MaaS',
\t\t\t\tprotocol: 'openai-completions',
\t\t\t\tbaseURL: 'https://api-ap-southeast-1.modelarts-maas.com/v1',
\t\t\t\tref: 'HUAWEI_MAAS_API_KEY',
\t\t\t\thintKey: 'vendorHuaweiMaasHint',
\t\t\t},
\t\t]

`,
  'template table',
)

// 2. the fill action, next to discover().
once(
  `\t\t\tconst discover = async () => {`,
  `\t\t\t/** Fill the custom-endpoint draft from a vendor template. */
\t\t\tconst applyTemplate = (template) => {
\t\t\t\tsetCustomId(template.id)
\t\t\t\tsetCustomName(template.name)
\t\t\t\tsetProtocol(template.protocol)
\t\t\t\tsetBaseUrl(template.baseURL)
\t\t\t\tsetCustomRef(template.ref)
\t\t\t\tsetModels([])
\t\t\t\tsetError(null)
\t\t\t}
\t\t\tconst discover = async () => {`,
  'fill action',
)

// 3. the row itself, first field of the custom form.
once(
  `\t\t\tconst customBody = [`,
  `\t\t\tconst customBody = [
\t\t\t\th('div', { key: 'templates', className: 'pa-field' },
\t\t\t\t\th('span', { className: 'pa-label' }, t('vendorTemplates')),
\t\t\t\t\th('div', { className: 'pa-rowActions' },
\t\t\t\t\t\tPROVIDER_TEMPLATES.map((template) => h('button', {
\t\t\t\t\t\t\tkey: template.id,
\t\t\t\t\t\t\ttype: 'button',
\t\t\t\t\t\t\tclassName: 'pa-btnSecondary pa-btnSmall',
\t\t\t\t\t\t\tdisabled: busy,
\t\t\t\t\t\t\tonClick: () => applyTemplate(template),
\t\t\t\t\t\t}, template.name))),
\t\t\t\t\th('p', { className: 'pa-hint' }, t('vendorHuaweiMaasHint'))),`,
  'template row',
)

// 4. labels.
once(
  `\t\t\tnativeProviderHint: 'Served by the plugin\\'s built-in adapter (OAuth).`,
  `\t\t\tvendorTemplates: 'Vendor templates',
\t\t\tvendorHuaweiMaasHint: 'Huawei Cloud MaaS: an OpenAI-compatible endpoint plus an API key from the ModelArts console. Swap the region segment (ap-southeast-1) for the one your console shows.',
\t\t\tnativeProviderHint: 'Served by the plugin\\'s built-in adapter (OAuth).`,
  'en labels',
)
once(
  `\t\t\tnativeProviderHint: '该提供商由插件内置适配器（OAuth）直接提供`,
  `\t\t\tvendorTemplates: '厂商模板',
\t\t\tvendorHuaweiMaasHint: '华为云 MaaS：OpenAI 兼容端点 + ModelArts 控制台创建的 API Key。把 ap-southeast-1 换成你控制台所在区域。',
\t\t\tnativeProviderHint: '该提供商由插件内置适配器（OAuth）直接提供`,
  'zh labels',
)

console.log(`patched ${done.length}: ${done.join(', ')}`)
