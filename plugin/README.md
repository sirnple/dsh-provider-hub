# dsh-provider-accounts · 模型提供商与账号

A DeepSeek Harness bundle that adds two pages to Settings:

- **模型提供商与账号 / Model providers** — onboard third-party model providers and keep several
  API-key accounts for one provider, switch the account a request uses, and fail over automatically
  when an account cannot serve a request.
- **用量与余额 / Usage & balance** — per-account token/request accounting from the harness itself,
  plus provider-reported quota percentages, spend meters and prepaid balance where the provider
  exposes them (OpenCode Go/Zen, DeepSeek, OpenRouter).

## 模型提供商与账号

- **接入第三方提供商** — onboard any provider the installed pi-ai catalog ships (OpenCode Go,
  OpenAI, Anthropic, DeepSeek, OpenRouter, Z.AI, Kimi, Qwen, MiniMax, …) with just an API key, or
  declare any OpenAI- or Anthropic-compatible endpoint with a discovered model list.
- **多账号** — store any number of named accounts per provider. Every account owns its own
  credential reference, so its key lives in the harness credential store rather than in
  `cordis.patch.yml`. Extra accounts get unique references (`OPENCODE_GO_2_API_KEY`, …) so two
  accounts can never read the same stored key.
- **真实密钥校验** — **测试** verifies the account's stored key against the provider with a real
  request, because catalogue-backed discovery answers from installed metadata without any network
  call and therefore cannot tell a good key from a rejected one. A provider with no probe (for
  example a hand-declared gateway) is labelled *(catalogue models only, key not verified)* instead
  of claiming success; a rejected key shows the provider's own message.
- **切换账号** — one provider route, several accounts. Every provider card carries a **account
  switcher** (one pill per account, the current one highlighted, plus "takes effect on the next
  model request"), and every account row also offers **使用**. A switch writes the route's single
  `apiKeyEnv` field, and pi-ai resolves that reference per request, so the next request uses the
  new account with no restart. A successful switch is reported by name, and the usage page shows an
  **auto-skipped** counter on accounts the failover has moved away from.
- **自动切换 (failover)** — when a request dies before producing content because the account cannot
  serve it (`QUOTA`, `AUTH`, `INVALID_CREDENTIAL`, `MISSING_CREDENTIAL`), the Host switches to the
  next untried account and re-issues the call, up to `maxHops` times. `RATE_LIMIT` is left to the
  retry middleware, which waits instead of burning another account.
- **路由修复 / self-healing** — the page owns the provider list, so the routes it names must exist.
  On activation, on our own config change and on every `llm/adapters-updated` event the Host
  reconciles: a provider with accounts whose `llm-pi-ai` route is missing is created (catalog route
  from the account's reference, custom route with its endpoint fields), a keyless route is pointed
  at an account, and a route whose reference no longer resolves is repointed. A healthy route is
  never touched, the provider's display name is filled in when absent (so the model picker names the
  group), and the last served reference is remembered so a repair keeps the account you chose. The
  page also offers **创建路由** as a manual action, and deleting a provider removes the page entry
  **before** the route so a refused write can never leave "route gone, provider still listed".

### 账号与模型选择器的关系

The model picker lists **pi-ai routes**, not accounts: one provider route is one group of models
(`opencode-go` → its catalog models). Account switching is a separate action: **使用** on the
**模型提供商与账号** page repoints the route's `apiKeyEnv`, and automatic failover does the same when
a request hits a quota/credential failure. If you want every account to appear separately in the
picker, that needs one route per account — and because `opencode-go` speaks three protocols
(anthropic-messages, openai-completions, openai-responses), each account would become three declared
routes that lose catalog metadata, reasoning levels and pricing.

## 用量与余额

The usage surface lives in the **conversation header**, not in Settings: a compact pill at the
top-right of the chat header (slot `conversation.session.header.utilities`) that opens the full
panel in a portal — no navigation away from the conversation.

The collapsed pill is **purely graphical**: three stacked mini bars (one per quota window, each toned
by its own state) and the expand caret — no percentage and no balance text, so a crowded header never
overflows and nothing competes with the conversation title. The numbers stay available on demand: the
pill's tooltip and accessible label carry every window, and opening it shows the full per-account
panel. Providers without quota windows (DeepSeek) contribute no bars; their balances appear in the
popover.

The pill refreshes itself every 30 s while the chat is visible; a usage read older than five minutes
also makes the Host probe the provider consoles again in the background, so the numbers do not go
stale between manual refreshes.

All numbers come from this Host process, so they work without reading any provider dashboard HTML.
The panel is deliberately **compressed**: one row per account, quotas as bars, usage as one line.

Each account row is:

- **visibility** — the account label, a `当前` badge, and that account's prepaid chip;
- **quota** — three inline meters (`5h` / `wk` / `mo` or the localized short tags), each a filled bar
  toned green → amber → red with its percentage (`role="progressbar"` + `aria-valuenow`); the bar's
  `aria-valuetext`/tooltip carries `$used / $limit` and the reset time, so the dollars do not
  occupy a row;
- **usage** — one line: `Today 12.3K · 12 req · 1 fail`, followed by a 14-bar sparkline of the
  account's daily tokens; a last error stays one muted line.

A provider that reports no ratio (DeepSeek) shows its balance fields as chips in the same row
instead of bars. There is no summary card, no stacked bar, and no large chart — those were the bulk
of the previous page.

- **本地用量台账** — every model attempt on a managed route is attributed to the account the route
  resolved at that moment: requests, failures, input/output/cache/reasoning tokens, last-used time,
  last error code, and per-day buckets (retained 90 days). Persisted to
  `$DSH_HOME/storages/provider-accounts/usage.json`; nothing is written into configuration.
- **提供商侧配额/余额** — probed **per account** with that account's own stored key (write-only,
  never rendered):

  | Provider | Probe | What the account row draws |
  |---|---|---|
  | OpenCode Go / Zen | `GET https://opencode.ai/zen/go/v1/usage` (+ optional `console/api/billing/status`, `console/api/go/status`) | 5-hour / weekly / monthly **usage bars** with reset countdowns, `rate-limited` state, the account's prepaid **balance chip**, and spend meters from the console (`used / limit` under each bar) |
  | DeepSeek | `GET https://api.deepseek.com/user/balance` | the account's balance chips (total / granted / topped-up) |
  | OpenRouter | `GET https://openrouter.ai/api/v1/credits` | one **credits bar** (`used / purchased`) plus limit/used/remaining chips |
  | xAI | `GET https://api.x.ai/v1/api-key` (key check only) | no quota API exists — the block shows a **No quota API** chip, the key's `active` status, its name and creation time, and the local usage line |

  The `console/api/*` calls are undocumented enrichment: they are tried separately and their
  failure never hides the official usage percentages. A refused probe is recorded for that account
  alone and rendered as a warning inside its own row (for example an account with a valid key but no
- The ledger is read on open and then every 15 s while the panel is open (the pill every 30 s), paused
while the tab is hidden. **刷新余额** is the only manual action: it re-probes every configured account,
because it costs upstream calls.

### Read API the pill uses

Both endpoints are exact Fetch routes on the authenticated `/api` bridge, so the browser calls them
with a plain same-origin `fetch` and no Remote contribution of its own:

| Route | Purpose |
|---|---|
| `GET /api/provider-accounts-usage` | the whole snapshot (providers, accounts, balances, `updatedAt`) |
| `POST /api/provider-accounts-balance` | re-probe balances, then answer with the same snapshot |
| `POST /api/provider-accounts-test` | verify one account's stored key against its provider (`{ providerId, ref? }`) and answer `{ supported, ok, error? }` |

## Grok Build (native OAuth)

A SuperGrok / Grok Build subscription authenticates with **OAuth**, not API credits, so an `xai-…`
API key cannot use it. This plugin therefore implements the flow itself — no gateway, no external
service, only requests to x.ai:

- **Device OAuth** with the official CLI client (`b1a00492-073a-47ea-816f-4c329264a828`,
  `https://auth.x.ai/oauth2/device/code` → `https://auth.x.ai/oauth2/token`), including
  `authorization_pending` / `slow_down` handling and refresh-token rotation.
- **Token storage** as a write-only credential bundle under `GROK_BUILD_OAUTH`; the access token is
  refreshed automatically when it is within a minute of expiry.
- **Upstream**: `https://cli-chat-proxy.grok.com/v1` with the CLI identity headers
  (`x-xai-token-auth: xai-grok-cli`, `x-grok-client-version: 1.0.60`,
  `x-grok-client-identifier: grok-shell`, `x-grok-client-mode: headless`,
  `user-agent: grok-shell/1.0.60 (linux; x86_64)`).
- **Protocol**: `POST /responses` (Responses API, SSE) translated into harness chunks — text,
  reasoning summaries, function calls, usage and finish reasons; `GET /models` fills the picker;
  `GET /billing?format=credits` drives the quota meter.
- **Registration**: the plugin registers its own adapter for the `grok-build` route, so no
  `llm-pi-ai` entry is written for it and the reconciliation step skips that provider.

### Steps

Grok Build is an ordinary catalog preset, listed next to xAI — the only difference is that its
credential is a sign-in instead of a key:

1. **Model providers and accounts → Add provider → From the catalog → Grok Build (OAuth)**.
2. The form asks for no API key; press **Sign in**, open the shown link, enter the device code.
   The dialog polls until the token lands, then **Add provider** becomes usable.
3. On the saved account row: the sign-in identity, the monthly quota meter and **Sign in again** /
   **Test** / **Sign out**, in the same place every other provider keeps its per-account detail.
4. Its models appear in the picker under the `grok-build` route the plugin's adapter serves.

### Deferred in this version

Prompt-cache/session affinity (`x-grok-session-id`, `prompt_cache_key`), reasoning replay,
gateway compaction and video generation are not implemented; requests are stateless, so cache hits
are lower than the official CLI's. Multi-account is one bundle per harness profile.

## Where things live

| Thing | Location |
|---|---|
| Provider / account list | settings namespace `provider-accounts` → a row in `profiles/<name>/cordis.patch.yml` |
| Provider routes | the existing `llm-pi-ai` entry → `providers.<route>` |
| API keys | `~/.dsh/.credentials.yaml`, under each account's `ref` name |
| Usage ledger | `~/.dsh/storages/provider-accounts/usage.json` |

```yaml
- id: provider-accounts
  name: dsh-provider-accounts
  config:
    providers:
      - id: opencode-go          # pi-ai route id; also the route written to llm-pi-ai
        name: OpenCode Go
        catalog: true            # installed catalog provider: only apiKeyEnv is written
        balanceKind: opencode-zen # '' or a known probe; inferred from the route id when omitted
        accounts:
          - { id: opencode-go-a1, label: 主账号, ref: OPENCODE_GO_API_KEY }
          - { id: opencode-go-a2, label: 工作账号, ref: OPENCODE_GO_2_API_KEY }
    failover:
      enabled: true
      codes: [QUOTA, AUTH, INVALID_CREDENTIAL, MISSING_CREDENTIAL]
      maxHops: 2
```

`catalog: false` entries also carry `api`, `baseURL` and `models`, and their route is created with
those fields. Everything above is editable from the pages; the YAML is what they write.

## How a request picks an account

1. The page writes `providers.<route>.apiKeyEnv = <account ref>` in the `llm-pi-ai` namespace.
2. pi-ai resolves that reference through the credential seam once per stream operation, so no key
   ever enters configuration.
3. On a fatal account failure before any content chunk, the Host rewrites the same field to the
   next account and retries once per remaining account (bounded by `failover.maxHops`).
4. The inner accounting listener records the attempt against the reference that attempt resolved,
   so a failed-and-retried call is attributed correctly to both accounts.

Every listener is a pass-through for routes this bundle does not manage, and nothing internal is
allowed to throw into the model pipeline.

## Limits (by design)

- **One active account per provider at a time.** pi-ai takes one credential reference per route and
  the credential seam receives no session context, so two sessions cannot use two accounts of the
  same provider simultaneously. Route-per-account (supported by the Models page) is the workaround,
  at the cost of losing catalog model metadata, reasoning levels and pricing.
- **Local usage starts when the plugin does.** Requests made before installation are not
  reconstructed from history.
- **Balance probes are best-effort.** Provider consoles change without notice; a failed probe is a
  warning line, never an error page. Deleted providers keep their historical ledger rows.
- **No spend estimates.** The harness records tokens, not money; provider-reported dollar figures
  are shown only when the provider supplies them.

## Verification

- `node --check index.js` / `client.js`.
- Host harness (`scratch/usage-test.mjs`): 8 scenarios over the real `apply()` — accounting,
  failure codes, unmanaged-route isolation, persistence + reload, both Fetch routes, the OpenCode
  adapter against a stubbed console (including the structured gauges: percent per window, USD
  used/limit, reset times, `rate-limited` status), and a refused probe recorded instead of thrown.
- Host failover harness (`scratch/failover-test.mjs`): 18 scenarios (pass-through identity, quota
  switch A→B, no retry after content, hop budget, exhausted accounts, disabled toggle, unlisted
  codes, abort, edit failure, live toggle).
- Host route-repair harness (`scratch/reconcile-test.mjs`): 8 scenarios over the real `apply()` —
  missing route recreated with the healthy account, keyless route pointed, unresolved reference
  repointed, healthy route untouched, nameless route labelled once, account-less provider skipped,
  custom route materialized with api/endpoint/models, and a route deleted later repaired on the
  `llm/adapters-updated` signal.
- Browser harnesses: SSR render; jsdom mount + real button clicks for the providers page;
  reference-uniqueness; full flow set (import, catalog add, custom endpoint + discovery, account
  add/edit/delete, route recreation, delete provider, conflict, read-only); and the usage-pill
  harness (registration shape — header utility, not a settings section; the pill's expanded state and
  portal; the compact popover's provider blocks and account rows; three `role="progressbar"` meters
  with `aria-valuenow`/tone/dollars/reset tooltip; the one-line usage text; the 14-bar sparkline;
  balance-only chip fallback; empty/404/non-JSON/network states; refresh and balance POST; polling,
  visibility and unmount cleanup; and a Chinese render pass). A cross-check harness feeds the real
  Host snapshot into the panel.
- Live install: the Host row activates, `provider-accounts` appears as a settings namespace, the
  providers page registers in `settings.section`, the usage pill registers in the conversation
  header, and settings writes land in the profile patch.

## Layout

```
package.json         bundle manifest (dsh.bundle.patch + dsh.client)
cordis.patch.yml     inserts the single Host row
index.js             Host half: Config schema, page policy opt-out, failover, usage ledger,
                     balance adapters, two exact Fetch routes
client.js            browser half: both Settings pages (plain JS + React from the module table)
locale/en.json       display metadata (title/description) for Plugin Manager and Settings
locale/zh.json
icon.svg             original artwork, distributed under the same license as this bundle
```

## License

MIT. `icon.svg` is original artwork created for this bundle.
