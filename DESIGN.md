# Design: dsh-provider-hub

Bundle: `dsh-provider-hub` — "模型提供商与账号 / Model Providers & Accounts".
Settings page in the Web client + Host reconciler + quota failover.

## Why this shape
- dsh already mounts `@deepseek-ai/dsh-llm-pi-ai` with the user's `opencode-go` route
  (`apiKeyEnv: OPENCODE_GO_API_KEY` + 30 models) in the profile patch.
- pi-ai resolves `apiKeyEnv` per request through the credential seam, so changing a route's
  `apiKeyEnv` changes the account used by the very next request. That is the multi-account lever:
  N stored credentials, one active per provider, instant switching, host-side auto-failover.
- State lives in the plugin's own volatile config (settings namespace `provider-accounts`),
  written by the page through `remote.settings.mutate`; the Host reconciles it into the
  `llm-pi-ai` entry through `ctx.configEditor.edit`.

## Host config (schemastery, volatile fields)
```js
providers: [{
  id, name, catalog:boolean,
  api?, baseURL?, models?:[{id,name,contextWindow,maxTokens,input}],
  accounts: [{ id, label, ref }],
  active: accountId
}]            // volatile
failover: { enabled:boolean, codes:[string], maxHops:number }   // volatile
```
Reconcile: for each provider with >=1 account, ensure `llm-pi-ai.providers[id]` exists and set
`apiKeyEnv` to the active account's ref (catalog providers only need apiKeyEnv; custom providers
also get api/baseURL/models). Preserve every other field already on the route.
Deleted providers are forgotten, their route and credentials are left untouched.

## Client page
`settings.section` registration id `provider-accounts`, order 20, label from locale.
Reads: `remote.settings.describe()` (own namespace + `llm-pi-ai` for import), `remote.credentials.describe`,
`remote.llm.listConfigurableProviders()` / `discoverModels`. Writes: `remote.settings.mutate`,
`remote.credentials.set/unset`. Refreshes on `settings/document-updated`,
`credentials/reference-updated`, `llm/adapters-updated`, `connection/reset`.

Actions: add provider (catalog preset list or custom endpoint w/ discovery), add account (label+key),
activate, edit label/replace key, delete account (+ optional credential), delete provider,
test connection, import existing pi-ai routes when the list is empty, failover toggle.

## Verification
- `Config.listConfigs` shows the entry; `Slots.listSubTree root=settings.section` shows the page.
- Profile `cordis.patch.yml` gains `llm-pi-ai` config whose active route `apiKeyEnv` equals the
  active account ref after an activation.
