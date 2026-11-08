import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dsh-provider-accounts/scratch/usage-dom.mjs"
let s = fs.readFileSync(file, "utf8")
const a = "  check(page.pill?.querySelectorAll('.pa-hudBar').length === 6, 'the collapsed pill still draws both providers as bars', String(page.pill?.querySelectorAll('.pa-hudBar').length))"
const b = "  check(page.pill?.querySelectorAll('.pa-hudBar').length === 3, 'the collapsed pill draws one bar per window of the quota-bearing provider', String(page.pill?.querySelectorAll('.pa-hudBar').length))"
const n = s.split(a).length - 1
if (n !== 1) throw new Error("anchor: " + n)
fs.writeFileSync(file, s.replace(a, b))
console.log("assertion adjusted")
