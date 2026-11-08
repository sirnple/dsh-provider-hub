// Minimal asar reader/extractor.
// usage: node asar.mjs list <asar> [prefix]  |  node asar.mjs extract <asar> <outDir> [prefix]
import fs from 'node:fs'
import path from 'node:path'

const [cmd, asarPath, arg2, arg3] = process.argv.slice(2)
const fd = fs.openSync(asarPath, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 16)
const header = JSON.parse(headerBuf.toString('utf8'))
const dataOffset = 16 + headerSize

function walk (node, prefix, cb) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const rel = prefix ? prefix + '/' + name : name
    if (child.files) walk(child, rel, cb)
    else if (typeof child.offset === 'string' || typeof child.offset === 'number') cb(rel, child)
    else cb(rel, child)
  }
}

if (cmd === 'list') {
  const filter = arg2 || ''
  const out = []
  walk(header, '', (rel) => { if (rel.includes(filter)) out.push(rel) })
  process.stdout.write(out.join('\n') + '\n')
} else if (cmd === 'extract') {
  const outDir = arg2
  const filter = arg3 || ''
  let n = 0
  walk(header, '', (rel, node) => {
    if (filter && !rel.includes(filter)) return
    if (node.unpacked) return
    const dest = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const size = Number(node.size)
    const offset = dataOffset + Number(node.offset)
    const buf = Buffer.alloc(size)
    if (size > 0) fs.readSync(fd, buf, 0, size, offset)
    fs.writeFileSync(dest, buf)
    n++
  })
  process.stdout.write(`extracted ${n} files to ${outDir}\n`)
}
