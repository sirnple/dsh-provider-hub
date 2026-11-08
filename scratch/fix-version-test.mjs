import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dsh-provider-hub/scratch/usage-test.mjs"
let s = fs.readFileSync(file, "utf8")
const start = s.indexOf("// the balance shape version must survive prune + reload")
const end = s.indexOf("console.log('\\nALL USAGE CHECKS PASSED')", start)
if (start < 0 || end < 0) throw new Error("block bounds")
const block = `// the balance shape version must survive prune + reload, or every read re-probes
{
  const home = \`\${ROOT}/tmp-home-version\`
  rmSync(home, { recursive: true, force: true })
  const first = await makeHost(home, { balance: { rolling: { percent: 7 } } })
  await first.routes.get('/api/provider-accounts-balance').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))
  const stored = JSON.parse(fs.readFileSync(\`\${home}/storages/provider-accounts/usage.json\`, 'utf8'))
  assert.equal(stored.balances['opencode-go::OPENCODE_GO_API_KEY_1'].version, 2, 'a probe writes the shape version')
  first.disposers.forEach((dispose) => dispose())

  // A reload re-prunes; the version must come back, not be dropped.
  const second = await makeHost(home)
  const snapshot = await readSnapshot(second)
  assert.equal(snapshot.balances['opencode-go::OPENCODE_GO_API_KEY_1'].version, 2, 'a reload keeps the shape version')
  second.disposers.forEach((dispose) => dispose())
  console.log('ok the shape version survives a reload')
}

`
s = s.slice(0, start) + block + s.slice(end)
if (!s.includes("import { rmSync }")) s = s.replace("import fs from 'node:fs'", "import fs, { rmSync } from 'node:fs'")
fs.writeFileSync(file, s)
console.log("test rewritten for this harness")
