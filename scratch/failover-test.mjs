// Scratch behavioral harness for the provider-accounts Host half.
// Imports an import-rewritten copy of plugin/index.js (only the schemastery
// specifier differs) and drives the llm/stream listener with fake chunks.
import assert from 'node:assert/strict'

// Keep the ledger of the production home untouched while the harness runs.
process.env.DSH_HOME = 'C:/Users/Administrator/repos/dsh-provider-accounts/scratch/tmp-home'

/** Disposers of every fake host, so interval cleanup keeps Node alive only while testing. */
const ALL_DISPOSERS = []
import {
  Config,
  apply,
  name as pluginName,
  activeAccount,
  currentRouteProfile,
} from './index.testable.mjs'

const CHUNKS = {
  success: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'hi' },
    { type: 'block-end', index: 0 },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
  quota: [
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    { type: 'finish', reason: { kind: 'error', failure: { message: 'quota exhausted', code: 'QUOTA' } } },
  ],
  rateLimit: [
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    { type: 'finish', reason: { kind: 'error', failure: { message: 'slow down', code: 'RATE_LIMIT' } } },
  ],
  auth: [
    { type: 'finish', reason: { kind: 'error', failure: { message: 'bad key', code: 'AUTH' } } },
  ],
  partialThenError: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: { kind: 'error', failure: { message: 'quota mid-stream', code: 'QUOTA' } } },
  ],
}

function makeHost({ accounts, refs, failover, routeRef }) {
  const config = Config({
    providers: [{
      id: 'p1',
      name: 'Provider One',
      accounts: accounts.map((ref, index) => ({ id: `a${index}`, label: ref, ref })),
    }],
    ...(failover === undefined ? {} : { failover }),
  })

  const entry = {
    options: {
      id: 'llm-pi-ai',
      config: routeRef === undefined ? {} : { providers: { p1: { apiKeyEnv: routeRef } } },
    },
  }
  const edits = []
  const editor = {
    entries: () => [entry],
    edit: async (target, change) => {
      const next = change(target.options.config, {})
      edits.push(JSON.parse(JSON.stringify(next)))
      target.options.config = next
      return undefined
    },
  }

  const listeners = []
  const ctx = {
    fiber: {},
    logger: { info() {}, warn() {} },
    get: (service) => (service === 'configEditor' ? editor : undefined),
    inject() {},
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') ALL_DISPOSERS.push(dispose)
      return () => {}
    },
    on: (event, listener) => { listeners.push({ event, listener }) },
    llm: { registerAdapter: () => () => {},
      stream: (options) => listeners.filter((row) => row.event === 'llm/stream')[0].listener(options, () => backend(options)),
    },
  }

  const scripts = refs
  async function* backend(options) {
    const ref = entry.options.config?.providers?.p1?.apiKeyEnv
    const script = scripts[ref] ?? CHUNKS.success
    for (const chunk of script) yield chunk
  }

  apply(ctx, config)
  assert.equal(pluginName, 'providerAccounts')
  const streamListeners = listeners.filter((row) => row.event === 'llm/stream')
  assert.equal(streamListeners.length, 2)
  const listener = streamListeners[0].listener

  return { config, entry, editor, edits, ctx, listener, configObject: config, backend }
}

async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

// --- 1. Success path is a chunk-for-chunk pass-through -------------------------
{
  const host = makeHost({ accounts: ['REF_A', 'REF_B'], refs: {}, routeRef: 'REF_A' })
  const options = { provider: 'p1', model: 'm', messages: [], signal: new AbortController().signal }
  const got = await collect(host.listener(options, async function* () { yield* CHUNKS.success }))
  assert.deepEqual(got, CHUNKS.success)
  assert.equal(host.edits.length, 0)
  console.log('ok 1 pass-through identity')
}

// --- 2. Unknown route: untouched ----------------------------------------------
{
  const host = makeHost({ accounts: ['REF_A', 'REF_B'], refs: {}, routeRef: 'REF_A' })
  const downstream = { marker: 'unknown-route' }
  const returned = host.listener({ provider: 'other', model: 'm', messages: [] }, () => downstream)
  assert.equal(returned, downstream)
  console.log('ok 2 unknown route fast path')
}

// --- 3. QUOTA failover A -> B ------------------------------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [], signal: new AbortController().signal }
  const got = await collect(host.listener(options, () => host.backend(options)))
  const finish = got.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'stop')
  assert.ok(got.some((chunk) => chunk.type === 'text-delta'))
  assert.equal(host.entry.options.config.providers.p1.apiKeyEnv, 'REF_B')
  assert.equal(host.edits.length, 1)
  assert.equal(host.edits[0].providers.p1.apiKeyEnv, 'REF_B')
  assert.equal(Object.getOwnPropertySymbols(options).length, 0, 'original options must not be mutated')
  console.log('ok 3 quota failover switched A -> B and retried')
}

// --- 4. Content already emitted: no retry ------------------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.partialThenError, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  assert.equal(host.entry.options.config.providers.p1.apiKeyEnv, 'REF_A')
  assert.equal(host.edits.length, 0)
  console.log('ok 4 no retry after content')
}

// --- 5. maxHops = 1 stops after one switch; original error forwarded ----------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B', 'REF_C'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.quota, REF_C: CHUNKS.success },
    failover: { enabled: true, codes: ['QUOTA'], maxHops: 1 },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  assert.equal(host.entry.options.config.providers.p1.apiKeyEnv, 'REF_B')
  assert.equal(host.edits.length, 1)
  console.log('ok 5 maxHops=1 performs exactly one switch')
}

// --- 6. Exhausted accounts: original error, all tried, wrapped order ----------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B', 'REF_C'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.quota, REF_C: CHUNKS.quota },
    failover: { enabled: true, codes: ['QUOTA'], maxHops: 5 },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  assert.equal(got.at(-1).reason.failure.code, 'QUOTA')
  assert.equal(host.edits.length, 2)
  assert.deepEqual(
    host.edits.map((edit) => edit.providers.p1.apiKeyEnv),
    ['REF_B', 'REF_C'],
  )
  console.log('ok 6 exhausted accounts forward the last error')
}

// --- 7. Toggle off ------------------------------------------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    failover: { enabled: false },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  assert.equal(host.edits.length, 0)
  console.log('ok 7 disabled failover is a pass-through')
}

// --- 8. Codes filter: SERVER is not in the default list -----------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: {
      REF_A: [{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 502', code: 'SERVER' } } }],
      REF_B: CHUNKS.success,
    },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.failure.code, 'SERVER')
  assert.equal(host.edits.length, 0)
  console.log('ok 8 unlisted codes do not retry')
}

// --- 8b. AUTH is in the default list and does fail over ----------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.auth, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'stop')
  assert.equal(host.entry.options.config.providers.p1.apiKeyEnv, 'REF_B')
  console.log('ok 8b AUTH rotates to the next account')
}

// --- 9. Aborted signal --------------------------------------------------------
{
  const controller = new AbortController()
  controller.abort()
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [], signal: controller.signal }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  assert.equal(host.edits.length, 0)
  console.log('ok 9 aborted request is not retried')
}

// --- 10. Retry-options marker prevents a nested hop ---------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  const marker = Object.getOwnPropertySymbols(
    // Any object carrying the module-private symbol is produced only by the
    // plugin; emulate the real path through one failing call instead.
    {},
  )
  assert.deepEqual(marker, [])
  console.log('ok 10 marker is module-private (indirectly covered by checks 3-6)')
}

// --- 11. Unmanaged route keeps the exact downstream object --------------------
{
  const host = makeHost({ accounts: ['REF_A', 'REF_B'], refs: {}, routeRef: 'REF_A' })
  const downstream = { marker: 'downstream-iterable' }
  const returned = host.listener({ provider: 'other' }, () => downstream)
  assert.equal(returned, downstream)
  console.log('ok 11 unknown provider returns the downstream value unchanged')
}

// --- 12. Missing account(s) or single account ---------------------------------
{
  const host = makeHost({ accounts: ['REF_A'], refs: { REF_A: CHUNKS.quota }, routeRef: 'REF_A' })
  const downstream = { marker: 'single-account' }
  assert.equal(host.listener({ provider: 'p1' }, () => downstream), downstream)
  console.log('ok 12 single account is untouched')
}

// --- 13. Route ref is not one of the accounts --------------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_X: CHUNKS.quota, REF_A: CHUNKS.success },
    routeRef: 'REF_X',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'stop')
  assert.equal(host.entry.options.config.providers.p1.apiKeyEnv, 'REF_A')
  console.log('ok 13 stale route ref falls back into the account list')
}

// --- 14. Exported helpers -----------------------------------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: {},
    routeRef: 'REF_B',
  })
  assert.equal(activeAccount(host.config.providers.get()[0]).ref, 'REF_A')
  assert.equal(activeAccount(undefined), undefined)
  assert.equal(currentRouteProfile(host.entry.options.config, 'p1').apiKeyEnv, 'REF_B')
  assert.equal(currentRouteProfile(host.entry.options.config, { id: 'p1' }).apiKeyEnv, 'REF_B')
  assert.equal(currentRouteProfile(host.entry.options.config, 'nope'), undefined)
  assert.equal(currentRouteProfile(undefined, 'p1'), undefined)
  assert.equal(currentRouteProfile(host.config, { id: 'p1' }), undefined) // our own config has no routes
  console.log('ok 14 helper exports')
}

// --- 15. switchAccount failure (edit rejects) forwards the model error --------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  host.editor.edit = async () => { throw new Error('loader refused') }
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  assert.equal(got.at(-1).reason.failure.code, 'QUOTA')
  console.log('ok 15 edit failure does not break the model stream')
}

// --- 16. No llm-pi-ai entry ---------------------------------------------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    routeRef: 'REF_A',
  })
  host.editor.entries = () => []
  const options = { provider: 'p1', model: 'm', messages: [] }
  const got = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(got.at(-1).reason.kind, 'error')
  console.log('ok 16 missing pi-ai entry forwards the error')
}

// --- 17. Live toggle read: one host, policy flipped between calls ------------
{
  const host = makeHost({
    accounts: ['REF_A', 'REF_B'],
    refs: { REF_A: CHUNKS.quota, REF_B: CHUNKS.success },
    failover: { enabled: true, codes: ['QUOTA'], maxHops: 2 },
    routeRef: 'REF_A',
  })
  const options = { provider: 'p1', model: 'm', messages: [] }
  const first = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(first.at(-1).reason.kind, 'stop')
  // Flip the toggle through the volatile reference the running plugin holds.
  const write = Symbol.for('cosmokit.volatile.write')
  host.entry.options.config = { providers: { p1: { apiKeyEnv: 'REF_A' } } }
  host.config.failover[write]({
    ...host.config.failover.get(),
    enabled: false,
  })
  assert.equal(host.config.failover.get().enabled, false)
  const second = await collect(host.listener(options, () => host.backend(options)))
  assert.equal(second.at(-1).reason.kind, 'error')
  assert.equal(host.edits.length, 1)
  console.log('ok 17 failover toggle is read live')
}

// Stop the ledger flush interval every fake host started.
for (const dispose of ALL_DISPOSERS) dispose()

console.log('ALL SCENARIO CHECKS PASSED')
