import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dshx/scratch/grok-test.mjs"
let s = fs.readFileSync(file, "utf8")
const a = `// ---------------------------------------------------------------- 1. adapter
{
  const host = await activate()`
const b = `// ---------------------------------------------------------------- 1. adapter
{
  const host = await activate({ tokens: { accessToken: ACCESS, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } })`
const n = s.split(a).length - 1
if (n !== 1) throw new Error("anchor: " + n)
fs.writeFileSync(file, s.replace(a, b))
console.log("scenario 1 signs in")
