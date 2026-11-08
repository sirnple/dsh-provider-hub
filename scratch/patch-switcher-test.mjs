// Extend the DOM harness with the new per-provider account switcher.
import fs from 'node:fs'

const FILE = 'C:/Users/Administrator/repos/dsh-provider-accounts/scratch/smoke-dom.mjs'
let source = fs.readFileSync(FILE, 'utf8')
const anchor = `// 4. add-provider dialog lists catalog presets`
if (!source.includes(anchor)) throw new Error('anchor not found')
if (source.includes('account switcher exposes one button per account')) {
  console.log('already patched')
  process.exit(0)
}

const block = `// 3b. per-provider account switcher
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

`

source = source.replace(anchor, block + anchor)
fs.writeFileSync(FILE, source)
console.log('patched smoke-dom with the account switcher scenario')
