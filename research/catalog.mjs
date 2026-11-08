// Build the catalog provider preset list from the installed pi-ai package.
import fs from 'node:fs'
import path from 'node:path'

const DIST = 'C:/Users/Administrator/repos/dshx/asar/dsh/node_modules/@earendil-works/pi-ai/dist'
const envSrc = fs.readFileSync(path.join(DIST, 'env-api-keys.js'), 'utf8')
const envMap = {}
for (const match of envSrc.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z0-9_-]+)):\s*"([^"]+)"/gm)) {
  envMap[match[1] ?? match[2]] = match[3]
}

const files = fs.readdirSync(path.join(DIST, 'providers')).filter((f) => f.endsWith('.js') && !f.endsWith('.models.js') && f !== 'all.js')
const list = []
for (const file of files) {
  const src = fs.readFileSync(path.join(DIST, 'providers', file), 'utf8')
  const id = src.match(/id:\s*"([^"]+)"/)?.[1]
  const name = src.match(/name:\s*"([^"]+)"/)?.[1]
  if (!id || !name) continue
  const env = envMap[id]
  list.push({ id, name, env: env ?? null })
}
list.sort((a, b) => a.id.localeCompare(b.id))
fs.writeFileSync('C:/Users/Administrator/repos/dshx/research/catalog-providers.json', JSON.stringify(list, null, 2))
console.log(`${list.length} catalog providers`)
console.log(list.map((p) => `${p.id} | ${p.name} | ${p.env ?? '-'}`).join('\n'))
