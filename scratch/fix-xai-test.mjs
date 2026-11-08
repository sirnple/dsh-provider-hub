import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dsh-provider-hub/scratch/xai-test.mjs"
let s = fs.readFileSync(file, "utf8")
const a = `  const got = await collect(host.streamListeners[0].listener(options, () => (async function* () { for (const chunk of chunks) yield chunk })()))`
const b = `  const raw = () => (async function* () { for (const chunk of chunks) yield chunk })()
  // Production order: failover (outer) -> accounting (inner) -> adapter.
  const got = await collect(host.streamListeners[0].listener(options, () => host.streamListeners[1].listener(options, raw)))`
const n = s.split(a).length - 1
if (n !== 1) throw new Error("anchor: " + n)
fs.writeFileSync(file, s.replace(a, b))
console.log("wired accounting into the chain")
