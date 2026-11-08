// Usage-page class audit: every `pu-*` class the stylesheet defines must be
// referenced by the render code, and every `pu-*` class the render code names
// must be defined. The providers page's `pa-*` classes are covered by
// scratch/check-client-css.cjs; this covers the sibling prefix it ignores.
import { readFileSync } from 'node:fs'

const source = readFileSync('C:/Users/Administrator/repos/dshx/plugin/client.js', 'utf8')
const cssStart = source.indexOf('const CSS = `')
const cssEnd = source.indexOf('`\n\t\tconst CSS_TAG_ID', cssStart)
const css = source.slice(cssStart, cssEnd)
const code = source.slice(0, cssStart) + source.slice(cssEnd)

const defined = new Set([...css.matchAll(/\.(pu-[a-zA-Z0-9]+)/g)].map((match) => match[1]))
const used = new Set()
for (const match of code.matchAll(/'((?:pu-)[a-zA-Z0-9]*)'/g)) {
  for (const token of match[1].split(/\s+/)) if (token.length > 0) used.add(token)
}

const missingDefinitions = [...used].filter((name) => !defined.has(name)).sort()
const unusedDefinitions = [...defined].filter((name) => !used.has(name)).sort()

console.log('pu- defined:', defined.size, 'pu- used:', used.size)
console.log('used but not defined:', missingDefinitions)
console.log('defined but never used:', unusedDefinitions)
if (missingDefinitions.length > 0 || unusedDefinitions.length > 0) process.exitCode = 1
