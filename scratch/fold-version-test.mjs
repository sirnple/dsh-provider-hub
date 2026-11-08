import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dsh-provider-hub/scratch/usage-test.mjs"
let s = fs.readFileSync(file, "utf8")

// Replace the extra scenario with assertions inside scenario 7's own home.
const start = s.indexOf("// the balance shape version must survive prune + reload")
const end = s.indexOf("console.log('\\nALL USAGE CHECKS PASSED')", start)
if (start < 0 || end < 0) throw new Error("bounds")
s = s.slice(0, start) + s.slice(end)

const anchor = `    host.disposers.forEach((dispose) => dispose())
    console.log('ok 7 OpenCode adapter maps usage, dollars and balance')`
if (!s.includes(anchor)) throw new Error("scenario 7 anchor")
s = s.replace(anchor, `    // The shape version is what lets a newer Host repair an old entry exactly
    // once; pruning must not drop it.
    const ledger = JSON.parse(readFileSync(\`\${ROOT}/tmp-home-usage-7/storages/provider-accounts/usage.json\`, 'utf8'))
    assert.equal(ledger.balances[key].version, 2, 'the probe stores the balance shape version')
    host.disposers.forEach((dispose) => dispose())

    // Re-reading through a fresh module (a restart) keeps the version, so the
    // snapshot does not look outdated.
    const reloaded = await makeHost(\`\${ROOT}/tmp-home-usage-7\`, { balanceKind: 'opencode-zen' })
    const snapshot = await readSnapshot(reloaded)
    assert.equal(snapshot.balances[key].version, 2, 'a reload keeps the balance shape version')
    reloaded.disposers.forEach((dispose) => dispose())
    console.log('ok 7 OpenCode adapter maps usage, dollars and balance')`)
fs.writeFileSync(file, s)
console.log("scenario 7 extended with version persistence")
