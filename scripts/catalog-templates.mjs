// Surface the vendor templates in the catalog tab too: picking one switches to
// the custom form, pre-filled, so they are findable without knowing the tab.
import fs from 'node:fs'

const FILE = 'C:/Users/Administrator/repos/dsh-provider-hub/plugin/client.js'
let source = fs.readFileSync(FILE, 'utf8')

if (source.includes("key: 'templates', className: 'pa-field' },\n" + '\t'.repeat(9))) {
  console.log('already present in the catalog form')
  process.exit(0)
}

const anchor = 'onSelect: () => choose(candidate),'
const at = source.indexOf(anchor)
if (at < 0) throw new Error('preset candidate anchor missing')

// end of the list expression: the "})))," that closes visible.map(...)
const close = source.indexOf('}))),', at)
if (close < 0) throw new Error('list close missing')
const after = close + '}))),'.length

// indentation of the "visible.length === 0" line
const visibleLine = source.lastIndexOf('\n', at)
const lineStart = source.lastIndexOf('\n', visibleLine - 1) + 1
const indent = /^[\t ]*/.exec(source.slice(lineStart, visibleLine))[0]

const block = [
  '',
  `${indent}// Vendors outside the pi-ai catalog still deserve a first-class entry`,
  `${indent}// point: picking one switches to the custom form, pre-filled.`,
  `${indent}h('div', { key: 'templates', className: 'pa-field' },`,
  `${indent}\th('span', { className: 'pa-label' }, t('vendorTemplates')),`,
  `${indent}\th('ul', { className: 'pa-templateList' },`,
  `${indent}\t\tPROVIDER_TEMPLATES.map((template) => h('li', { key: template.id, className: 'pa-templateItem' },`,
  `${indent}\t\t\th('button', {`,
  `${indent}\t\t\t\ttype: 'button',`,
  `${indent}\t\t\t\tclassName: 'pa-btnSecondary pa-btnSmall',`,
  `${indent}\t\t\t\tdisabled: busy,`,
  `${indent}\t\t\t\tonClick: () => {`,
  `${indent}\t\t\t\t\tapplyTemplate(template)`,
  `${indent}\t\t\t\t\tsetMode('custom')`,
  `${indent}\t\t\t\t},`,
  `${indent}\t\t\t}, template.name),`,
  `${indent}\t\t\th('span', { className: 'pa-hint' }, t(template.hintKey))))),`,
  `${indent}\th('p', { className: 'pa-hint' }, t('vendorTemplatesHint'))),`,
].join('\n')

source = source.slice(0, after) + block + source.slice(after)
fs.writeFileSync(FILE, source)
console.log('catalog form now lists the vendor templates')
