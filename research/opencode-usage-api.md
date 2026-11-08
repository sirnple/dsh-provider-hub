# OpenCode Go — usage / quota / balance API

Probed: 2026-10-20 (Asia/Shanghai), against `opencode.ai` with a real stored key.
Verdict: **endpoint exists** — both provider-reported usage percentages and provider-reported dollar meters/balance are readable with an API key. This is not dashboard-only and does not require HTML scraping.

## Short answer

| Need | Endpoint | Auth | Provider-reported? |
|---|---|---|---|
| 5-hour / weekly / monthly usage % + reset time | `GET https://opencode.ai/zen/go/v1/usage` | `Authorization: Bearer <key>` | Yes |
| Exact used/limit dollars for the same windows | `GET https://opencode.ai/console/api/go/status` | `Authorization: Bearer <key>` | Yes |
| Prepaid Zen balance / credits | `GET https://opencode.ai/console/api/billing/status` | `Authorization: Bearer <key>` | Yes |
| Spend / token totals | `GET https://opencode.ai/console/api/usage/summary?range=30d` | `Authorization: Bearer <key>` | Yes, workspace-wide |

`/zen/go/v1/usage` is the purpose-built, API-key-scoped endpoint. The three `console/api/*` endpoints are the Console web app's internal JSON API: they are undocumented publicly, but they returned 200 with the same Bearer key and are the only source of exact dollar amounts and balance. Treat them as optional enrichment, not as a guaranteed public contract; they are the only exact-dollar source found in this probe.

There is **no** `/zen/go/v1/balance`, `/credits`, `/subscription`, `/limits`, `/me`, and **no** `/zen/v1/usage`. No balance is returned by `/zen/go/v1/usage`.

## Auth and control probes

The working key is the one stored under `OPENCODE_GO_API_KEY_1` (51 chars, `oc_sk_` service-account key). The other stored keys returned 401 and 403, so key selection matters.

| Probe | Auth | Status | Result |
|---|---|---|---|
| `GET /zen/go/v1/usage` | `Authorization: Bearer` | **200** | JSON usage, see below |
| `GET /zen/go/v1/usage` | `x-api-key` only | 401 | `AuthError` / `Unauthorized` |
| `GET /zen/go/v1/usage` | none | 401 | `AuthError` / `Unauthorized` |
| `GET /zen/go/v1/usage` | Bearer, non-Go key | 403 | `EntitlementError` / `OpenCode Go subscription required.` |
| `GET /zen/go/v1/models` | Bearer | 200 | control: auth works, model list returned |
| `GET /zen/v1/models` | Bearer | 200 | Go key also works on the Zen endpoint |
| `GET /zen/v1/usage` | Bearer | 404 | no Zen PAYG usage endpoint |
| `GET /zen/go/v1/me`, `/balance`, `/credits`, `/subscription`, `/limits` | Bearer | 404 | no such routes |
| `GET /zen/v1/me`, `/balance`, `/credits`, `/subscription` | Bearer | 404 | no such routes |
| `GET /api/zen/usage`, `/api/usage` | Bearer | 404 | HTML app shell, not an API |
| `GET https://api.opencode.ai/v1/usage` | Bearer | 200 | `text/plain` body `Not Found`; not a real API |
| `GET /console/api/go/status` | Bearer | 200 | Go meters; body is `null` when no Go subscription |
| `GET /console/api/billing/status` | Bearer | 200 | balance JSON |
| `GET /console/api/usage/summary?range=30d` | Bearer | 200 | spend/tokens JSON |
| `GET /console/api/orgs` | Bearer | 401 | not usable with this service key; `/orgs/current` works |
| `GET /console/api/orgs/current` | Bearer | 200 | workspace info, `hasGoSubscription: true` |

Notes:
- `x-api-key` is the auth style used by Anthropic-style **inference** in the catalog, but it is not accepted by the usage endpoint. Use `Authorization: Bearer` for usage and Console API.
- The current proxy extracts the key with `authorization.split(" ")[1]`, so the scheme is not strictly enforced (a `Basic` test also returned 200). Always send `Bearer`.
- No `x-org-id` was needed for `go/status` / `billing/status` with this workspace-bound key. Cookie-based clients may still need it.
- `GET /console/api/v2/config` is the documented Console API entry point; the usage/balance routes are not in the public docs.

## Primary usage endpoint

Request:

```http
GET https://opencode.ai/zen/go/v1/usage HTTP/1.1
Authorization: Bearer <OPENCODE_GO_API_KEY>
Accept: application/json
```

Live 200 response (238 bytes, `Content-Type: application/json`, `Cache-Control: no-store`):

```json
{
  "usage": {
    "rolling": {
      "status": "ok",
      "percent": 0,
      "resetsAt": "2026-10-19T22:41:32.000Z"
    },
    "weekly": {
      "status": "ok",
      "percent": 0,
      "resetsAt": "2026-10-26T00:00:00.000Z"
    },
    "monthly": {
      "status": "ok",
      "percent": 0,
      "resetsAt": "2026-11-19T17:36:16.000Z"
    }
  }
}
```

Field semantics:
- `rolling` = 5-hour window; `weekly` = week; `monthly` = subscription period.
- `percent` is **0…100**, not a 0…1 fraction. `11` means 11%.
- `status` is `"ok"` or `"rate-limited"` (client code uses these two values).
- `resetsAt` is an ISO-8601 UTC timestamp. `Date.parse()` it; do not assume a fixed offset.
- The response has no plan name, no dollar amounts, no `used`/`limit`, and no balance. A tiny usage can round to `0`, as it did here: `405` micro-cents of a `1200000000` micro-cent five-hour limit = 0.00003375%, so the integer/fractional percent rendered as 0.
- The rolling `resetsAt` is the current 5-hour window's end. After this account's first inference, the Console meter showed `startsAt` at that request and `resetsAt` five hours later. Before any usage, the usage endpoint reported `now + 5h`, so treat an empty-account countdown as approximate. Weekly resets Monday 00:00Z; monthly resets at the subscription period end.

Error bodies:
```json
{"type":"error","error":{"type":"AuthError","message":"Unauthorized"}}
```
```json
{"type":"error","error":{"type":"EntitlementError","message":"OpenCode Go subscription required."}}
```

## Exact dollar meters (Console API)

This is the provider's own accounting, in micro-cents. `microCents / 100000000 = USD`.

Request:

```http
GET https://opencode.ai/console/api/go/status HTTP/1.1
Authorization: Bearer <OPENCODE_GO_API_KEY>
Accept: application/json
```

Sanitized live 200 shape (identifiers/payment fields removed):

```json
{
  "product": "go",
  "renewalProduct": "go",
  "renewalCurrency": "usd",
  "useBalance": false,
  "cancelAtPeriodEnd": false,
  "resumability": "renewing",
  "renewalPending": false,
  "nextPeriodPaid": false,
  "access": {
    "startsAt": "2026-10-19T17:36:16Z",
    "endsAt": "2026-11-19T17:36:16Z",
    "cancelAtPeriodEnd": false,
    "meters": {
      "fiveHour": {
        "startsAt": "2026-10-19T17:41:32Z",
        "resetsAt": "2026-10-19T22:41:32Z",
        "limitMicroCents": "1200000000",
        "usedMicroCents": "405"
      },
      "week": {
        "startsAt": "2026-10-19T00:00:00Z",
        "resetsAt": "2026-10-26T00:00:00Z",
        "limitMicroCents": "3000000000",
        "usedMicroCents": "405"
      },
      "month": {
        "resetsAt": "2026-11-19T17:36:16Z",
        "limitMicroCents": "6000000000",
        "usedMicroCents": "405"
      }
    }
  },
  "upgradePrice": {
    "amountMicroCents": "3000000000",
    "currency": "usd"
  }
}
```

Interpretation:
- `1_200_000_000` / `1e8` = **$12.00** five-hour limit; `3_000_000_000` = **$30.00** weekly; `6_000_000_000` = **$60.00** monthly. These match the Go plan's 20% / 50% / 100% allocation in the docs. Do not hard-code them; read the limits, since Go Plus/plan changes alter them.
- `usedMicroCents` is a decimal string. `405` = `$0.00000405`.
- `access` may be `null` for a Go key with no subscription; the entire body also came back as JSON `null` for a non-Go key. Guard `if (!body || !body.access) { no subscription }`.
- `useBalance` indicates whether Go falls back to Console balance after the included limit.

Balance request:

```http
GET https://opencode.ai/console/api/billing/status HTTP/1.1
Authorization: Bearer <OPENCODE_GO_API_KEY>
Accept: application/json
```

Live 200 shape:

```json
{
  "billingMode": "prepaid",
  "mode": "pay-as-you-go",
  "balanceMicroCents": "<signed integer string>",
  "creditLimitMicroCents": null,
  "availableMicroCents": "<integer string>",
  "canPurchaseCredits": true,
  "canEnableAutoRecharge": true
}
```

- USD balance = `Number(balanceMicroCents) / 100000000`.
- `balanceMicroCents` can be negative; parse as a signed integer, not unsigned.
- `availableMicroCents` is a separate credit/available figure; do not substitute it for `balanceMicroCents`.
- `mode` was `"pay-as-you-go"` for this key even though the workspace also has Go; treat it as the workspace billing mode, not the Go plan name.

Spend/token summary:

```http
GET https://opencode.ai/console/api/usage/summary?range=30d HTTP/1.1
Authorization: Bearer <OPENCODE_GO_API_KEY>
```

Shape:

```json
{
  "totalRequests": "373",
  "totalInputTokens": "1426532",
  "totalOutputTokens": "3813043",
  "totalCacheReadTokens": "361796",
  "totalCacheWrite5mTokens": "0",
  "totalCacheWrite1hTokens": "0",
  "totalCostMicroCents": "<integer string>",
  "services": []
}
```

- `totalCostMicroCents / 1e8` = USD.
- `range=7d` and `range=30d` worked; `range=90d` returned 400 in this probe.
- This is **workspace-wide**, not Go-only; do not use it as a Go-quota value.

## What the official CLI/TUI shows

- The Go docs say to "track your current usage in the [console](https://opencode.ai/console)" and define limits as monthly dollar amounts with 5-hour = 20%, weekly = 50%, monthly = 100%. They do **not** document a usage API.
- The current `dev` TUI footer/session UI shows context/token counts and per-session cost, not Go subscription windows. `packages/tui` has no Go-quota reader.
- `opencode stats` shows local, shareable session statistics (`--days`, `--models`, `--cost`, `--json`); it is local accounting, not provider quota.
- An `opencode usage` command was proposed in [PR #32913](https://github.com/anomalyco/opencode/pull/32913), calling this endpoint and rendering progress bars, but the PR is **closed, not merged**. Current `dev` has no `usage` command.
- The endpoint itself was added in [PR #16513](https://github.com/anomalyco/opencode/pull/16513) (merged 2026-08-11); current `dev` implements it as a proxy to the new inference backend: [`usage.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/go/v1/usage.ts) and [`inference-proxy.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/lib/inference-proxy.ts#L14).
- The Console dashboard is therefore the official human-facing view. The same data is available from the JSON endpoints above; a desktop app does not need to scrape HTML.

## Inference response headers

One minimal request was made to confirm whether a real inference response carries quota headers:

```http
POST https://opencode.ai/zen/go/v1/chat/completions
Authorization: Bearer <key>
Content-Type: application/json

{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"Say hi"}],"max_tokens":1,"stream":false}
```

Result: HTTP 200, `usage` = 32 prompt + 1 completion = 33 tokens, finish reason `length`.
Response headers: `Content-Type: application/json`, `CF-RAY`, and `x-opencode-log-id` only.

**No `x-ratelimit-*`, no `anthropic-ratelimit-*`, no quota/balance header.** Quota must be read from the separate usage endpoints. (The usage endpoint itself returned `Cache-Control: no-store` and no rate-limit headers.)

## Recommended polling contract

### Minimum viable: percentages only

```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OPENCODE_GO_API_KEY>
Accept: application/json
```

- Poll when the panel is visible: every 60 s is plenty; back off to 5 min in the background. Add jitter.
- On 200, parse `usage.rolling|weekly|monthly`:
  - label `rolling` as “5-hour”, `weekly` as “This week”, `monthly` as “This month”.
  - render `percent` directly as used %, or `100 - percent` as remaining.
  - show `resetsAt` as a localized countdown.
  - if `status === "rate-limited"`, show a hard warning.
- On 401: invalid/revoked key → show “reconnect”.
- On 403 with `EntitlementError`: valid key, no Go subscription → hide the panel.
- On 404/5xx: endpoint changed/outage → hide the provider numbers; do not invent them.
- Treat fields as optional: older/newer responses may omit `weekly` or add fields. Do not crash on missing windows.

### Enrichment: exact dollars + balance

Call these after (or in parallel with) the usage call, but keep them optional:

```http
GET https://opencode.ai/console/api/go/status
Authorization: Bearer <OPENCODE_GO_API_KEY>
Accept: application/json
```

- If body is `null` or `access` is absent/null → no Go subscription; do not show dollar meters.
- For each of `access.meters.fiveHour|week|month`:
  - `usedUsd = Number(usedMicroCents) / 1e8`
  - `limitUsd = Number(limitMicroCents) / 1e8`
  - `percent = 100 * usedUsd / limitUsd` (guard `limitUsd > 0`)
  - `resetAt = resetsAt ?? access.endsAt` (month omits `startsAt`; use the meter's `resetsAt` when present).
- Prefer these dollars for a “$ used / $ limit” line; keep the percent endpoint for the headline percentage.

```http
GET https://opencode.ai/console/api/billing/status
Authorization: Bearer <OPENCODE_GO_API_KEY>
```

- `balanceUsd = Number(balanceMicroCents) / 1e8`.
- Show `availableMicroCents` only if the UI distinguishes “balance” from “available credit”; otherwise label it explicitly.
- `billingMode`/`mode` are informational. A Go subscription can still have a PAYG fallback balance.
- `billing/status` also returned 200 for a key without a Go subscription, so it is not Go-gated; only `go/status` is Go-specific.

### Fallback behavior

| Condition | UI behavior |
|---|---|
| `/zen/go/v1/usage` 200 | Show provider percentages; mark as authoritative |
| `/zen/go/v1/usage` 403 `EntitlementError` | No Go plan; hide quota panel |
| `/zen/go/v1/usage` 401 | Key invalid/revoked; prompt reconnect |
| `console/api/go/status` 200 with `access` | Show exact $ meters |
| `console/api/go/status` 200 `null` | No Go plan; keep percentage panel hidden |
| `console/api/*` 401/403/404/5xx | Hide $ meters/balance only; keep percentages; optionally label “estimated/local” |
| All remote calls fail | Fall back to locally-accounted token usage, clearly labeled as local |

Do not treat Console API failure as a key failure: an “Inference only” service-account key can legitimately get 403 from Console endpoints while `/zen/go/v1/usage` still works. The tested `oc_sk_` key had Console access; a different key may not.

## Caveats

1. `console/api/go/status`, `billing/status`, and `usage/summary` are **undocumented internal Console APIs**. They work today with a Bearer service-account key, but can change without notice. Keep them behind a capability flag and a fallback.
2. The public docs describe dollar limits per model, but the usage endpoint reports only percentages. The `go/status` meters are the only exact dollar accounting found.
3. `percent` can be `0` while a tiny charge exists. Do not conclude “no usage” from `0%` alone if you also show the dollar meter.
4. All monetary values are strings. Parse with `Number`/`BigInt` deliberately; `balanceMicroCents` is signed.
5. The old `/zen` paths and the new `/inference` paths both worked (`/inference/go/v1/usage` returned the same 200 body). The catalog uses `https://opencode.ai/zen/go`; that is the safe base for this app.

## Sources

- Official Go docs: https://opencode.ai/v2/docs/console/go — limits, console tracking, endpoints.
- Official Console API docs: https://opencode.ai/v2/docs/console/api — service-account Bearer keys, `/api/v2/config`, but no usage/balance route.
- Endpoint route in `anomalyco/opencode` `dev`:
  - https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/go/v1/usage.ts
  - https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/lib/inference-proxy.ts#L14
- Endpoint introduced in PR #16513: https://github.com/anomalyco/opencode/pull/16513
- Proposed `opencode usage` CLI in PR #32913 (closed, unmerged): https://github.com/anomalyco/opencode/pull/32913
- Independent client notes confirming the same endpoint and shape:
  - https://github.com/steipete/CodexBar/blob/master/docs/opencode.md
  - https://cdn.jsdelivr.net/npm/pi-opencodego@0.1.5/docs/OPENCODE-API.md
  - https://github.com/Hanfei1224/OpenCodeMonitor/blob/main/docs/adr/0001-use-official-usage-api.md
- Raycast extension PR replacing HTML scraping with the Zen usage API: https://github.com/raycast/extensions/pull/30849
