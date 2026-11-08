import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dsh-provider-hub/scratch/usage-dom.mjs"
let s = fs.readFileSync(file, "utf8")
const anchor = "globalThis.setInterval = realSetInterval\n"
const n = s.split(anchor).length - 1
if (n !== 1) throw new Error("anchor: " + n)
const block = `// ------------------------------------------- 7. provider without a quota probe
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

`
s = s.replace(anchor, block + anchor)
fs.writeFileSync(file, s)
console.log("added the no-probe scenario")
