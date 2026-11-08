const fs = require('node:fs')
const source = fs.readFileSync('C:/Users/Administrator/repos/dsh-provider-hub/plugin/client.js', 'utf8')

const cssStart = source.indexOf('const CSS = `')
const cssEnd = source.indexOf('`\n\t\tconst CSS_TAG_ID', cssStart)
const css = source.slice(cssStart, cssEnd)
const defined = new Set([...css.matchAll(/\.pa-[a-zA-Z0-9]+/g)].map((match) => match[0].slice(1)))

const used = new Set()
for (const match of source.matchAll(/className: (?:cx\()?'((?:pa-[^']*)|\{?)/g)) {
  // handled below instead
}
for (const match of source.matchAll(/className: (?:cx\()?([^,\n]+)/g)) {
  const expression = match[1]
  for (const literal of expression.matchAll(/'((?:pa-)[^']*)'/g)) {
    for (const token of literal[1].split(/\s+/)) if (token.length > 0) used.add(token)
  }
}
// classes referenced through cx() second/third arguments as bare literals
for (const match of source.matchAll(/cx\(([^\n]+)\)/g)) {
  for (const literal of match[1].matchAll(/'((?:pa-)[^']*)'/g)) {
    for (const token of literal[1].split(/\s+/)) if (token.length > 0) used.add(token)
  }
}

const undefinedUsed = [...used].filter((name) => !defined.has(name)).sort()
const unusedDefined = [...defined].filter((name) => !used.has(name)).sort()
console.log('defined:', defined.size, 'used:', used.size)
console.log('used but not defined:', undefinedUsed)
console.log('defined but never used:', unusedDefined)

// untranslated prose check: JSX-ish text children after className etc.
const suspects = []
for (const match of source.matchAll(/h\('(?:p|span|h2|button|label|option)'\s*,\s*\{[^}]*\}\s*,\s*'([^']{2,})'/g)) {
  suspects.push(match[1])
}
console.log('literal text children:', suspects)
