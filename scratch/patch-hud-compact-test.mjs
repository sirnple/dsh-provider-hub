// Assert the compact pill shape: stacked mini bars, one worst-percentage number,
// the prepaid chip, and no provider-name text that could overflow a narrow header.
import fs from 'node:fs'

const FILE = 'C:/Users/Administrator/repos/dshx/scratch/usage-dom.mjs'
let source = fs.readFileSync(FILE, 'utf8')
const anchor = `check(container.querySelector('.pa-hudPanel') !== null, 'the panel renders in a portal')`
if (!source.includes(anchor)) throw new Error('anchor not found')
if (source.includes('the pill stays compact')) {
  console.log('already patched')
  process.exit(0)
}

const block = `${anchor}
const stacks = [...(page.pill?.querySelectorAll('.pa-hudStack') ?? [])]
check(stacks.length === 1, 'the pill draws one bar stack per provider', String(stacks.length))
check(stacks[0]?.querySelectorAll('.pa-hudBar').length === 3, 'the stack holds one bar per quota window', String(stacks[0]?.querySelectorAll('.pa-hudBar')?.length))
check([...(stacks[0]?.querySelectorAll('.pa-hudBarFill') ?? [])].map((node) => node.style.width).join(',') === '4%,21%,100%', 'each mini bar is as wide as its window', [...(stacks[0]?.querySelectorAll('.pa-hudBarFill') ?? [])].map((node) => node.style.width).join(','))
check(page.pill?.querySelector('.pa-hudWorst')?.textContent === '100%', 'the pill shows the worst window as one number', page.pill?.querySelector('.pa-hudWorst')?.textContent)
check(page.pill?.querySelector('.pa-hudBalance')?.textContent === '$12.34', 'the pill keeps the prepaid chip', page.pill?.querySelector('.pa-hudBalance')?.textContent)
check(page.pill?.querySelector('.pa-hudName') === null, 'the pill stays compact: no provider name to overflow', String(page.pill?.querySelector('.pa-hudName')))
check((page.pill?.textContent ?? '').replace(/\\s+/g, '').length <= 24, 'the pill text stays short', page.pill?.textContent)
check((page.pill?.getAttribute('aria-label') ?? '').includes('5h') && (page.pill?.getAttribute('aria-label') ?? '').includes('100%'), 'the accessible label still carries every window', page.pill?.getAttribute('aria-label'))`

source = source.replace(anchor, block)
fs.writeFileSync(FILE, source)
console.log('patched usage-dom with compact-pill assertions')
