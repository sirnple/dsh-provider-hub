// Verify the paste-ready YAML: parses, matches the validated JSON, and passes
// the pi-ai adapter's own Config schema.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const DSH = 'C:/Users/Administrator/repos/dsh-provider-accounts/asar/dsh/node_modules/@deepseek-ai'
const fileUrl = (p) => new URL('file:///' + p.replace(/\\/g, '/')).href
const require = createRequire(fileUrl('C:/Users/Administrator/repos/dsh-provider-accounts/asar/dsh/node_modules/'))
const yaml = require('js-yaml')

const doc = yaml.load(fs.readFileSync('C:/Users/Administrator/repos/dsh-provider-accounts/research/opencode-go-accounts.yaml', 'utf8'))
console.log('YAML parses; entries =', doc.length, 'ids =', doc.map((e) => e.id))
const providers = doc[0].config.providers
console.log('routes =', Object.keys(providers))
for (const [id, p] of Object.entries(providers)) console.log(` ${id}: models=${p.models?.length ?? 'catalog-inherited'} api=${p.api ?? '(catalog)'} baseURL=${p.baseURL ?? '(catalog)'} apiKeyEnv=${p.apiKeyEnv}`)

const { Config } = await import(fileUrl(path.join(DSH, 'dsh-llm-pi-ai/lib/index.js')))
const parsed = Config({ providers }).providers.get()
console.log('adapter Config() accepted all', Object.keys(parsed).length, 'routes')

const expected = JSON.parse(fs.readFileSync('C:/Users/Administrator/repos/dsh-provider-accounts/research/account-routes.json', 'utf8'))
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const strip = (m) => {
  const copy = canon(m)
  if (copy.compat) {
    delete copy.compat.chatTemplateKwargs
    delete copy.compat.chatTemplateArgs
    if (Object.keys(copy.compat).length === 0) delete copy.compat
  }
  return JSON.stringify(copy)
}
for (const [id, want] of Object.entries(expected)) {
  const got = parsed[id]
  const same = JSON.stringify(want.models.map(strip)) === JSON.stringify(got.models.map(strip))
  console.log(` ${id}: models match generated JSON = ${same}`)
}
