// Emit the generated routes as paste-ready YAML matching the patch file style.
import fs from 'node:fs'

const routes = JSON.parse(fs.readFileSync('C:/Users/Administrator/repos/dsh-provider-accounts/research/account-routes.json', 'utf8'))
const order = ['opencode-go-2', 'opencode-go-2-completions', 'opencode-go-2-responses']

const scalar = (v) => {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return String(v)
  if (v === null) return ''
  return JSON.stringify(v)
}

function emit(node, indent, out) {
  const pad = ' '.repeat(indent)
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v)) {
      out.push(`${pad}${k}:`)
      for (const item of v) {
        if (typeof item !== 'object' || item === null) { out.push(`${pad}  - ${scalar(item)}`); continue }
        const keys = Object.keys(item)
        let first = true
        for (const kk of keys) {
          const vv = item[kk]
          const lead = first ? `${pad}  - ` : `${pad}    `
          first = false
          if (Array.isArray(vv)) {
            out.push(`${lead}${kk}:`)
            for (const s of vv) out.push(`${pad}      - ${scalar(s)}`)
          } else if (vv !== null && typeof vv === 'object') {
            out.push(`${lead}${kk}:`)
            emit(vv, indent + 6, out)
          } else out.push(`${lead}${kk}: ${scalar(vv)}`.trimEnd())
        }
      }
    } else if (v !== null && typeof v === 'object') {
      out.push(`${pad}${k}:`)
      emit(v, indent + 2, out)
    } else out.push(`${pad}${k}: ${scalar(v)}`.trimEnd())
  }
}

const out = []
for (const id of order) {
  out.push('      ' + id + ':')
  emit(routes[id], 8, out)
}
fs.writeFileSync('C:/Users/Administrator/repos/dsh-provider-accounts/research/tmp-routes.yaml', out.join('\n') + '\n')
console.log(out.slice(0, 30).join('\n'))
console.log('... lines total', out.length)
