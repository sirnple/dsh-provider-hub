# Host API for a locally authored DSH plugin bundle — findings

Read-only investigation of DSH `0.2.1-rc.2` package sources.

`$P` below = `C:\Users\Administrator\repos/dsh-provider-hub/asar\dsh\node_modules\@deepseek-ai`
(all paths are relative to `$P`; `pkg/lib/x.js:12` means `$P\pkg\lib\x.js` line 12).

Profile under study: `C:\Users\Administrator\.dsh\profiles\desktop` — bundles `@deepseek-ai/dsh-base`,
`@deepseek-ai/dsh-web-app`, …, which mount `typert` / `typert-loader` / `typert-gateway` / `remote-access`
(`dsh-base/cordis.patch.yml:35-58`), `config-editor`+`settings` (`:105-112`), `credentials-local` (`:126`),
`llm-pi-ai` (`:136`), and `webserver` + `connection` + `api-remotes` (`dsh-web-app/cordis.patch.yml:179`, `:234`, `:248`).

---

## Q1 — Can a profile-loaded Host plugin expose **new** `@Remote` methods? **Yes.** Two independent runtime paths.

The api-remotes doc sentence ("the Client does not discover the Host's active Services or Remote
definitions at runtime", `dsh-api-remotes/README.md:77`) constrains the **Client assembly's contribution
selection**, not Host dispatch. The Host gateway resolves endpoints at call time and has a codegen-free
fallback.

### 1.1 Host dispatch: strict descriptor first, then **SRC** ("conservative SRC marker")

`dsh-api-gateway/lib/index.js`:

- `:740` — class comment: *"Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers."*
- `:1224-1229` `resolveDescriptor()`:
  ```js
  const strict = this.ctx.typert.local.get(endpoint);
  if (strict !== void 0) return strict;
  if (this.ctx.typert.local.hasSeen(endpoint)) throw ... "its strict definition was withdrawn and SRC fallback is forbidden";
  return this.resolveSrcDescriptor(namespace, method, endpoint);
  ```
- `:1230-1248` `resolveSrcDescriptor()` walks **`Object.entries(this.ctx.reflect.props)`** (every live Cordis
  *service* in the Host root), skips anything without a `typertRemote` binding, matches
  `binding.namespace === namespace` plus a marker from `remoteMethods(original)`; 0 candidates →
  `gateway/invocation-unavailable`, >1 → `gateway/ambiguous-endpoint`.
- `:1249-1301` `srcDescriptor()` synthesizes the descriptor at runtime: parameter **names** are parsed from
  `Function.prototype.toString` of the prototype method (`:1715-1744`; plain identifiers only, no
  destructuring/defaults/rest; a trailing `signal` becomes cancellation), each parameter gets codec
  `{ mode: "src-json" }`, result `{ mode: "src-json" }`.
- `:1698-1710` `validateBinding()`/`readBinding()`: the receiver must expose
  `typertRemote = { service, serviceKey, namespace }` with `service === original` and
  `serviceKey === <cordis key>`; otherwise `gateway/binding-invalid`.
- `:876-883` `claimsEndpoint()` gates the `/api` interceptor: an endpoint is claimed iff a strict
  descriptor exists **or** it appears in `srcClaims` (the SRC marker scan, `:895-908`).
- `:1175` access control is skipped for the owner peer — `if (request.peer.principal.kind !== "owner")` —
  and the browser peer is owner (`dsh-client-connection/README.md:49`). So a new endpoint needs **no**
  `remoteAccess.registerPolicy()` for browser use.

⇒ A Service class registered in the Host root, carrying a `typertRemote` binding plus `@Remote` markers,
is invokable **by namespace/method over `/api` with no generated artifact at all**.

### 1.2 The two ways to make an endpoint "known"

**(a) Markers only (no registry writes).** `dsh-typert-protocol/lib/index.js` (the built bundle the Host
imports; `lib/types/index.js` holds the same code with different offsets — `REMOTE_METHOD_DESCRIPTOR` at `:22`, `mark()` at `:170`):

- `:326-337` `bindTypertRemote(service, serviceKey, {namespace})` → frozen
  `{service, serviceKey, namespace}`; `:339-352` `TypertRemoteService` does this in its constructor using
  `this.name` (and also provides `ctx.invocation`).
- `:315` the marker key: `const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";`
- `:429-439` `readRemoteMethodDescriptor()` requires own property on the prototype, `version === 1`,
  `methods` array. `:449-470` `mark()` writes
  `{ version: 1, methods: [ { method, invocation: { kind: "direct" }, exportName?, mode?, resources? } ] }`.
- `:424-428` `remoteMethods(service)` = `readRemoteMethodDescriptor(Object.getPrototypeOf(service)).methods`.
- `:363-371` `Remote(...)` is a *stage-3 method decorator* (`context.addInitializer`); the shipped built
  packages apply it through the TS decorator emit, e.g. `dsh-api-settings-controller/lib/index.js:99-134`
  (`_describe_decorators = [Remote]; __esDecorate$1(this, null, _describe_decorators, {kind:"method", name:"describe", …})`).
  In plain ESM JS with no decorator syntax, the same public function can be driven manually:
  `Remote(undefined, { kind:"method", name:"list", static:false, private:false, addInitializer(cb){ cb.call(Object.create(Svc.prototype)) } })`
  — or write the version-1 property directly with `Object.defineProperty`.

**(b) Explicit `src-json` descriptor registration.** `dsh-typert-registry/README.md:46`: *"Generated
artifacts register through the loader in Loader compositions; any other owner calls
`ctx.typert.register(contribution)` directly and receives the exact disposer."* Implementation
`dsh-typert-registry/lib/index.js:453-473` (identical line numbers in `lib/client.node.js`; package+face+schemas+invocations, atomic,
fiber-scoped); validation `:577-621` — `validateCodec` at `:617-621` accepts `{ mode: "src-json" }`
outright, and only *strict* codecs need a `create()` factory. `local.get(endpoint)` then returns the
descriptor, so `resolveDescriptor()` never reaches the marker scan. `validateBinding()` still requires the
`typertRemote` binding (§1.1), so the Service class is the same; only discovery differs.

### 1.3 What is **not** possible

- **No client auto-discovery.** The Client's namespace map `ClientRemoteService.namespaces` is created
  empty (`dsh-api-gateway/lib/client.browser.js:1620`) and filled only by
  `mountContribution → installNamespace → createNamespace` (`:1669-1717`, `:1755-1800`), i.e. only from a
  contribution object passed to `ctx.remote.$mount(...)`. `ctx.typert.remotes.register()` does **not**
  create a `remote.<ns>` service. So a Host-side registration alone gives you **nothing** on
  `ctx.remote.<ns>`.
- **`ctx.remote.<ns>` is a Cordis Service named `remote.<ns>`** (`:2074-2076`, `:1953-1964`), not a Proxy;
  methods are installed as per-instance accessors (`:1988-2011`).
- Client contributions are validated harder than Host ones: `requireStrictInputs()` demands
  `codec.mode === "strict"` for every parameter/uplink/Context codec
  (`client.browser.js:2101-2109`), matching `dsh-api-gateway/README.md:89` (*"SRC markers have no Client
  type projection and are not normal Client contribution inputs"*). Hand-written strict codecs happen to
  satisfy it (`{ mode:"strict", create: () => ({ parse: v => v }) }` — validated for shape at
  `dsh-typert-registry/lib/index.js:617-621`, never executed on the Client), but that is leaning on
  an implementation detail.

### 1.4 The clean client-side door: `ctx.connection.rpc.call`

The generated namespaces are only sugar over this call — `dsh-api-gateway/lib/client.browser.js:1826`:
```js
const result = await connection.rpc.call("/api", endpoint, { args: prepared.args }, prepared.signal);
```
and the carrier is `dsh-client-connection/lib/client.browser.js:1209-1239` (POST `api/<endpoint>`, envelope
`{type:"client-request", rpcId, method: endpoint, payload}`, returns `full.result` =
`{ok:true,value}` | `{ok:false,error:{code,message,details}}`). The service is a plain object provided as
`ctx.provide("connection", handle)` (`dsh-client-connection/lib/client.browser.js:1421-1497`), so any Client plugin can
`inject: ["connection"]` and call `ctx.connection.rpc.call(...)` directly. This works through the shell's
transport override in Electron too (`:1387` `transport?.rpc ?? createWebConnectionRpc(...)`), whereas a raw
`fetch()` would not.

---

## Q2 — What a browser plugin can call today (this profile)

Complete `ctx.remote.*` namespace/method inventory of the mounted assembly
(`dsh-api-remotes/lib/types/client/index.js:2-27` mounts 26 contributions; endpoints extracted from the
built bundle `dsh-api-remotes/lib/client.js`):

| namespace | methods |
|---|---|
| `settings` | `describe`, `update`, `replace`, `mutate`, `openSettingsDocument` |
| `credentials` | `describe`, `set`, `unset` |
| `llm` | `discoverModels`, `listConfigurableProviders`, `listProviders` |
| `account` | `getState`, `getProfile`, `getBalance`, `watch`, `watchExpiry`, `startSignIn`, `cancelSignIn`, `signOut`, `hasRunningAccountTasks`, `ackBonusNotified`, `getUnnotifiedBonuses` |
| `session` | `list`, `page`, `create`, `follow`, `prompt`, `cancel`, `control`, `fork`, `rename`, `search`, `selectModel`, `modelCatalog`, `initializeDefaultModel`, `projections`, `attachment`, `openWorkspacePath`, `canOpenWorkspacePath`, `workspacePathApplications`, `updateQueue` |
| `fileReferences` | `list` |
| `sessionReferenceResolver` | `candidates` |
| `agentPresets` | `list`, `read`, `select` |
| `commands` | `list`, `execute` |
| `goals`, `schedule`, `subagents`, `terminal`, `workspace`, `workspaceFiles`, `job`, `fileUploads`, `messageFeedback`, `sessionFeedback`, `permissionPresets`, `officeToPdf`, `userQuestions`, `pluginManager`, `pluginMarket`, `pluginInventory`, `pluginRegistryProbe`, `productAnalytics`, `dynamicCordisRunner`, `directoryPicker` | (as named in the bundle; not needed here) |

**Model discovery exists**: `llm/discoverModels(settingsNs, request)` — descriptors at
`dsh-api-remotes/lib/client.js:7327-7455`:
```
llm.discoverModels(settingsNs: string, request: { provider?: string; baseURL?: string; api?: string; apiKey?: string }, signal?)
  -> RemoteResult<Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number; inputModalities?: ("text"|"image")[] }>>
```
plus `llm/listConfigurableProviders() -> RemoteResult<Array<{ provider, displayName, settingsNs,
settingsPath: string[], declared?, defaultBaseURL?, baseURLEnv?, nativeAuth?: {env: string[], oauth: boolean}, error? }>>`
(`:7456+`, schema at `:7296-7309`) and `llm/listProviders() -> Array<{id,name}>` (`:7310-7314`).
Shipped consumer: `dsh-client-ui-settings-models/lib/client.js:3194-3203`.

### `settings` — exact shapes (`dsh-api-settings-controller/lib/typert.remote-client.js:265-496`)

```ts
settings.describe(): Promise<RemoteResult<{
  writable: boolean;                      // profile accepts writes
  hasDocument: boolean;                   // config editor owns a local document
  namespaces: SettingsNamespaceView[];
}>>

settings.update(ns: string, patch: Record<string, JsonValue>, expectedRevision?: number)
  : Promise<RemoteResult<SettingsNamespaceView>>          // deep-merge into user section

settings.replace(ns: string, section: Record<string, JsonValue>, expectedRevision?: number)
  : Promise<RemoteResult<SettingsNamespaceView>>          // replace user section wholesale

settings.mutate(ns: string,
  ops: Array<{ op: "set"; path: string[]; value: JsonValue }
            | { op: "unset"; path: string[] }>,
  expectedRevision?: number): Promise<RemoteResult<SettingsNamespaceView>>   // path-addressed

settings.openSettingsDocument(signal?): Promise<RemoteResult<{ opened: true }>>

interface SettingsNamespaceView {
  autoGenerate: boolean;                  // "generate a page if no custom page registered"
  ns: string;                             // = profile Loader entry id
  schema: unknown;                        // schema.toJSON() envelope of the volatile form
  value: unknown;                         // redacted resolved value (defaults→base→user)
  base?: unknown;                         // redacted composition base
  user?: unknown;                         // redacted raw user section
  applies: "live";
  secrets: Array<{ path: string[]; set: boolean }>;   // value itself never rides
  revision: number;                       // CAS token for expectedRevision
}
```
Wire projection is field-by-field (`dsh-api-settings-controller/lib/index.js:274-289`), so no extra
provider fields leak. `expectedRevision === undefined` writes unconditionally
(`dsh-settings/lib/index.js:511`).

### `credentials` — exact shapes (`typert.remote-client.js:154-264`)

```ts
credentials.describe(refs: string[])     // at most 64 per call (MAX_DESCRIBE_REFS, dsh-api-settings-controller/lib/index.js:55)
  : Promise<RemoteResult<Record<string, {
      configured: boolean;               // resolving would return a value now
      source?: string;                   // layer supplying it, absent while unconfigured
      writable: boolean;                 // active provider can write this ref
    }>>>

credentials.set(ref: string, value: string): Promise<RemoteResult<void>>   // write-only; no read path
credentials.unset(ref: string): Promise<RemoteResult<void>>
```
Host implementation `lib/index.js:156-215`; failures are `RemoteError` codes
`credential/rejected {ref}` (`:208`) and `gateway/bad-request`/`gateway/internal`.

Failure codes for settings writes (`lib/index.js:501-509`): `settings/conflict {ns, expected, actual}`
from `SettingsConflictError` (`code: "SETTINGS_CONFLICT"`, `dsh-settings/lib/index.js:163-181`) and
`settings/rejected {ns}` for any other provider refusal.

---

## Q3 — Fallback transports

### 3.1 Authenticated exact route under `/api` — **recommended** (`ctx.connection.fetch.register`)

Contract (`dsh-client-connection/lib/index.js:840-849`, validator `:973-977`; Host-side `get fetch()`
`:731-735`):

```js
ctx.connection.fetch.register({
  path: "/api/<one-or-two-segments>",   // must satisfy endpointFromPath("/api", path) — lib/index.js:926-931
  methods: ["POST"],                    // non-empty, no repeats
  requestBody: "buffered",              // or "streaming" (dsh-client-file-upload/lib/index.js:49-55)
  fetch: (request /* WHATWG Request */) => Promise<Response>,
});                                     // returns a disposer; register inside ctx.effect(...)
```
Why it is authenticated: these routes are *not* separate HTTP routes. The only `/api` HTTP handler is the
`prefix` route registered in `apply()` (`:1044-1058`) which does `connection.admit(req)` **before** the
bridge, then `createSharedFetchHandler` matches the exact pathname and dispatches
(`:820-839`): `route?.methods.has(method)` → `peer.principal.kind !== "owner"` ⇒ 403, else
`route.fetch(request)`; unmatched ⇒ 404 (or Gateway, if the endpoint is claimed). Duplicate pathname throws.

Auth model itself (`dsh-client-connection/README.md:41-49`):
- each process mints a launch token; `?token=…` on `GET /` is exchanged by
  `ctx.connection.authorizeIndex` for an authority-bound signed cookie (`HttpOnly`, `Path=/`,
  `SameSite=Strict`, `Secure` under TLS, 30-day default), secret stored as
  `client-connection/browser-session` in `ctx.credentials`;
- same-origin `fetch()` from the DSH page therefore **is** authenticated automatically — the browser sends
  the cookie, `BrowserAuth.isAuthenticated` resolves it synchronously to `connection.browserPeer`
  (owner principal, `interactions: "answer"`), `admit()` returns `{peer}` (`lib/index.js:742-750`);
- before auth, `src/api-request-trust.ts` enforces loopback/bind-IP/`trustedHosts` Host plus
  same-authority `Origin` and rejects `sec-fetch-site: cross-site` (403 vs 401).

Precedents shipped in-tree: `dsh-api-session-controller/lib/index.js:2482` (`/api/file`, GET/HEAD),
`dsh-client-ui-deliverables/lib/index.js:49-60` (GET), `dsh-client-file-upload/lib/index.js:49-55`
(POST, streaming), `dsh-experimental-inspector/lib/index.js:2386`.

### 3.2 Raw `ctx.webServer.register` — **unauthenticated**, avoid for data

`dsh-host-webserver/lib/index.js:326-333`:
```js
register({ kind: "exact" | "prefix", path, handler: (req: IncomingMessage, res: ServerResponse) => … })
  → disposer
```
Matching: exact table → longest prefix → fallback (`:494-501`); duplicate `(kind,path)` throws; dispose
removes it. Nothing is logged, parsed, or authenticated — `dsh-host-webserver/README.md:130`: *"No
server-wide authentication or origin policy — route owners such as dsh-client-connection enforce their own
request policy."* If you must use it, call `ctx.connection.admit(req)` / `requestRejection(req)`
(`dsh-client-connection/lib/index.js:736-750`) yourself and answer 401/403 before reading the body.
Upgrade routes: `registerUpgrade({path, handler(req, socket, head)})` (`:340-346`). No `request`/`response`
helpers are provided — raw Node req/res.

**Verdict:** use 3.1 for a browser round-trip; it inherits the cookie, the trust fence, the
`connection/request` waterfall (`dsh-client-connection/README.md:53`), the 300 MiB buffered cap
(`README.md:80`), and Peer lifetime, and needs no WebSocket work. Do not add a second HTTP listener.

---

## Q4 — Settings namespaces: creation, declaration, shapes

### (a) What makes an entry id a settings namespace

A namespace is exactly **one profile Loader entry id whose plugin exports a schemastery `Config` with at
least one `.volatile()` field** — there is no `registerNamespace()` and no separate namespace table.
`dsh-settings/lib/index.js`:

- `:413-452` `describe()` iterates `ownerContext.configEditor.configuration()`; skips entries with no
  `Config`, no live fiber (`entry.fiber.state !== 2`), or `volatileForm(schema) === undefined`; emits
  `ns: entry.options.id` (`:443`), `schema: form.toJSON()`, `value/base/user = projectForm(form, …)`,
  `revision`.
- `:122-131` `volatileForm(schema)` → the form schema, `undefined` when nothing under it is volatile;
  `isVolatilePath` (`:153-158`) returns true for everything beneath a volatile node, which is what makes a
  whole subtree editable.
- `:501-537` `write(ns, …)`: `configEditor.entries().find(row => row.options.id === ns)` (`:502`), refuses
  unknown ids (`:504`) and non-volatile paths (`:507`, `:520`), then persists through
  `configEditor.edit(...)` into the active profile patch.
- `applies: "live"` is fixed (`:446`); `autoGenerate` comes from `configure()` (`:426`).

Practical consequences: your bundle's own entry id *is* your namespace (set `id:` in the bundle patch
row); only fields declared `.volatile()` are visible and writable; a namespace belongs to exactly one
entry, so you cannot create a namespace over another plugin's fields.

### (b) Declaring it

```js
// host half of the bundle — schemastery, not zod
import z from "@deepseek-ai/schemastery";
export const Config = z.object({
  endpoint: z.string().default("").volatile(),
  routes:   z.dict(z.object({
              baseURL: z.string(),
              apiKeyRef: z.string().role("credential-ref"),
            })).default({}).volatile(),
});
export function apply(ctx) {
  // optional: "I ship my own page" so the generic generated page stays off
  ctx.inject(["settings"], (child) =>
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)));
}
```
`configure(presentation, owner = this.ctx.fiber)` — `dsh-settings/lib/index.js:370-381`; policy only, it
removes neither reads nor writes (`README.md:39`). Live example: `dsh-client-ui-settings/lib/index.js:10-18`
(`z.object({ enabled: …volatile() })` + `settings.configure({ auto: false }, ctx.fiber)`).
`.role("secret")` fields are stripped and replaced by `secrets[{path,set}]` (`dsh-settings/lib/index.js:22-89`);
`.role("credential-ref")` fields are *not* stripped (see `dsh-llm-pi-ai/lib/index.js:1050`).

### (c) `describe` / `mutate` / `update` / `replace` semantics

- **Redaction**: always on for Remote callers — `describe({redactSecrets: true})`
  (`dsh-api-settings-controller/lib/index.js:398`), so a `role("secret")` value never crosses the wire;
  you get `secrets[].set` instead.
- **Revision**: monotonic per entry, bumped only when `[fiber.uid, schema.toJSON(), options.config]`
  changes (`dsh-settings/lib/index.js:421-434`), plus one bump when an entry disappears (`:453-462`);
  `settings/document-updated (ns, revision)` is emitted on each change (`:435`, `:461`).
- **Conflict**: `expectedRevision !== descriptor.revision` ⇒ `SettingsConflictError` (`:511`), mapped to
  `settings/conflict` with `{ns, expected, actual}` (`dsh-api-settings-controller/lib/index.js:503-507`).
  Send the `revision` you read; omit it only for blind writes.
- **Merge vs replace vs mutate**: `update` = `mergeLayers(current, patch)` (`:470-473`), `replace` =
  `mergeLayers(base, input)` (`:479-482`) — i.e. reset to inherited base first, then apply; `mutate`
  replays ordered ops onto the *stored* section and resolves `unset` against the inherited base
  (`:488-500`), so `{op:"unset", path:["providers","x"]}` deletes that key (`applyPathOp` `:189-216`),
  and an `unset` on an array index splices the element (`:195-199`).
- Array indices are strings (`"0"`, `"1"`), and writes are JSON-shaped only (`:237-273`).

---

## Q5 — Passive Host→Client observation: `ctx.remote.$on`

`$on(event, listener)` — `dsh-api-gateway/lib/client.browser.js:1680-1683`, delegating to
`ClientRemoteEvents.subscribe(ctx, event, listener)`; each subscription is fiber-owned. It throws when
`connection.interactions !== "answer"` (page clients are `answer`). Legal keys are exactly the Host
assembly's allowlist, `API_REMOTE_FORWARDED_EVENTS` (`dsh-api-remotes/lib/index.js:21-139`):

```
agent-preset/selected            approval/request*              api-session/activity
api-session/added                api-session/error              api-session/removed
api-session/status               commands/change                deepseek-account/session-expired
deepseek-account/model-sign-in-required                         credentials/record-updated
credentials/reference-updated    goal/activation-changed        cordis/request-run
cordis/request-run-resolved      cordis/dynamic-package         cordis/dynamic-retract
cordis/inspect-query             cordis/inspect-query-resolved  llm/adapters-updated
permission-presets/catalog-changed                              plugin-manager/changed
plugin-manager/install-log       plugin-manager/install-state   plugin-market/changed
settings/document-updated        schedule/changed               user-questions/request*
```
`*` = Agent-scoped waterfall (`request, next`), answerable only by owner peers. Modes and resource readers
are in the same array; forwarding mechanics `:146-181`, gateway broadcast `dsh-api-gateway/lib/index.js:1037-1061`.
The list is compile-time: **you cannot add your own Host event** without rebuilding `dsh-api-remotes`, and
ordinary notifications are not replayed after reconnect (`dsh-api-remotes/README.md:79`,
`dsh-api-gateway/README.md:90`).

For a settings page these four are the useful ones (exact shipped usage):
```js
ctx.remote.$on("settings/document-updated", (ns, revision) => …)  // dsh-client-ui-agent-preset/lib/client.js:2351
ctx.remote.$on("credentials/record-updated", refresh)             // dsh-client-ui-model-selection/lib/client.js:1012
ctx.remote.$on("credentials/reference-updated", refresh)          // :1015
ctx.remote.$on("llm/adapters-updated", refresh)                   // :1006  (also ctx.on("connection/reset"))
```
`$host` gives `{home, isLoopback}` as plain values, not a store (`dsh-api-gateway/README.md:62`).

---

## Recommended integration path for a new settings page

**No new Host API is required.** For all three requirements the mounted namespaces already expose the reads
and writes; a bespoke Host namespace buys round-trip count and typed validation, not capability. Two-tier
recommendation:

### Tier 1 (default): compose the mounted namespaces

Client plugin, `inject: ["slots", "locale", "remote", "remote.settings", "remote.credentials", "remote.llm", "connection"]`;
register a page into the `settings.section` list slot (owner `client-ui-settings-general`:
`dsh-cordis-client-runner/lib/client.js:5292-5343`; register options `id`, `order`, `label`;
owner prop `{ close() }`; working example `dsh-client-ui-settings-models/lib/client.js:4485-4501`).

```js
// client.js — read config, add a route, write its key
const settingsNs = "llm-pi-ai";                      // profile entry id (dsh-base/cordis.patch.yml:136)

async function readAll(ctx) {
  const [d, cfg] = await Promise.all([
    ctx.remote.settings.describe(),
    ctx.remote.llm.listConfigurableProviders(),
  ]);
  const ns = d.value.namespaces.find(n => n.ns === settingsNs);   // ns.revision, ns.value.providers
  const refs = cfg.value.flatMap(p => p.nativeAuth?.env ?? []);
  const c = await ctx.remote.credentials.describe(refs.slice(0, 64));   // <=64 refs per call
  return { ns, providers: cfg.value, credentials: c.value };
}

async function addRoute(ctx, id, profile, apiKey, revision) {
  const r = await ctx.remote.settings.mutate(settingsNs, [
    { op: "set", path: ["providers", id], value: profile },       // profile: { apiKeyEnv, baseURL?, api?, models? }
  ], revision);
  if (!r.ok) return r.error.code === "settings/conflict" ? "stale" : r.error.message;
  await ctx.remote.credentials.set(profile.apiKeyEnv, apiKey);   // write-only; never read back
  // live effect: llm-pi-ai re-registers routes from `providers` (Config: z.dict(profile).default({}).volatile())
  return r.value;                                                 // SettingsNamespaceView
}

async function removeRoute(ctx, id, revision) {
  return ctx.remote.settings.mutate(settingsNs, [{ op: "unset", path: ["providers", id] }], revision);
}

async function probe(ctx, request) {                              // { provider?, baseURL?, api?, apiKey? }
  return ctx.remote.llm.discoverModels(settingsNs, request);       // -> RemoteResult<ModelInfo[]>
}
```
Evidence: `providers` is the live route table — `dsh-llm-pi-ai/lib/index.js:1083`
`const Config = z.object({ providers: z.dict(profile).default({}).volatile() })`; `apiKeyEnv` is the
credential reference (`:1050`, `:1171`); `dsh-base/cordis.patch.yml:130-136` states routes "register live"
from the `llm-pi-ai:` settings section and "drop again when the section empties — exactly what the web
Models page does". Refresh on `settings/document-updated` / `credentials/reference-updated` /
`llm/adapters-updated` / `connection/reset`.

If you need a namespace of your own (new fields, not provider routes): add a Loader row with your own
`id:` and a volatile `Config` (§Q4b). Then `settings.describe()` lists it and
`settings.update("<your-id>", patch, revision)` writes it.

### Tier 2 (only if you need a bespoke Host call): SRC marker + `rpc.call`

```js
// index.js — Host half; no codegen, no generated /typert artifact
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";   // Remote = decorator alternative

const MARK = "@deepseek-ai/dsh-typert-protocol/remote-methods";
function markRemote(Ctor, names) {   // version-1 marker: dsh-typert-protocol/lib/index.js:429-439, 449-470
  Object.defineProperty(Ctor.prototype, MARK, {
    configurable: true,
    value: Object.freeze({ version: 1,
      methods: Object.freeze(names.map(m => Object.freeze({ method: m, invocation: Object.freeze({ kind: "direct" }) }))) }),
  });
}

class DshxRemote extends TypertRemoteService {
  constructor(ctx) { super(ctx, "dshx", { namespace: "dshx" }); }   // binding: {service, serviceKey, namespace}
  async routes() { return { routes: [...] }; }                      // plain JSON only
  async saveRoute(id, profile) { ... }                              // identifiers only; optional trailing `signal`
}
markRemote(DshxRemote, ["routes", "saveRoute"]);

export const inject = ["typert"];                    // only needed for the ctx.typert.register alternative
export function apply(ctx) { new DshxRemote(ctx); }  // same construction style as ClientRemoteService
```
Client half:
```js
const res = await ctx.connection.rpc.call("/api", "dshx/routes", { args: {} });
// res === { ok: true, value } | { ok: false, error: { code, message, details } }
```
Rules that bite: methods must be class methods with plain identifier parameters (SRC parses
`Function.prototype.toString`, `dsh-api-gateway/lib/index.js:1715-1744`); a trailing `signal` becomes the
cancellation parameter; every SRC argument is optional on the wire but extras are rejected
(`assertExactArguments`, `:1745-1757`); return values must be lossless JSON or the call folds to
`gateway/internal` (`encodeRpcResult`, `:1346-1360`). Duplicate namespace/method across live Services is
`gateway/ambiguous-endpoint` (`:1246`).

Alternative to the marker (public API, explicit control of optional/stream parameters):
`ctx.typert.register({ package: "dshx-bundle-plugin", face: "host", schemas: [], invocations: [{
  id: "dshx#dshx/routes", service: "dshx", namespace: "dshx", method: "routes",
  invocation: { kind: "direct" }, parameters: [], result: { mode: "src-json" } }] })`
(`dsh-typert-registry/lib/index.js:453-473`, `577-621`). The `typertRemote` binding is still required.
Passing a `Remote`-generated contribution through the *Client's* `$mount` is also possible but unnecessary
(sketch omitted: it needs hand-written strict codecs, §1.3).

### Pitfalls and limits

- Do not try to extend `ctx.remote` from the Host; the namespace map is Client-mount-only (§1.3).
- Do not forward a custom Host event to the browser; the allowlist is compile-time (§Q5).
- The Owner peer bypasses `remoteAccess` (`dsh-api-gateway/lib/index.js:1175`), so a new endpoint is
  reachable by the page with no policy — but a non-owner API caller is denied until a policy for its
  principal kind has a binding that names the call's resources and lists the endpoint action
  (`ctx.remoteAccess.registerPolicy(kind, policy)`, `dsh-api-remote-access/README.md`).
- `settings`/`config-editor` are disabled without a profile context (`dsh-base/cordis.patch.yml:105-112`);
  in this profile they are live.
- `credentials.describe` is capped at 64 refs per call (`dsh-api-settings-controller/lib/index.js:55`).
- A raw `ctx.webServer.register` route is world-readable on the bind address — it is outside
  `connection.admit` (§3.2).
- Only `role("secret")` is redacted; a key written as `settings` (not credentials) would ride to the page.
  Write API keys through `credentials.set` and keep only the *reference name* in settings.
