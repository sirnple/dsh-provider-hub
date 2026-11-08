// Real key verification: the catalogue-backed discovery answers from installed
// metadata with no network call, so a "Test" click could claim success for a key
// that the provider rejects. Add a Host probe route and make the page use it.
import fs from 'node:fs'

const HOST = 'C:/Users/Administrator/repos/dsh-provider-accounts/plugin/index.js'
const CLIENT = 'C:/Users/Administrator/repos/dsh-provider-accounts/plugin/client.js'
const done = []
function patch(file, search, replacement, label) {
  let source = fs.readFileSync(file, 'utf8')
  const count = source.split(search).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 occurrence, found ${count}`)
  source = source.replace(search, replacement)
  fs.writeFileSync(file, source)
  done.push(label)
}

// ------------------------------------------------------------------ HOST
patch(HOST,
  `const USAGE_ROUTE = '/api/provider-accounts-usage'
const BALANCE_ROUTE = '/api/provider-accounts-balance'`,
  `const USAGE_ROUTE = '/api/provider-accounts-usage'
const BALANCE_ROUTE = '/api/provider-accounts-balance'
const TEST_ROUTE = '/api/provider-accounts-test'`,
  'host: test route constant',
)

patch(HOST,
  `/**
 * Refresh balances in the background when the snapshot is old, so the header`,
  `/**
 * Validate one account's stored key by running its provider probe.
 *
 * Catalogue-backed discovery never calls the provider, so it cannot tell a good
 * key from a rejected one; this path performs the real request and records the
 * outcome in the balance snapshot, which the page then renders.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - this plugin's configuration.
 * @param {string} providerId - provider route id.
 * @param {string|undefined} ref - credential reference; omitted picks the current one.
 * @returns {Promise<object>} \`{ supported, ok, ref?, error?, reason? }\`.
 */
async function testAccountKey(ctx, config, providerId, ref) {
  const provider = configuredProviders(config).find((candidate) => candidate.id === providerId)
  if (provider === undefined) return { supported: false, reason: 'unknown-provider' }
  const accounts = (Array.isArray(provider.accounts) ? provider.accounts : [])
    .filter((candidate) => typeof candidate?.ref === 'string' && candidate.ref.length > 0)
  const wanted = ref ?? currentRef(ctx, provider)
  const account = accounts.find((candidate) => candidate.ref === wanted) ?? accounts[0]
  if (account === undefined) return { supported: false, reason: 'unknown-account' }
  const kind = balanceKindFor(provider)
  if (!BALANCE_ADAPTERS.has(kind)) return { supported: false, reason: 'no-probe', kind }

  const key = usageKey(provider.id, account.ref)
  const record = (ok, fields, meters, error) => {
    usage.balances[key] = { kind, ok, fetchedAt: Date.now(), fields, meters, error }
    usageDirty = true
    saveUsage()
  }
  const credentials = optionalService(ctx, 'credentials')
  let value = ''
  try {
    const resolved = typeof credentials?.resolve === 'function' ? await credentials.resolve(account.ref) : undefined
    value = typeof resolved?.value === 'string' ? resolved.value : ''
  } catch {
    value = ''
  }
  if (value.length === 0) {
    const error = \`credential "\${account.ref}" is not configured\`
    record(false, [], [], error)
    return { supported: true, ok: false, ref: account.ref, error }
  }
  try {
    const result = await probeProviderBalance({ key: value, provider, account })
    record(true, result.fields ?? [], result.meters ?? [], undefined)
    return { supported: true, ok: true, ref: account.ref }
  } catch (error) {
    const message = messageOf(error).slice(0, 300)
    record(false, [], [], message)
    return { supported: true, ok: false, ref: account.ref, error: message }
  }
}

/**
 * Refresh balances in the background when the snapshot is old, so the header`,
  'host: testAccountKey',
)

patch(HOST,
  `    child.effect(() => child.connection.fetch.register({
      path: BALANCE_ROUTE,`,
  `    child.effect(() => child.connection.fetch.register({
      path: TEST_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body = {}
        try {
          body = await request.json()
        } catch {
          body = {}
        }
        const providerId = body !== null && typeof body === 'object' && typeof body.providerId === 'string' ? body.providerId : ''
        if (providerId.length === 0) return jsonResponse({ supported: false, reason: 'bad-request' })
        const ref = body !== null && typeof body === 'object' && typeof body.ref === 'string' && body.ref.length > 0 ? body.ref : undefined
        return jsonResponse(await testAccountKey(ctx, config, providerId, ref))
      },
    }))
    child.effect(() => child.connection.fetch.register({
      path: BALANCE_ROUTE,`,
  'host: test route',
)

// ------------------------------------------------------------------ CLIENT
patch(CLIENT,
  `\t\tconst BALANCE_URL = '/api/provider-accounts-balance'`,
  `\t\tconst BALANCE_URL = '/api/provider-accounts-balance'
\t\tconst TEST_URL = '/api/provider-accounts-test'`,
  'client: test route constant',
)

patch(CLIENT,
  `\t\t\t\tdiscover: guarded(async (request) => {`,
  `\t\t\t\t/** Verify one account's stored key against the provider; unsupported means no probe exists. */
\t\t\t\ttestKey: guarded(async (providerId, ref) => {
\t\t\t\t\tlet response
\t\t\t\t\ttry {
\t\t\t\t\t\tresponse = await fetch(TEST_URL, {
\t\t\t\t\t\t\tmethod: 'POST',
\t\t\t\t\t\t\tcredentials: 'same-origin',
\t\t\t\t\t\t\theaders: { 'content-type': 'application/json' },
\t\t\t\t\t\t\tbody: JSON.stringify(ref === undefined ? { providerId } : { providerId, ref }),
\t\t\t\t\t\t})
\t\t\t\t\t} catch (error) {
\t\t\t\t\t\treturn { kind: 'failed', message: messageOf(error) }
\t\t\t\t\t}
\t\t\t\t\tif (response.status === 404) return { kind: 'unsupported' }
\t\t\t\t\tlet body
\t\t\t\t\ttry {
\t\t\t\t\t\tbody = await response.json()
\t\t\t\t\t} catch {
\t\t\t\t\t\treturn { kind: 'failed', message: 'the test route did not answer with JSON' }
\t\t\t\t\t}
\t\t\t\t\tif (body !== null && typeof body === 'object' && body.supported === false) return { kind: 'unsupported' }
\t\t\t\t\tif (body !== null && typeof body === 'object' && body.ok === true) return { kind: 'valid' }
\t\t\t\t\tconst message = body !== null && typeof body === 'object' && typeof body.error === 'string' ? body.error : t('testKeyRejected')
\t\t\t\t\treturn { kind: 'invalid', message }
\t\t\t\t}),

\t\t\t\tdiscover: guarded(async (request) => {`,
  'client: testKey operation',
)

patch(CLIENT,
  `\t\t\t\tconst result = await operations.discover(request)
\t\t\t\tif (result.kind === 'found') {
\t\t\t\t\tconst message = copy(t('testOk'), { count: result.models.length }) + (suffix === undefined ? '' : \` \${suffix}\`)`,
  `\t\t\t\t// A catalogue-backed route answers discovery without any network call, so it
\t\t\t\t// cannot vouch for the key. Ask the Host to verify the credential first.
\t\t\t\tconst probe = await operations.testKey(request.provider, request.ref)
\t\t\t\tif (probe.kind === 'invalid') {
\t\t\t\t\tsetTests((previous) => ({ ...previous, [key]: { status: 'error', message: probe.message } }))
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t\tconst result = await operations.discover(request)
\t\t\t\tif (result.kind === 'found') {
\t\t\t\t\tconst verified = probe.kind === 'valid'
\t\t\t\t\tconst message = (verified
\t\t\t\t\t\t? copy(t('testKeyOk'), { count: result.models.length })
\t\t\t\t\t\t: copy(t('testOk'), { count: result.models.length }) + ' ' + t('testUnverified')) + (suffix === undefined ? '' : \` \${suffix}\`)`,
  'client: verify before discovery',
)

patch(CLIENT,
  `\t\t\t\t\t\t\t\tonClick: () => onTest(key, { provider: provider.id }, active ? undefined : t('testInactiveNote')),`,
  `\t\t\t\t\t\t\t\tonClick: () => onTest(key, { provider: provider.id, ref: account.ref }, active ? undefined : t('testInactiveNote')),`,
  'client: account test passes its reference',
)

patch(CLIENT,
  `\t\t\ttestOk: 'Connected · {count} models available.',`,
  `\t\t\ttestOk: 'Connected · {count} models available.',
\t\t\ttestKeyOk: 'Key accepted · {count} models available.',
\t\t\ttestKeyRejected: 'The provider rejected this key.',
\t\t\ttestUnverified: '(catalogue models only, key not verified)',`,
  'en test keys',
)

patch(CLIENT,
  `\t\t\ttestOk: '连接正常 · 可用模型 {count} 个。',`,
  `\t\t\ttestOk: '连接正常 · 可用模型 {count} 个。',
\t\t\ttestKeyOk: '密钥有效 · 可用模型 {count} 个。',
\t\t\ttestKeyRejected: '提供商拒绝了这个密钥。',
\t\t\ttestUnverified: '（以上为目录模型，未验证密钥）',`,
  'zh test keys',
)

console.log(`patched ${done.length} places:`)
for (const label of done) console.log(` - ${label}`)
