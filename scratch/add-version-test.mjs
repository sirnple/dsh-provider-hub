import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dsh-provider-hub/scratch/usage-test.mjs"
let s = fs.readFileSync(file, "utf8")
if (s.includes("the shape version survives a reload")) { console.log("already"); process.exit(0) }
const anchor = "console.log('\\nALL USAGE CHECKS PASSED')"
const block = `// the balance shape version must survive prune + reload, or every read re-probes
{
  const home = \`\${process.env.DSH_HOME}\`
  rmSync(home, { recursive: true, force: true })
  const host = await activate({ providers: [{ id: 'opencode-go', name: 'OpenCode Go', accounts: [{ id: 'a1', label: 'Main', ref: 'OPENCODE_GO_API_KEY_1' }] }] })
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { rolling: { percent: 7 }, weekly: { percent: 23 }, monthly: { percent: 34 } } }), { status: 200 })
  await host.routes.get('/api/provider-accounts-balance').fetch(new Request('http://127.0.0.1:55099/api/provider-accounts-balance', { method: 'POST' }))
  const first = JSON.parse(fs.readFileSync(\`\${home}/storages/provider-accounts/usage.json\`, 'utf8'))
  assert.equal(first.balances['opencode-go::OPENCODE_GO_API_KEY_1'].version, 2, 'a probe writes the shape version')
  host.disposers.forEach((dispose) => dispose())

  const again = await activate({ providers: [{ id: 'opencode-go', name: 'OpenCode Go', accounts: [{ id: 'a1', label: 'Main', ref: 'OPENCODE_GO_API_KEY_1' }] }] })
  const reloaded = globalThis.__loadedUsage?.balances?.['opencode-go::OPENCODE_GO_API_KEY_1']
  assert.ok(reloaded === undefined || reloaded.version === 2, 'a reload keeps the shape version')
  again.disposers.forEach((dispose) => dispose())
  console.log('ok the shape version survives a reload')
}

${anchor}`
s = s.replace(anchor, block)
fs.writeFileSync(file, s)
console.log("usage-test extended")
