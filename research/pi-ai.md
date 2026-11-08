# DSH pi-ai provider configuration — findings for a "provider + multiple accounts" plugin

Investigation date: 2026-10-20. DSH Desktop 0.2.1-rc.2 (`dsh-llm-pi-ai` 0.2.1-rc.2, `@earendil-works/pi-ai` ^1.1.0).
Everything below is read-only investigation plus one derived artifact (`opencode-go-accounts.yaml`, generated and validated offline).
No live profile file was modified.

## 0. Evidence base

| What | Where |
|---|---|
| Extracted DSH packages | `C:\Users\Administrator\repos/dsh-provider-hub/asar\dsh\node_modules\@deepseek-ai\<pkg>\lib\…` (referred to below as `@deepseek-ai/<pkg>`) |
| Active profile patch (the file the Models page writes) | `C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml` |
| pi-ai package | **not** in the extraction tree originally — it is packed inside `…\resources\app.asar` |
| Local credential store | `C:\Users\Administrator\.dsh\.credentials.yaml` (refs + records; not read here on purpose) |
| Adapter version | `@deepseek-ai/dsh-llm-pi-ai/package.json` → `0.2.1-rc.2`, dep `@earendil-works/pi-ai: ^1.1.0` |

**Getting pi-ai.** `app.asar` is a plain Electron asar; the repo already has a 47-line reader at `C:\Users\Administrator\repos/dsh-provider-hub/asar.mjs`.
I extracted only that subtree into the existing tree (246 files):

```powershell
cd C:\Users\Administrator\repos/dsh-provider-hub
node asar.mjs list    "<…>\resources\app.asar" "@earendil-works/pi-ai"          # 246 entries
node asar.mjs extract "<…>\resources\app.asar" C:\Users\Administrator\repos/dsh-provider-hub/asar "@earendil-works/pi-ai"
# → C:\Users\Administrator\repos/dsh-provider-hub/asar\dsh\node_modules\@earendil-works\pi-ai\
```

(`js-yaml` was extracted the same way, to validate the generated YAML.) Anyone reproducing this needs `@earendil-works/pi-ai/dist/providers/data/*.json` — that is where endpoint, protocol and model catalog actually live.

---

## 1. Is `opencode-go` an installed pi-ai catalog provider?

**Yes — first-class catalog provider, not a hand-declared route.** `opencode-go` has its own pi-ai provider module, its own 30-model catalog and its own auth, and the profile's entry only *narrows/overrides* it.

- `@earendil-works/pi-ai/dist/providers/opencode-go.js:8-20` — `createProvider({ id: "opencode-go", name: "OpenCode Go", auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) }, models: Object.values(OPENCODE_GO_MODELS), api: { "anthropic-messages": …, "openai-completions": …, "openai-responses": … } })`.
- `…/dist/providers/opencode-go.models.js:5` — the catalog is `flattenChatModelCatalog("opencode-go", values)` over `…/dist/providers/data/opencode-go.json`.
- `…/dist/models.generated.js:72,116,160` and `…/dist/env-api-keys.js:107` (`"opencode-go": "OPENCODE_API_KEY"`) confirm it is registered in the built-in provider/model tables.
- Adapter side: `catalogProvider("opencode-go")` resolves, so `catalogModels()` returns its 30 models and `buildProvider()` takes the *reuse* path — `@deepseek-ai/dsh-llm-pi-ai/lib/index.js:926-928` (`if (catalog !== undefined && spec.api === undefined) return reuseCatalogProvider(catalog, spec)`), `:901-919` (dispatch stays with pi-ai's own provider implementation).

### Defaults

| Fact | Value | Evidence |
|---|---|---|
| pi-ai provider id | `opencode-go` | `opencode-go.js:10` |
| Display name (pi-ai) | `OpenCode Go` | `opencode-go.js:11` |
| Auth | api-key; env hint `OPENCODE_API_KEY` | `opencode-go.js:12`, `env-api-keys.js:107` |
| Wire protocols | `anthropic-messages`, `openai-completions`, `openai-responses` (all wrapped with the OpenCode session header) | `opencode-go.js:14-18`, `opencode-headers.js` |
| Base URL — anthropic family | **`https://opencode.ai/zen/go`** | `data/opencode-go.json` → `["anthropic-messages"]["chat:claude-haiku-5-5"].baseUrl` |
| Base URL — OpenAI families | **`https://opencode.ai/zen/go/v1`** | `data/opencode-go.json` → `["openai-completions"]…baseUrl`, `["openai-responses"]…baseUrl` |
| Model count | 30 chat models: 5 anthropic + 19 completions + 6 responses | `data/opencode-go.json` (top-level keys are protocol names) |

There is **no provider-level `baseUrl`** in the catalog data — each model carries its own `baseUrl` and `api`. That is exactly why one route can legitimately serve three protocols.

### What the table at `index.js:2733` is

`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:2601` opens `const PROVIDER_DATA = { … }` — a **generated, display-only metadata table** (`scripts/gen-provider-data.ts`, described at `README.md:164-169`) mapping provider id → `{ env: [...], defaultBaseURL?, baseURLEnv? }`. It feeds the **configurable-provider directory** the Models page reads, via `providerDefaultsOf()` at `index.js:2801-2812`:

```js
function providerDefaultsOf(provider) {
  const data = PROVIDER_DATA[provider.id];
  if (data === undefined) return provider.baseUrl && !provider.baseUrl.includes("{") ? { defaultBaseURL: provider.baseUrl } : {};
  const { env, ...endpoint } = data;
  return { ...endpoint, nativeAuth: { env, oauth: provider.auth.oauth !== undefined } };
}
```

So `"opencode-go": { env: ["OPENCODE_API_KEY"] }` (`index.js:2734`) means: *no* `defaultBaseURL` and *no* `baseURLEnv` are advertised for this route, only the ambient-auth env hint. Endpoint, protocol and models do **not** come from this table — they come from the real pi-ai provider + `data/opencode-go.json`. Consequence for the UI: the Models page shows an **empty endpoint field** for `opencode-go`, with the per-model endpoints invisible (`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:1206-1207` only forwards `defaultBaseURL`/`baseURLEnv`).

### The 30 catalog models (verbatim from `data/opencode-go.json`)

| family / baseURL | model id | ctx | max out | input |
|---|---|---|---|---|
| `anthropic-messages` · `https://opencode.ai/zen/go` | `claude-haiku-5-5` | 1000000 | 128000 | text,image |
|  | `minimax-m3` | 1000000 | 131072 | text,image |
|  | `qwen3.7-plus` | 1000000 | 65536 | text,image |
|  | `qwen3.8-flash` | 1000000 | 131072 | text,image |
|  | `qwen3.8-max` | 1000000 | 131072 | text,image |
| `openai-completions` · `https://opencode.ai/zen/go/v1` | `deepseek-v4-flash` | 1000000 | 384000 | text |
|  | `deepseek-v4-flash-vision-exp` | 1000000 | 384000 | text,image |
|  | `deepseek-v4-pro` | 1000000 | 384000 | text |
|  | `deepseek-v4.1-flash` | 1000000 | 384000 | text,image |
|  | `glm-5.2`, `glm-5.3` | 1000000 | 131072 | text |
|  | `glm-5.3-flash` | 1000000 | 131072 | text,image |
|  | `hy3` | 256000 | 128000 | text |
|  | `hy4-preview` | 1024000 | 64000 | text |
|  | `kimi-k2.7-code` | 262144 | 262144 | text,image |
|  | `kimi-k3` | 1048576 | 131072 | text,image |
|  | `longcat-2.0` | 1000000 | 131072 | text |
|  | `longcat-2.5-preview-free` | 1000000 | 131072 | text,image |
|  | `mimo-v2.5` | 1000000 | 128000 | text,image |
|  | `mimo-v2.5-pro` | 1048576 | 128000 | text |
|  | `mimo-v2.6-flash`, `mimo-v2.6-pro` | 1048576 | 131072 | text,image |
|  | `minimax-m2.7` | 204800 | 131072 | text |
|  | `space-bunny` | 1048576 | 524288 | text,image |
| `openai-responses` · `https://opencode.ai/zen/go/v1` | `gpt-5.6-luna`, `gpt-6-luna` | 1050000 | 128000 | text,image |
|  | `grok-4.6`, `grok-4.7` | 500000 | 500000 | text,image |
|  | `muse-spark-1.2-contributor`, `muse-spark-1.3-contributor` | 1048576 | 131072 | text,image |

The profile's existing 30-entry `models` list (`cordis.patch.yml:39-239`) is a **1:1 copy of these ids**. Because `models` replaces the catalog and each entry defaults its unset fields from the installed model of the same id (`index.js:688`, `:698-711`), the list is currently metadata-neutral — it inherits `api`, `baseUrl`, `cost`, `reasoning`, `compat`, `inputLimits` per id. It only pins the *set* of ids.

---

## 2. What a second account route must contain

### Schema

`index.js:1049-1083`:

```js
const modelFields = { name, contextWindow, maxTokens, input, reasoningEfforts, compat };   // :1035-1042 — NO api, NO baseURL
const modelProfile = z.object({ id: z.string().required(), ...modelFields });               // :1043-1046
const profile = z.object({
  apiKeyEnv, displayName, api, baseURL, models, modelOverrides, compat,
  defaultContextWindow, defaultMaxTokens, defaultInput, headers, reasoning,
  thinkingBudgets, cacheRetention, transport, timeoutMs, websocketConnectTimeoutMs,
  streamIdleTimeoutMs, maxRequestImageBytes, requestImagePixelBudget, requestImageMaxBytes, retryPolicy,
});
const Config = z.object({ providers: z.dict(profile).default({}).volatile() });             // :1083
```

**There is no per-model `api` or `baseURL`.** They exist only at route level. That single fact drives the whole multi-account design (§5).

### Resolution rules for a route the catalog does not ship

`resolveRouteModels` (`index.js:656-736`):

| Field | Behavior on an uncatalogued route | Line |
|---|---|---|
| `models` | required, non-empty — else `provider "X" resolves no models; the installed catalog does not describe this route, so its models must be listed in configuration` | `:678` |
| `api` | required (no route-level `api`, no catalog `api` for the model) — else `model "m" needs an api; the installed catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks` | `:689-690` |
| `baseURL` | required — else `model "m" needs a baseURL; the installed catalog does not describe this route` | `:691-692` |
| `contextWindow` | `entry ?? base ?? defaultContextWindow (262144)` | `:693-694` |
| `maxTokens` | `entry ?? base ?? defaultMaxTokens (32768)` | `:695-696` |
| `name` | `entry ?? base ?? entry.id` → **optional** | `:701` |
| `input` | `entry ?? base ?? route defaultInput (["text"])` | `:705` |
| `cost` | `base?.cost ?? NO_COST` → **declared routes are free** | `:706` |
| `reasoning` | `base?.reasoning ?? false` unless `reasoningEfforts` declared | `:587` |
| `modelOverrides` | refused: `sets modelOverrides for "id", but the installed catalog does not describe this route` | `:665` |
| `compat` | route-level applied field-by-field to every model whose protocol offers it | `:627-646` |

Minimum working entry (accepted by the adapter's `Config` schema in the verification run; serviceable per the table above):

```yaml
      opencode-go-9:
        api: openai-completions
        baseURL: https://opencode.ai/zen/go/v1
        models:
          - id: deepseek-v4-flash
```

That resolves, but it is a *bad* entry: reasoning off, cost 0, no compat. A production second-account entry must carry what §1's catalog would have supplied.

### Route-id legality

| Grammar | Regex | Where | `opencode-go-2` |
|---|---|---|---|
| Settings dict key | any non-empty string | `index.js:1123` | legal |
| Credential **record** segment | `/^[a-z][a-z0-9-]*$/` | `@deepseek-ai/dsh-credentials/lib/types/index.js:14`, `isCredentialKeySegment` `:47-49` | **legal** (verified) |
| Models-page "add provider" card | `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/` | `client.js:1544` | legal |
| `apiKeyEnv` **reference** | `/^[A-Za-z_][A-Za-z0-9_]*$/` | `dsh-credentials…/types/index.js:12`, `credentialRef` `:20-25`; applied in `index.js:1171` | `OPENCODE_GO_2_API_KEY` legal, `opencode-go-2` **rejected** |

So: a numeric suffix is legal for the route id and for the derived credential reference, but *only* if the reference is derived with the page's algorithm (`client.js:1230-1232`): uppercase, every non-alphanumeric run → `_`, then `_API_KEY`. A digit-leading id (`2opencode`) passes the settings check and dies at the credential seam — which is why the UI pattern forbids it (`client.js:1536-1543`).

---

## 3. Exact wire shapes the Models page uses

Remote namespaces are `ctx.remote.settings`, `ctx.remote.credentials`, `ctx.remote.llm`; all are thin wrappers (`client.js:3169-3204`).

### settings.mutate

Signature (`@deepseek-ai/dsh-api-settings-controller/lib/typert.host.js:577`, schema `:46-55`):

```
mutate(ns: string, ops: SettingsPathOpView[], expectedRevision?: number): Promise<SettingsNamespaceView>

type SettingsPathOpView = { op: 'set'; path: string[]; value: JsonValue }
                        | { op: 'unset'; path: string[] }
interface SettingsNamespaceView { autoGenerate; ns; schema; value; base?; user?; applies:'live'; secrets; revision: number }
```

Failure codes: `settings/conflict` (stale revision) and `settings/rejected` (`dsh-api-settings-controller/lib/index.js:503`); the page maps the first to its "conflict" copy (`client.js:3186-3192`).

The namespace for pi-ai is the **plugin entry id**: `settingsNs = ctx.fiber.entry?.options.id ?? "llm-pi-ai"` (`index.js:2864`), and every directory row carries `settingsPath: ["providers", <route>]` (`index.js:2849`). For this profile the entry id is `llm-pi-ai` (`cordis.patch.yml:33`).

**1) Add a provider route** — one op setting the whole profile (`client.js:1600-1611`):

```js
{
  op: "set",
  path: ["providers", "opencode-go-2"],
  value: {
    displayName: "OpenCode Go (Account 2)",   // omitted when the field is blank
    apiKeyEnv: "OPENCODE_GO_2_API_KEY",       // omitted when no key is typed
    api: "anthropic-messages",
    baseURL: "https://opencode.ai/zen/go",
    models: [ /* [{id,name,contextWindow,maxTokens,input,reasoningEfforts?,compat?}] */ ]
  }
}
// ops array: exactly one element; expectedRevision = revision read when the card opened (client.js:1560,1611)
```

**2) Change displayName (or baseURL/api/models)** — minimal path ops against the stored section (`client.js:1822-1838`, `:1923-1948`):

```js
[
  { op: "set", path: ["providers", "opencode-go-2", "displayName"], value: "OpenCode Go (Work)" },
  { op: "set", path: ["providers", "opencode-go-2", "baseURL"],     value: "https://opencode.ai/zen/go" },
  { op: "set", path: ["providers", "opencode-go-2", "api"],         value: "anthropic-messages" },
  { op: "set", path: ["providers", "opencode-go-2", "models"],      value: [ /* complete array */ ] },
  { op: "unset", path: ["providers", "opencode-go-2", "baseURL"] }   // for each key removed from the draft
]
// only changed keys produce an op; `models` is always sent whole when it changed
// expectedRevision = namespace.revision, updated from written.view.revision (client.js:1872,1946)
```

> Note: because the card's draft holds the whole profile object, saving **any** field re-sends `models` as one array. A management plugin should send single-key ops instead.

**3) Set the API key** — separate namespace, separate call (`client.js:1616`, `:1950`):

```js
await ctx.remote.credentials.set("OPENCODE_GO_2_API_KEY", "<raw key>")
// → RemoteError 'credential/rejected' { ref } on refusal (lib/types/credentials.js:164-171)
```

Reference derivation (`client.js:1230-1232`):

```js
function deriveKeyRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
// opencode-go-2 → OPENCODE_GO_2_API_KEY
```

The page uses the profile's own `apiKeyEnv` when present (`refFor`, `client.js:1846-1850`; `apiKeyEnvOf`, `:1273-1279`) and only writes `apiKeyEnv` into the profile when a key is typed and none exists (`client.js:1925`).

**4) Delete a provider route** — credential first, then the profile (`client.js:2260-2271`):

```js
await ctx.remote.credentials.unset("OPENCODE_GO_2_API_KEY");       // only when the ref is the page-managed one (:2297-2300)
await ctx.remote.settings.mutate("llm-pi-ai",
  [{ op: "unset", path: ["providers", "opencode-go-2"] }],
  undefined);                                                       // note: unconditional, no revision
```

**Where the write lands:** not a separate settings store — `dsh-settings` delegates to the config editor, whose `documentPath` is the profile patch (`@deepseek-ai/dsh-config-editor/lib/index.js:24-25`, `:69-128`, atomic write at `:123`). For this profile that is `C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml`. Path ops are accepted only under a `.volatile()` node (`dsh-settings/lib/index.js:153-158`, `:507`) — `providers` is declared volatile (`index.js:1083`), so any `providers.*` path is writable.

---

## 4. Model discovery

**The client has a reachable method**, and it is a Remote (Host-side work, browser-callable):

```js
// client.js:3194-3202
discoverModels: async (settingsNs, request) => {
  const response = await ctx.remote.llm.discoverModels(settingsNs, request);
  return response.ok ? { kind: "found", models: response.value }
                     : { kind: "refused", message: response.error.message };
}
// call sites: client.js:888 (catalog peek) and client.js:950-955 (fetch button)
```

Request/response types (`@deepseek-ai/dsh-llm/lib/typert.host.js:408,428`):

```ts
interface LlmModelDiscoveryRequest { provider?: string; baseURL?: string; api?: string; apiKey?: string }
interface LlmDiscoveredModel { id: string; name?: string; contextWindow?: number; maxTokens?: number;
                               inputModalities?: readonly ModelModality[] }
// Remote signature: discoverModels(settingsNs, request, signal?) → LlmDiscoveredModel[]
// Host: ctx.llm.discoverModels(settingsNs, request, signal)   dsh-llm/lib/index.js:1998-2017
// Host registration: ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => …)  :1977-1987
// error mapping: RemoteError 'llm/model-discovery-rejected'  :2030
```

The page sends exactly (`client.js:950-955`): `{ provider, baseURL?, api?, apiKey? }` — the typed key, when present, wins over the stored one.

Adapter behavior (`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:2385-2436`):

1. `request.provider` names a **catalog** route → returns the installed catalog immediately, **no network, no key check** (`:2386-2394`).
2. Otherwise `baseURL` is mandatory (`DISCOVERY_FAILED` at `:2396`), `api` defaults to `openai-completions` (`:2397`), and only `anthropic-messages | openai-completions | openai-responses` are listable (`LISTABLE_PROTOCOLS`, `:2239-2243`, else `DISCOVERY_UNSUPPORTED`).
3. URL: `{baseURL}/models`, or `{root}/v1/models?limit=1000` for anthropic with one trailing `/v1` normalized away (`:2275-2279`).
4. Auth: `x-api-key` + `anthropic-version` for anthropic, `Bearer` otherwise; profile `headers` and the stored route credential are supplied by the Host (`:2400-2411`, Host side `:2928-2940`).
5. Non-2xx → `DISCOVERY_FAILED` with `"<url> answered 401; check the API key"` (`:2421`); reply >4 MiB refused (`:2255`, `:2286`).

So for `opencode-go-2` the Models page's *Fetch models* button **is** a real key probe (endpoint listing), while for `opencode-go` it can never validate anything.

---

## 5. Multi-account feasibility

### (a) One route per account — the only design that works per-session

Runtime: fully works. `listProviders()`/`providerInfo` derive the picker group from `displayName` (`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1878-1883`), `listModels` returns each route's serviceable models (`:1887-1904`), and every request resolves that route's own `apiKeyEnv` (`:1954`, `:2892-2899`). Two routes = two independent keys, selectable per session.

Cost: a route the catalog does not ship loses catalog metadata (see §2 table and §7 pitfalls) — and, decisively, **one route can only carry one `api` + one `baseURL`**. `opencode-go` uses three protocols and two endpoints, so a faithful second account needs **three** routes.

**Model picker shows:** one group per route, named by `displayName`, containing that route's model ids. Account 2's Claude models appear under "OpenCode Go (Account 2)", not merged with account 1's.

### (b) N credentials on one route — no rotation hook exists

Evidence, end to end:

- `resolveApiKey(provider, profile)` reads **only** `profile.apiKeyEnv` (`index.js:2892-2899`) and throws `MISSING_CREDENTIAL` when it resolves to nothing.
- It is called once per stream operation (`index.js:1954`, inside `streamWithSnapshot`) and passed to pi-ai as `apiKey` — the highest-priority auth override (`README.md:139`).
- The value comes from `ctx.credentials.resolve(ref)`; that seam's `resolve` takes **only** a `CredentialRef` — no provider, model, session or request argument (`@deepseek-ai/dsh-credentials/lib/types/index.js:118-167`).
- `llm/stream` is a waterfall and is the only per-request interposition point (`@deepseek-ai/dsh-llm/lib/index.js:2394-2397`), but a cordis waterfall listener receives `(options, next)` and `next` **ignores its arguments** — only in-place mutation of `options` is possible (`@deepseek-ai/cordis/lib/index.js:317-325`).
- Worse, the agent loop **binds the registration before the waterfall**: `preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)` (`@deepseek-ai/dsh-agent-loop/lib/index.js:1201`) then `preparedCall.stream(request)` (`:1084`); `prepareCall` captures `registration` and a `dispatch` bound to that adapter (`dsh-llm/lib/index.js:2249-2259`) and rejects a config change at dispatch (`:2327`). Mutating `options.provider` there cannot move the call to another route.

What *is* possible without touching routes:

- **Rotate the stored value** (`credentials.set(ref, …)` between steps): global, racy across concurrent sessions, and it rewrites `.credentials.yaml`. Works because resolution is per operation — the same mechanism the README advertises for key rotation (`dsh-credentials/README.md`).
- **Replace the credential provider** with a delegating one that maps a stable ref to a chosen account (only one service instance per name, so `dsh-credentials-local` would have to be dropped): gives "one route, N keys, switchable", but the seam cannot see which session/request asked, so selection is global.
- The retry path does re-dispatch the step, so such a provider could rotate on `RATE_LIMIT`/`QUOTA` retries — but with no knowledge of which account is already saturated.

**Verdict:** no legitimate per-request, per-session credential selection. (b) is a global-switch design only.

### (c) A second `llm-pi-ai` plugin entry — fails at load

Each pi-ai entry declares **every installed catalog provider** in the LLM directory before any route exists (`index.js:2841-2858`, called unconditionally at `:2919-2926`). The directory is global and refuses duplicates:

```js
if (this.directory.has(entry.provider) && !own.has(entry.provider) || …)
  throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
```
`@deepseek-ai/dsh-llm/lib/index.js:1935`

So a second entry (`- id: llm-pi-ai-2`) collides on the first catalog id (both entries declare the same `catalogProviderIds()`), and the registration throws inside `apply` — inferred from the code path, not run live; the plugin's own volatile-update path treats that same class of failure as fatal-and-logged (`index.js:2957-2963`), and `registerAdapter`'s route conflicts are documented as load failures (`README.md:34`). Even if it loaded: identical route names throw `DUPLICATE_ADAPTER` (`dsh-llm/lib/index.js:1872`, all-or-nothing), its settings namespace would be `llm-pi-ai-2` (`index.js:2864`) which the Models page can *edit* per row but never *create* into (`NS$1 = "llm-pi-ai"`, `client.js:1535`), and both entries would fight over one directory.

**Verdict:** (c) is not viable without patching the adapter (e.g. making the catalog declaration idempotent).

---

## 6. Credential reference vs credential key

Two disjoint spaces in one service (`@deepseek-ai/dsh-credentials/lib/types/index.js`):

| | `CredentialRef` | `CredentialKey` |
|---|---|---|
| Shape | POSIX shell identifier `/^[A-Za-z_][A-Za-z0-9_]*$/` (`:12`, `:20-25`) | `<scope>/<id>`, each `/^[a-z][a-z0-9-]*$/` (`:14`, `:57-64`) |
| Meaning | "what is behind this env-var-shaped name" | "what credential does plugin `<scope>` hold for `<id>`" |
| Ops | `resolve(ref)`, `describe(ref)`, `set(ref, value)`, `unset(ref)` | `readRecord`, `describeRecord`, `listRecords`, `modifyRecord` (only write path), `deleteRecord` |
| Storage | `.credentials.yaml` → `refs:` | `.credentials.yaml` → `records:` |
| pi-ai use | **every route's `apiKeyEnv`** | OAuth/api-key sign-in records at `llm-pi-ai/<provider id>` (`index.js:2137-2168`) |

So: **`apiKeyEnv` must be an env-style NAME, never a record key.** `resolveProfiles` brands it with `credentialRef()` immediately (`index.js:1171`), which throws `TypeError: credential ref "…" must match /^[A-Za-z_][A-Za-z0-9_]*$/` if you write `llm-pi-ai/opencode-go-2` there. Any registered *reference* works — the ref does not have to exist as a real environment variable; `credentials.set(ref, …)` stores it in the file, and the file outranks the launch environment, the project `.env` and the home `.env` (`@deepseek-ai/dsh-credentials-local/README.md`, "Where keys come from").

Per-request resolution (`index.js:2892-2899`):

```js
const resolveApiKey = async (provider, profile) => {
  const ref = profile.apiKeyEnv;
  if (ref === void 0) return void 0;                       // keyless route → pi-ai ambient discovery
  const credentials = ctx.get("credentials");
  const hit = credentials !== void 0 ? (await credentials.resolve(ref))?.value
                                     : launchEnvironmentOf(ctx).get(ref)?.value;
  if (hit !== void 0 && hit.length > 0) return assertUsableApiKey(hit, "llm-pi-ai", ref);
  throw new LlmError(`llm-pi-ai: no credential for provider route "…" …`, "MISSING_CREDENTIAL");
};
```

One ref per route; changing the stored value takes effect on the next request (no restart).

---

## 7. Failure and health signals for a management UI

### Codes pi-ai can return

| Code | When | Evidence |
|---|---|---|
| `MISSING_CREDENTIAL` | `apiKeyEnv` resolves to nothing (empty counts as absent) | `index.js:2898` |
| `INVALID_CREDENTIAL` | value is blank or has characters no HTTP header can carry | `index.js:2897` → `assertUsableApiKey`; blank/unusable probe key `:2370-2373` |
| `UNKNOWN_MODEL` | model not in the route's served set | `index.js:1875` |
| `INVALID_CONFIG` | that model carries a retained catalog diagnostic | `index.js:1873` |
| `UNSUPPORTED_REASONING_EFFORT` | requested effort not offered by the model | `index.js:1788` |
| `QUOTA` | terminal quota/balance wording (`insufficient quota`, `quota exceeded`, `out of credits`, …) | `dsh-llm/lib/index.js:138`, classifier `:181-184`, applied at `dsh-llm-pi-ai…/index.js:1450` |
| `RATE_LIMIT` | 429 / "rate limit" wording | `index.js:1451` |
| `AUTH` | message contains 401/403 | `index.js:1449` |
| `INVALID_REQUEST` (400/413), `SERVER` (5xx), `TIMEOUT`, `TRANSPORT`, `PI_AI_ERROR` | fallback ladder | `index.js:1452-1458` |
| `CONTEXT_WINDOW_EXCEEDED`, `EMPTY_RESPONSE` | stop-reason mapping | `index.js:1470-1480` |
| `IMAGE_OFFLOAD_REQUIRED`, `UNSUPPORTED_OPTION` (`GenerateOptions.stop`) | `index.js:1402`, `:1944` |
| `DISCOVERY_FAILED`, `DISCOVERY_UNSUPPORTED`, `NO_DISCOVERY`, `INVALID_DISCOVERY` | discovery only | `index.js:2396-2421`, `dsh-llm/lib/index.js:2000-2001` |

Retryable by default: `EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT` — **not** `QUOTA`, `AUTH`, `INVALID_CREDENTIAL` (`dsh-llm/lib/index.js:251-257`). Good signal design: `QUOTA`/`AUTH` mean "this account is dead", `RATE_LIMIT` means "wait".

Caveat for any health badge: `LlmFailure.status` exists (`dsh-llm/lib/typert.host.js:412`) but pi-ai does **not** expose a stable HTTP status, so classification is regex-on-message (`README.md:258`; `index.js:1448-1458`). A gateway that says "invalid api key" without a 401/403 is reported `PI_AI_ERROR`, not `AUTH`.

### Does `listModels` / `resolveModelInfo` validate a key?

**No.**

- `listModels(provider)` resolves the credential first; **only** `MISSING_CREDENTIAL` is swallowed into `[]` — every other failure throws (`index.js:1887-1896`). With a valid-shaped key it returns the configured models without any network I/O.
- `resolveModelInfo`/`resolveModel` read the snapshot only (`index.js:1905-1910`, `dsh-llm/lib/index.js:2111-2114`) — no credentials, no network.
- Discovery validates a key **only for an uncatalogued route** (§4).

Where the key *is* genuinely exercised: the first real model request, and `discoverModels` on a declared route.

**Picker-visible health (free):** the browser catalog drops groups with zero models (`@deepseek-ai/dsh-api-session-controller/lib/index.js:604`) and isolates thrown routes into `failures` (`:593-602`). So:

| Condition | What the picker shows |
|---|---|
| ref unset/blank (`MISSING_CREDENTIAL`) | route **absent** (listModels → []) |
| ref present but malformed (`INVALID_CREDENTIAL`) | route in the `failures` list with the message |
| ref present and plausible, key wrong | route listed normally; fails at the first request with `AUTH`/`PI_AI_ERROR` |

---

## 8. Deliverables

### 8.1 (i) Recommended account model and route-naming scheme

**An account = one credential reference + 1..3 routes.** Account 1 is the catalog route; account *n* is one declared route per wire-protocol family it needs.

```
opencode-go                  ← account 1, catalog route (api/baseURL/models inherited)
      apiKeyEnv: OPENCODE_GO_API_KEY

opencode-go-<n>              ← account n, anthropic-messages  @ https://opencode.ai/zen/go
opencode-go-<n>-completions  ← account n, openai-completions  @ https://opencode.ai/zen/go/v1
opencode-go-<n>-responses    ← account n, openai-responses    @ https://opencode.ai/zen/go/v1
      apiKeyEnv: OPENCODE_GO_<n>_API_KEY     (all three, set explicitly)
```

Rules that make this work:

1. **Never put `api` or `baseURL` on the catalog route.** Either one collapses all 30 models onto a single protocol/endpoint (`index.js:689-692`, `buildProvider` `:927-938`).
2. **Always set `apiKeyEnv` explicitly on the sibling routes** and give all of an account's routes the *same* ref. Otherwise each route derives its own ref (`…_COMPLETIONS_API_KEY`) and one account needs three keys.
3. **Skip families you do not use.** If the account only needs Claude/MiniMax/Qwen, one route (`opencode-go-2`) is enough; the superset is only for parity with account 1.
4. **Route ids stay `<catalogId>-<n>`** — legal as a settings key, a credential record segment (`[a-z][a-z0-9-]*`) and the page's `ROUTE_PATTERN`, and the derived ref is a legal POSIX identifier.
5. **Give each route a distinct `displayName`** — it is the picker group label (`index.js:1878-1883`).

Suggested plugin data model:

```
Account { id, label, providerId:'opencode-go', ref:'OPENCODE_GO_2_API_KEY',
          routes:[{routeId:'opencode-go-2',            api:'anthropic-messages', baseURL:'…/zen/go'},
                  {routeId:'opencode-go-2-completions',api:'openai-completions', baseURL:'…/zen/go/v1'},
                  {routeId:'opencode-go-2-responses',  api:'openai-responses',   baseURL:'…/zen/go/v1'}] }
```

Operations map 1:1 onto §3: create = N× `settings.mutate {set providers.<route>}` + 1× `credentials.set(ref)`; delete = `credentials.unset(ref)` + N× `mutate {unset providers.<route>}`; relabel = N× `mutate {set …displayName}`; rekey = `credentials.set(ref)` only.

### 8.2 (ii) Config

**(a) `opencode-go` — keep it catalog-driven.** Minimum, and what I recommend replacing lines 36-240 with:

```yaml
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
```

Equivalent to today's 200-line block (every declared entry inherits its catalog model by id), and it automatically picks up new catalog models. Keeping the explicit list is also safe; just never add `api`/`baseURL` to it.

**(b) `opencode-go-2` — complete, ready to paste** (copy of `opencode-go-accounts.yaml:222-299`; verified against the adapter schema):

```yaml
      opencode-go-2:
        displayName: "OpenCode Go (Account 2)"
        apiKeyEnv: "OPENCODE_GO_2_API_KEY"
        api: "anthropic-messages"
        baseURL: "https://opencode.ai/zen/go"
        models:
          - id: "claude-haiku-5-5"
            name: "Claude Haiku 5.5"
            contextWindow: 1000000
            maxTokens: 128000
            input:
              - "text"
              - "image"
            reasoningEfforts:
              off:
              minimal: "low"
              low: "low"
              medium: "medium"
              high: "high"
              xhigh: "xhigh"
              max: "max"
            compat:
              forceAdaptiveThinking: true
              supportsTemperature: false
          - id: "minimax-m3"
            name: "MiniMax-M3"
            contextWindow: 1000000
            maxTokens: 131072
            input:
              - "text"
              - "image"
            reasoningEfforts:
              off:
              minimal: "low"
              low: "low"
              medium: "medium"
              high: "high"
          - id: "qwen3.7-plus"
            name: "Qwen3.7 Plus"
            contextWindow: 1000000
            maxTokens: 65536
            input:
              - "text"
              - "image"
            reasoningEfforts:
              off:
              minimal: "low"
              low: "low"
              medium: "medium"
              high: "high"
          - id: "qwen3.8-flash"
            name: "Qwen3.8 Flash"
            contextWindow: 1000000
            maxTokens: 131072
            input:
              - "text"
              - "image"
            reasoningEfforts:
              off:
              minimal: "low"
              low: "low"
              medium: "medium"
              high: "high"
            compat:
              allowEmptySignature: true
          - id: "qwen3.8-max"
            name: "Qwen3.8 Max"
            contextWindow: 1000000
            maxTokens: 131072
            input:
              - "text"
              - "image"
            reasoningEfforts:
              off:
              minimal: "low"
              low: "low"
              medium: "medium"
              high: "high"
```

*Why `reasoningEfforts` is spelled out (and why `minimal: "low"`):* on a declared route the adapter materializes **every undeclared level as `null` = unsupported** (`index.js:598-603`), and pi-ai's own rule is "absent base level = supported, absent `xhigh`/`max` = unsupported, `null` = unsupported" (`pi-ai/dist/models.js:679-689`). pi-ai then clamps an undeclared Anthropic level to `low/medium/high` (`pi-ai/dist/api/anthropic-messages.js:696-711`). Declaring the *clamped* spelling reproduces both the level set and the exact wire value; the generator asserts the level set is identical for all 30 models (`verify` output: `level-set mismatches: none`).

**(c) The two OpenAI families** are in `opencode-go-accounts.yaml:300-538` (`-completions`, 19 models) and `:539-621` (`-responses`, 6 models). The completions route hoists the four fields all 19 models share to route level:

```yaml
      opencode-go-2-completions:
        displayName: "OpenCode Go (Account 2) Chat"
        apiKeyEnv: "OPENCODE_GO_2_API_KEY"
        api: "openai-completions"
        baseURL: "https://opencode.ai/zen/go/v1"
        compat:
          supportsStore: false
          supportsDeveloperRole: false
          supportsStrictMode: true
          maxTokensField: "max_tokens"
        models: [ … 19 entries with per-model thinkingFormat/… ]
```

`opencode-go-accounts.yaml` is the **whole** `- id: llm-pi-ai` entry (current 30-model `opencode-go` block + the three new routes), 621 lines, YAML-parsed and schema-validated; it is a drop-in replacement for `cordis.patch.yml:33-240`.

### 8.3 (iii) Verbatim call shapes (copy-ready)

```js
// ---- add account 2 (three routes, one credential) -------------------------
for (const route of routes) {
  await ctx.remote.settings.mutate("llm-pi-ai", [
    { op: "set", path: ["providers", route.id], value: route.profile }
  ], expectedRevision);            // from the settings describe view: namespaces[ns].revision
}
await ctx.remote.credentials.set("OPENCODE_GO_2_API_KEY", apiKey);

// ---- rename an account's display name (minimal op) ----------------------
await ctx.remote.settings.mutate("llm-pi-ai", [
  { op: "set", path: ["providers", "opencode-go-2", "displayName"], value: "OpenCode Go (Work)" }
], revision);

// ---- delete account 2 ---------------------------------------------------
await ctx.remote.credentials.unset("OPENCODE_GO_2_API_KEY");
await ctx.remote.settings.mutate("llm-pi-ai", [
  { op: "unset", path: ["providers", "opencode-go-2"] },
  { op: "unset", path: ["providers", "opencode-go-2-completions"] },
  { op: "unset", path: ["providers", "opencode-go-2-responses"] }
], undefined);

// ---- credential presence (never the value) ------------------------------
const info = await ctx.remote.credentials.describe(["OPENCODE_GO_API_KEY", "OPENCODE_GO_2_API_KEY"]);
// → { "OPENCODE_GO_API_KEY": { configured: true, source: "<provider-specific label>", writable: true }, … }
```

Host-side equivalents: `ctx.settings.mutate(ns, ops, expectedRevision)` (`dsh-settings/lib/index.js:488-500`), `ctx.credentials.set(ref, value)` / `describe(ref)` (`dsh-credentials/lib/types/index.js:118-167`), `ctx.llm.registerModelDiscovery(…)`.

### 8.4 (iv) The discovery call

```js
// browser
const { kind, models, message } = await ctx.remote.llm.discoverModels("llm-pi-ai", {
  provider: "opencode-go-2",                       // route id (may be a draft, not yet stored)
  baseURL:  "https://opencode.ai/zen/go",          // required when the catalog does not ship the route
  api:      "anthropic-messages",                  // default "openai-completions"
  apiKey:   draftKey                               // optional; overrides the stored credential
});
// kind: "found" → LlmDiscoveredModel[]  |  "refused" → message (RemoteError llm/model-discovery-rejected)

// host (same semantics)
await ctx.llm.discoverModels("llm-pi-ai", request, abortSignal);
```

Do **not** use it as a universal key check: for `opencode-go` (catalog) it short-circuits with no network (`index.js:2386-2394`).

---

## 9. (v) Pitfalls

1. **`api`/`baseURL` on the catalog route is destructive.** `resolveRouteModels` applies a route `baseURL` to every model (`index.js:691`) and `buildProvider` rebuilds the provider on a single `api` (`:930-938`) — setting `baseURL: https://opencode.ai/zen/go/v1` on `opencode-go` sends the 5 Anthropic models to the wrong path. A management UI must not offer an endpoint field for `opencode-go`.
2. **`models` replaces, never extends** (`README.md:99`; `index.js:674-678`). A partial list silently removes models from the picker.
3. **Declared routes are free.** `cost: base?.cost ?? NO_COST` (`index.js:706`) — usage/pricing surfaces report 0 for every account-2 model.
4. **Declared routes lose conversation-update behavior.** `sessionAffinityFormat`, `supportsMidConvoSystemMessages`, `supportsMidConvoToolAdditions`, `supportsAdditionalTools` are *withheld* compat fields (`index.js:417-437`, refusal at `:541-547`), so `kimi-k3` loses mid-conversation system/tool updates, Responses models lose mid-convo messages/tools and session affinity, and long agent sessions behave differently from account 1.
5. **Reasoning must be declared or it is off** on a declared route (`index.js:587`), and the selectable levels are exactly the declared ones (`getSupportedThinkingLevels`, pi-ai `dist/models.js:679-689`) — declare fewer than the catalog and a session asking for the missing level throws `UNSUPPORTED_REASONING_EFFORT` (`index.js:1788`). With `agent-default-model.reasoningEffort: high` (`cordis.patch.yml:13`) that is a live hazard; note `kimi-k3` genuinely offers only `max`, so `high` fails there on the catalog route too.
6. **`modelOverrides` is refused on declared routes** (`index.js:665`) — no way to patch one model without restating all of them.
7. **A blank/absent key makes the route vanish from the picker** rather than show an error (`listModels` → `[]` at `index.js:1894`, empty groups filtered at `dsh-api-session-controller/lib/index.js:604`). Show "no credential" yourself from `credentials.describe`.
8. **`apiKeyEnv` is not a free-form string**: `credentialRef()` runs at config resolution (`index.js:1171`) and rejects anything outside `/^[A-Za-z_][A-Za-z0-9_]*$/`. Never hand-build `OPENCODE-GO-2_API_KEY`.
9. **Never let a route id start with a digit** — the derived ref fails the reference grammar (`client.js:1536-1543`).
10. **The Models page writes `cordis.patch.yml`, not a side store** (`dsh-config-editor/lib/index.js:23-25`). A management plugin and the UI edit the same document; always send `expectedRevision` and handle `settings/conflict` by re-reading, or you will silently revert a user's edit.
11. **A write validates the whole changed provider** (`assertServiceable`, `index.js:1092-1094`, wired at `:2885-2891`): you cannot rename an account while any of its models is unserviceable — repair the model in the same draft. Stored (unchanged) routes keep their diagnostics and do not block other routes.
12. **Two pi-ai entries cannot coexist**: `DUPLICATE_DIRECTORY` on the shared catalog (`dsh-llm/lib/index.js:1935`), `DUPLICATE_ADAPTER` on a shared route id (`:1872`); both registrations are all-or-nothing.
13. **No failover.** A `QUOTA`/`AUTH` failure on one route never retries on another; there is no rotation seam (§5b). A management plugin must implement switching itself (e.g. change the session's selected model/provider), and `QUOTA`/`AUTH` are not in the retryable set (`dsh-llm/lib/index.js:251-257`).
14. **Health checks are weak by design.** `listModels`/`resolveModelInfo` never probe (`index.js:1887-1910`); only a real request or `discoverModels` on a declared route does. And status codes are not available — codes come from message regexes (`index.js:1448-1458`).
15. **`headers` bypass the redactor** (`README.md:249`) — keep secrets in `apiKeyEnv` only.
16. **Keyless ≠ key-free:** pi-ai's OpenAI-compatible path still needs a key or an `Authorization` header (`README.md:254`), so never "simplify" a route by dropping `apiKeyEnv` without adding headers.
17. **`settings.mutate` path ops must stay under `providers`** — anything outside the `.volatile()` node is rejected (`dsh-settings/lib/index.js:153-158`, `:507`), and the error surfaces as `settings/rejected`.
18. **The page re-sends whole `models` arrays on any edit** (`client.js:1941`); a plugin that only wants to rename should send one key as in §8.3, otherwise it will rewrite 19-30 model entries per save.

---

## 10. Verification performed

1. Extracted `@earendil-works/pi-ai` and `js-yaml` from `app.asar` (read-only on DSH config; files added under `repos/dsh-provider-hub/asar\`).
2. Generated the three account-2 routes mechanically from `data/opencode-go.json` (`research/gen-account-routes.mjs`), then:
   - validated the object with the adapter's **own** `Config` schema (the package exports it: `index.js` tail → `export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols }`) — accepted all 3 routes;
   - asserted per-model **reasoning-level-set equality** against pi-ai's `getSupportedThinkingLevels` — `level-set mismatches: none` (30/30 models);
   - checked the credential grammars: `isCredentialKeySegment("opencode-go-2") === true`, `credentialRef("OPENCODE_GO_2_API_KEY")` OK, `credentialRef("opencode-go-2")` rejected.
3. Emitted `opencode-go-accounts.yaml`, re-parsed it with `js-yaml`, re-ran `Config(…)` on the parsed YAML, and deep-compared each generated model list (`research/verify-accounts-yaml.mjs`) — all three routes: `models match generated JSON = true`.

Artifacts in `C:\Users\Administrator\repos/dsh-provider-hub/research\`:

| File | What |
|---|---|
| `pi-ai.md` | this report |
| `opencode-go-accounts.yaml` | the complete `- id: llm-pi-ai` entry: current `opencode-go` + `opencode-go-2`, `-completions`, `-responses` |
| `gen-account-routes.mjs` | catalog → routes generator + schema/level assertions |
| `emit-accounts-yaml.mjs` | emits the YAML fragment from `account-routes.json` |
| `verify-accounts-yaml.mjs` | YAML re-parse + `Config()` + deep-equality check |
| `account-routes.json` | the validated route objects (machine-readable) |
