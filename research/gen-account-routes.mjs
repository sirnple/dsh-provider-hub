// Generate + validate second-account routes for opencode-go from the pi-ai catalog.
import fs from 'node:fs'
import path from 'node:path'

const DSH = 'C:/Users/Administrator/repos/dsh-provider-hub/asar/dsh/node_modules/@deepseek-ai'
const PIAI_ROOT = 'C:/Users/Administrator/repos/dsh-provider-hub/asar/dsh/node_modules/@earendil-works/pi-ai'
const CATALOG = path.join(PIAI_ROOT, 'dist/providers/data/opencode-go.json')
const fileUrl = (p) => new URL('file:///' + p.replace(/\\/g, '/')).href

const OFFER = {
  'openai-completions': new Set(['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason', 'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs', 'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField', 'vllmPriority', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention']),
  'openai-responses': new Set(['supportsDeveloperRole', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention']),
  'anthropic-messages': new Set(['supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools']),
}
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const ROUTE = {
  'anthropic-messages': { id: 'opencode-go-2', baseURL: 'https://opencode.ai/zen/go', displayName: 'OpenCode Go (Account 2)' },
  'openai-completions': { id: 'opencode-go-2-completions', baseURL: 'https://opencode.ai/zen/go/v1', displayName: 'OpenCode Go (Account 2) Chat' },
  'openai-responses': { id: 'opencode-go-2-responses', baseURL: 'https://opencode.ai/zen/go/v1', displayName: 'OpenCode Go (Account 2) Responses' },
}

const { getSupportedThinkingLevels } = await import(fileUrl(path.join(PIAI_ROOT, 'dist/models.js')))
const data = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))

// pi-ai clamps an undeclared Anthropic effort level (anthropic-messages.js:696);
// every other protocol sends the level name itself (openai-completions.js:676).
function wireFor(api, level) {
  if (api !== 'anthropic-messages') return level
  if (level === 'minimal' || level === 'low') return 'low'
  if (level === 'medium') return 'medium'
  return 'high'
}

function effortsOf(id, m, api) {
  if (m.reasoning !== true) return false
  const map = m.thinkingLevelMap ?? null
  const out = {}
  for (const level of LEVELS) {
    const has = map !== null && Object.prototype.hasOwnProperty.call(map, level)
    if (has && map[level] === null) continue
    if (has && typeof map[level] === 'string') { out[level] = map[level]; continue }
    if (level === 'xhigh' || level === 'max') continue
    if (level === 'off') { out.off = null; continue }
    out[level] = wireFor(api, level)
  }
  if (!Object.keys(out).some((k) => k !== 'off')) throw new Error(`model ${id} would declare no level beyond off`)
  return out
}

/** The map dsh materializes from a declared dict (pi-ai config.js resolveModelReasoning). */
function declaredMap(efforts) {
  const map = {}
  for (const level of LEVELS) {
    const wire = efforts[level]
    if (wire === undefined) map[level] = null
    else if (wire !== null) map[level] = wire
  }
  return map
}

const dropped = new Map()
const routes = {}
const report = []
const mismatches = []

for (const api of ['anthropic-messages', 'openai-completions', 'openai-responses']) {
  const spec = ROUTE[api]
  const models = []
  const perModelCompat = []
  for (const [key, m] of Object.entries(data[api])) {
    if (!key.startsWith('chat:')) continue
    const efforts = effortsOf(m.id, m, api)
    const entry = { id: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens, input: [...m.input], reasoningEfforts: efforts }
    // Equivalence: the levels a catalog model offers must survive the rewrite.
    const catalogLevels = getSupportedThinkingLevels({ reasoning: m.reasoning === true, thinkingLevelMap: m.thinkingLevelMap ?? undefined })
    const declaredLevels = getSupportedThinkingLevels({ reasoning: true, thinkingLevelMap: declaredMap(efforts) })
    if (m.reasoning === true && JSON.stringify(catalogLevels) !== JSON.stringify(declaredLevels)) {
      mismatches.push(`${m.id}: catalog=${catalogLevels.join(',')} declared=${declaredLevels.join(',')}`)
    }
    const compat = {}
    for (const [f, v] of Object.entries(m.compat ?? {})) {
      if (OFFER[api].has(f)) compat[f] = v
      else {
        if (!dropped.has(f)) dropped.set(f, new Set())
        dropped.get(f).add(api)
      }
    }
    perModelCompat.push(compat)
    models.push(entry)
  }
  const shared = {}
  for (const f of new Set(perModelCompat.flatMap((c) => Object.keys(c)))) {
    const values = perModelCompat.map((c) => c[f])
    if (values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]))) shared[f] = values[0]
  }
  models.forEach((entry, i) => {
    const rest = Object.fromEntries(Object.entries(perModelCompat[i]).filter(([f]) => !(f in shared)))
    if (Object.keys(rest).length > 0) entry.compat = rest
  })
  const route = { displayName: spec.displayName, apiKeyEnv: 'OPENCODE_GO_2_API_KEY', api, baseURL: spec.baseURL }
  if (Object.keys(shared).length > 0) route.compat = shared
  route.models = models
  routes[spec.id] = route
  report.push(`${spec.id}: api=${api} baseURL=${spec.baseURL} models=${models.length} routeCompat=${JSON.stringify(shared)}`)
}

// ---- validation against the adapter's own Config ----
const { Config } = await import(fileUrl(path.join(DSH, 'dsh-llm-pi-ai/lib/index.js')))
const { credentialRef, isCredentialKeySegment } = await import(fileUrl(path.join(DSH, 'dsh-credentials/lib/types/index.js')))
const providers = Config({ providers: routes }).providers.get()
console.log('Config() accepted:', Object.keys(providers))
for (const [id, p] of Object.entries(providers)) {
  console.log(` ${id}: api=${p.api} baseURL=${p.baseURL} models=${p.models.length} apiKeyEnv=${p.apiKeyEnv} compat=${JSON.stringify(p.compat)}`)
}
const one = Config({ providers: { 'opencode-go-3': { api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1', models: [{ id: 'x' }] } } }).providers.get()
console.log('minimal declared route accepted:', JSON.stringify(one['opencode-go-3'].models[0]))
console.log('isCredentialKeySegment("opencode-go-2") =', isCredentialKeySegment('opencode-go-2'))
for (const ref of ['OPENCODE_GO_2_API_KEY', 'opencode-go-2']) {
  try { credentialRef(ref); console.log(`credentialRef("${ref}") OK`) }
  catch (e) { console.log(`credentialRef("${ref}") REJECTED: ${e.message}`) }
}
if (dropped.size > 0) console.log('withheld compat dropped:', [...dropped].map(([f, s]) => `${f} (${[...s].join(',')})`).join(' | '))
console.log('level-set mismatches:', mismatches.length === 0 ? 'none' : mismatches.join(' ; '))
console.log(report.join('\n'))
fs.writeFileSync('C:/Users/Administrator/repos/dsh-provider-hub/research/account-routes.json', JSON.stringify(routes, null, 2))
