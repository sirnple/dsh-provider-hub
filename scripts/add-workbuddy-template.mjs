// Second vendor template: WorkBuddy via the workbuddy2api gateway, plus a
// per-template hint layout (one hint per vendor, not one for all of them).
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

// 1. the WorkBuddy template.
once(
  `\t\t\t\tid: 'huawei-maas',
\t\t\t\tname: '华为云 MaaS',
\t\t\t\tprotocol: 'openai-completions',
\t\t\t\tbaseURL: 'https://api-ap-southeast-1.modelarts-maas.com/v1',
\t\t\t\tref: 'HUAWEI_MAAS_API_KEY',
\t\t\t\thintKey: 'vendorHuaweiMaasHint',
\t\t\t},`,
  `\t\t\t\tid: 'huawei-maas',
\t\t\t\tname: '华为云 MaaS',
\t\t\t\tprotocol: 'openai-completions',
\t\t\t\tbaseURL: 'https://api-ap-southeast-1.modelarts-maas.com/v1',
\t\t\t\tref: 'HUAWEI_MAAS_API_KEY',
\t\t\t\thintKey: 'vendorHuaweiMaasHint',
\t\t\t},
\t\t\t{
\t\t\t\tid: 'workbuddy',
\t\t\t\tname: 'WorkBuddy（网关）',
\t\t\t\tprotocol: 'openai-completions',
\t\t\t\tbaseURL: 'http://127.0.0.1:8000/v1',
\t\t\t\tref: 'WORKBUDDY_API_KEY',
\t\t\t\thintKey: 'vendorWorkbuddyHint',
\t\t\t},`,
  'workbuddy template',
)

// 2. one hint per template, beside its button.
once(
  `\t\t\t\th('div', { key: 'templates', className: 'pa-field' },
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
  `\t\t\t\th('div', { key: 'templates', className: 'pa-field' },
\t\t\t\t\th('span', { className: 'pa-label' }, t('vendorTemplates')),
\t\t\t\t\th('ul', { className: 'pa-templateList' },
\t\t\t\t\t\tPROVIDER_TEMPLATES.map((template) => h('li', { key: template.id, className: 'pa-templateItem' },
\t\t\t\t\t\t\th('button', {
\t\t\t\t\t\t\t\ttype: 'button',
\t\t\t\t\t\t\t\tclassName: 'pa-btnSecondary pa-btnSmall',
\t\t\t\t\t\t\t\tdisabled: busy,
\t\t\t\t\t\t\t\tonClick: () => applyTemplate(template),
\t\t\t\t\t\t\t}, template.name),
\t\t\t\t\t\t\th('span', { className: 'pa-hint' }, t(template.hintKey)))))),`,
  'per-template hints',
)

// 3. labels.
once(
  `\t\t\tvendorHuaweiMaasHint: 'Huawei Cloud MaaS: an OpenAI-compatible endpoint plus an API key from the ModelArts console. Swap the region segment (ap-southeast-1) for the one your console shows.',`,
  `\t\t\tvendorHuaweiMaasHint: 'Huawei Cloud MaaS: an OpenAI-compatible endpoint plus an API key from the ModelArts console. Swap the region segment (ap-southeast-1) for the one your console shows.',
\t\t\tvendorWorkbuddyHint: 'WorkBuddy has no public API: run the workbuddy2api gateway locally, create a key in its /admin panel, then point this route at it.',`,
  'en workbuddy hint',
)
once(
  `\t\t\tvendorHuaweiMaasHint: '华为云 MaaS：OpenAI 兼容端点 + ModelArts 控制台创建的 API Key。把 ap-southeast-1 换成你控制台所在区域。',`,
  `\t\t\tvendorHuaweiMaasHint: '华为云 MaaS：OpenAI 兼容端点 + ModelArts 控制台创建的 API Key。把 ap-southeast-1 换成你控制台所在区域。',
\t\t\tvendorWorkbuddyHint: 'WorkBuddy 没有公开 API：本地跑 workbuddy2api 网关，在它的 /admin 面板创建密钥，再把这条路由指向该网关。',`,
  'zh workbuddy hint',
)

// 4. styles for the list.
once(
  `.pa-grokStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}`,
  `.pa-grokStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.pa-templateList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;min-width:0}
.pa-templateItem{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-width:0}`,
  'template list styles',
)

console.log(`patched ${done.length}: ${done.join(', ')}`)
