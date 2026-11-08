import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dshx/scratch/usage-dom.mjs"
let s = fs.readFileSync(file, "utf8")
const anchor = "  check(page.container.querySelector('.pa-hudPanel') !== null, 'the panel renders in a portal')"
const add = `  check(!/[0-9]/.test(page.pill?.textContent ?? ''), 'the collapsed pill shows no numeric percentage', page.pill?.textContent)
  check(!(page.pill?.textContent ?? '').includes('$'), 'the collapsed pill shows no balance', page.pill?.textContent)
  check(page.pill?.querySelectorAll('.pa-hudBar').length === 6, 'the collapsed pill still draws both providers as bars', String(page.pill?.querySelectorAll('.pa-hudBar').length))
${anchor}`
const n = s.split(anchor).length - 1
if (n !== 1) throw new Error("anchor: " + n)
s = s.replace(anchor, add)
fs.writeFileSync(file, s)
console.log("harness asserts the numbers-free collapsed pill")
