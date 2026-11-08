const fs = require('node:fs')
const source = fs.readFileSync('C:/Users/Administrator/repos/dsh-provider-hub/plugin/client.js', 'utf8')

function dictKeys(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`no dict ${name}`)
  const end = source.indexOf('\n\t\t}', start)
  const block = source.slice(start, end)
  return [...block.matchAll(/\n\t\t\t([A-Za-z0-9_]+):/g)].map((match) => match[1])
}

const en = dictKeys('en')
const zh = dictKeys('zh')
const used = [...source.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map((match) => match[1])
const usedInCopy = [...source.matchAll(/copy\(t\('([A-Za-z0-9_]+)'/g)].map((match) => match[1])
const usedKeys = new Set([...used, ...usedInCopy])
const enSet = new Set(en)
const zhSet = new Set(zh)

const missingEn = [...usedKeys].filter((key) => !enSet.has(key)).sort()
const missingZh = [...usedKeys].filter((key) => !zhSet.has(key)).sort()
const unused = en.filter((key) => !usedKeys.has(key)).sort()
const enOnly = en.filter((key) => !zhSet.has(key))
const zhOnly = zh.filter((key) => !enSet.has(key))
const dupEn = en.filter((key, index) => en.indexOf(key) !== index)

console.log('en keys:', en.length, 'zh keys:', zh.length)
console.log('used keys:', usedKeys.size)
console.log('missing in en:', missingEn)
console.log('missing in zh:', missingZh)
console.log('unused en keys:', unused)
console.log('en-only:', enOnly)
console.log('zh-only:', zhOnly)
console.log('duplicate en:', dupEn)
