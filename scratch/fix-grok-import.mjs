import fs from "node:fs"
const copy = "C:/Users/Administrator/repos/dsh-provider-accounts/scratch/index.testable.mjs"
let s = fs.readFileSync(copy, "utf8")
if (!s.includes("from './grok.js'")) { console.log("copy has no grok import yet") }
// The copy lives in scratch/, so the relative import must point at the plugin dir.
s = s.replace("from './grok.js'", "from 'file:///C:/Users/Administrator/repos/dsh-provider-accounts/plugin/grok.js'")
fs.writeFileSync(copy, s)
console.log("rewrote grok import in the harness copy")
