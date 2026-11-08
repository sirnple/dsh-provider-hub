# DSH browser-plugin (Client) framework — adding a page to the Settings panel

Research target: a **locally authored bundle** whose browser half is a plain-JS
`window.__ModuleLoader__.load({ id, factory(require) {...} })` module that registers one
`settings.section` page. All findings below were read out of the installed 0.2.1-rc.2 packages
under `C:\Users\Administrator\repos/dsh-provider-accounts/asar\dsh\node_modules\@deepseek-ai\` (abbreviated
`$PKG` in citations) plus the built Web shell
`$PKG\dsh-web-frontend\dist\assets\index-CN7NIWNw.js` (one minified line; cited by **byte
offset**, `@off`). Read-only investigation: nothing was installed, enabled, or edited.

Verified environment facts used here: no live page was attached during this research, so the
Client Inspect providers (`Slots`, `Theme`) timed out (`Client inspect query … timed out after
10000ms`) and the running GUI answers **401** to `/`, `/index.html`, `/api/*` (see §7). Every
statement below therefore comes from shipped code, not from a live probe.

---

## 0. The one-page answer

| Question | Answer |
|---|---|
| Slot to register | `settings.section`, kind **list**, scope `root` |
| Registration object | `{ name:'settings.section', id, order, label: () => t('nav'), locale?, inject?, children? }` |
| Component props (owner) | `{ close: () => void }` — nothing else comes from the shell |
| Other props you get | standard hooks + `renderSlot` (only if you declare `children`) + `t` (if `locale` set) + your `inject` face |
| Nav row | built from `id` / `order` / `label`; nav glyph falls back to a gear for unknown ids |
| To land Settings on your page | lowest `order` (shell selects `rows[0]` when nothing is selected) |
| Data | `ctx.remote.settings.describe()` / `.replace()` / `.update()` / `.mutate()` (or `ctx.configForms`) |
| Updates | `ctx.remote.$on('settings/document-updated', …)` |
| Locale | `ctx.locale.register(ns, {zh, en})` + `ctx.locale.bind(ns)`; `locale: NS` supplies prop `t` |
| Styling | `--dsw-alias-*` + `--dsw-radius-*` + `--dsw-focus-ring-*`; **no spacing tokens** |
| Controls | hand-copy the models/general CSS (buttons, input, dot, tag, card); primitives exist but are forbidden by the authoring rules |

---

## 1. How `settings.section` is registered

### 1.1 The slot contract (authoritative catalog)

The Client runtime ships a slot catalog that the `cordis_inspect` Client `Slots` provider serves.
For `settings.section` (`$PKG\dsh-cordis-client-runner\lib\client.js:5291-5343`):

```js
key: "settings.section",
kind: "list",
scope: "root",
summary: "One settings page per list entry.",
registerOptions: [
  { name: "id",    requirement: "required", type: "string" },
  { name: "order", requirement: "optional", type: "number" },
  { name: "label", requirement: "optional", type: "string | (() => string)" },
],
ownerProps: ["export interface SettingsSectionOwnerProps {\n  /** Close the settings panel (the shell owns the open state). */\n  close: () => void\n}"],
standardProps: [
  "useRemoteAccess: (action: RemoteEndpoint) => boolean",
  "useResource: UseResource",
  "useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>",
  "usePanelInfo: UsePanelInfo",
  "useSessions: UseSessions",
  "useSessionStatus: UseSessionStatus",
  "useSessionRetainInfo: UseSessionRetainInfo",
  "useSessionAccess: (sessionId: SessionId, action: RemoteEndpoint) => boolean",
  "useWorkspaceAccess: (workspaceId: WorkspaceId, action: RemoteEndpoint) => boolean"
],
declaredBy: "an entry in 'sidebar.settings' (client-ui-settings-general), so it exists while that entry is mounted",
occupants: [
  "client-ui-agent-preset AgentPresetSection id 'agent-presets'",
  "client-ui-settings-account AccountSection id 'account'",
  "client-ui-settings-general GeneralSection id 'general'",
  "client-ui-settings-models ModelsSection id 'models'",
  "client-ui-settings-plugins PluginsSettingsSection id 'plugins'"
],
example: "return {\n  inject: ['slots'],\n  apply(ctx) {\n    ctx.slots.inject('settings.section', () => ctx.slots.register(\n      { name: 'settings.section', id: 'my-entry', order: 100, label: 'My entry' },\n      () => React.createElement('div', null, 'hello'),\n    ))\n  },\n}"
```

`label` is projected through `resolveSlotLabel` = `typeof v === 'function' ? v() : v`
(`index-CN7NIWNw.js@494146` exports it; the catalog example at `:5342` shows a plain string is
also legal).

Supporting types (`$PKG\dsh-cordis-client-runner\lib\client.js`):

* `SlotComponent<P> = (props: P) => ReactNode` — `:2221-2222` (function components only).
* `SlotKind = 'single' | 'list' | 'keyed' | 'chain'` — `:2245-2246`.
* `SlotLabel = string | (() => string)` — `:2249-2250`.
* `SlotInjectFace<I> = I extends { hooks } ? Omit<I,'hooks'> & PropsSlotHooks<HS> : I` — `:2237-2238`
  (this is why `hooks.snapshot` becomes prop `useSnapshot`).
* `PropsRuntime = OwnerOf<K> & KeyPropsOf & SlotInjectFace & ScopeStandardProps` — `:2269-2270`.

### 1.2 The three shipped registration forms (verbatim)

**Models** — post-`inject`, with child slots and a nav label thunk
(`$PKG\dsh-client-ui-settings-models\lib\client.js:4485-4501`):

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "models",
    order: 10,
    label: () => t("nav"),
    inject: injected,
    children: {
        "settings.models.provider-card": { kind: "keyed", scope: "root" },
        "settings.models.footer": { kind: "list", scope: "root" }
    }
}, ModelsSection));
```

**General** — `locale: NS`, child declaration, no `inject` (`...\dsh-client-ui-settings-general\lib\client.js:1293-1303`):

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "general",
    order: 0,
    label: () => t("general.nav"),
    locale: NS,
    children: { "settings.general.item": { kind: "list", scope: "root" } }
}, GeneralSection));
```

**Built-in plugins** — both `locale` and `inject` (`...\dsh-client-ui-settings-plugins\lib\client.js:201-212`):

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section", id: "plugins", order: 15,
    label: () => t("nav"), locale: NS, inject: sectionInjected,
    children: { "settings.plugins.tab": { kind: "list", scope: "root" } }
}, PluginsSettingsSection));
```

Other shipped ids/orders (for placement): `account` = **-10**
(`...\dsh-client-ui-settings-account\lib\client.js:4777-4783`), `general` = 0, `models` = 10,
`plugins` = 15, `agent-presets` = 20 (`...\dsh-client-ui-agent-preset\lib\client.js:2455-2461`).

### 1.3 Is registration conditional?

Yes, in three distinct ways — but never with `ctx.inject([...])` around the slot call:

1. **Cordis service gating** — the plugin's own `export const inject = [...]` / `inject: [...]`
   (models `:4417-4427`): `["slots","locale","remote","remote.credentials","remote.llm",
   "remote.settings","remote.session","configForms","settingsSchema"]`. Plain
   `plugin-gating`; the plugin does not activate until all exist.
2. **`ctx.slots.inject(slotKey, factory)`** — *not* service injection. It is the declaration
   dependency: the factory runs when (and only while) the slot is declared. Models documents
   exactly this at `:4412-4416`: “The target slot is declared by ui-settings' apply, whose
   activation order relative to this one is NOT constrained; registration depends on each slot
   through `slots.inject()`.”
3. **Namespace gating** — `ctx.configForms.whileServed([ns], () => ctx.slots.inject(...))`
   (agent-loop `:158-165`) hides the page entirely when the Host does not serve that namespace.

`ctx.inject([...])` does appear in shipped code, but for *optional* features
(`...\dsh-client-ui-settings-general\lib\client.js:1180` wraps the whole `sidebar.settings`
registration; `dsh-client-modules\lib\index.js:570` wraps the `/plugins` route). It is a
Cordis-level “run when these services appear” helper, not part of slot registration.

### 1.4 The component's props, exactly

Props are assembled in this order and spread left-to-right, so **later wins**
(`$PKG\dsh-client-ui-renderer\lib\client.js:773-810`):

```
kit   →   injected (entry.inject face)   →   slotInjected (renderSlot props)   →   ownerProps
```

`kit` is built in `standardKit` (`:736-767`): standard binding props/hooks, `renderFactorySlot`,
`t` when `entry.locale !== undefined` (`:742-746`), `useStore`/`actions` when the registration
declared `store` (`:748-752`), and `renderSlot`/`renderSlotChain`/`SessionProvider` when the
registration declared `children` (`:753-761`).

For `settings.section` the shell renders
`renderSlot("settings.section", { close: onClose }, { only: active })`
(`...\dsh-client-ui-settings-general\lib\client.js:337`), so the owner share is exactly
`{ close }`; `only` is a filter, not a prop.

Consequences for a page author:

* `close` is the only shell affordance — usable for “leave Settings” flows.
* `renderSlot` is **absent** unless you declare `children`.
* `t` is **absent** unless you pass `locale: NS` (or you inject your own `t`).
* `useSessions`, `useWorkspaces`, `useResource`, `usePanelInfo`, `useRemoteAccess`,
  `useSessionStatus`, `useSessionRetainInfo`, `useSessionAccess`, `useWorkspaceAccess` are always
  present.

Models only consumes what its own inject face adds (`...\settings-models\lib\client.js:2324-2337`):

```js
function ModelsSection(props) {
    const { controller, useSnapshot, operations, schema, t, renderSlot } = props;
    if (controller === void 0 || useSnapshot === void 0 || ...) return null;
    return jsx(Loaded, { injected: { controller, useSnapshot, operations, schema, t }, renderSlot });
}
```

and the inject face that supplies `useSnapshot` is `:4445-4451`:

```js
const injected = () => ({
    controller,
    hooks: { snapshot: controller.store },   // → prop useSnapshot
    operations, schema, t
});
```

---

## 2. Host access from a settings page

### 2.1 The `hooks` → `use<Name>` rule (copy this)

`$PKG\dsh-client-ui-renderer\lib\client.js:444-459` (`bindInjectSources`) renames every key of the
inject face's `hooks` object with `standardHookPropName` = `use${Capitalize(name)}`, and
`:219-226` binds it to a selector hook over `useSyncExternalStoreWithSelector`
(`:92-93`, `:159`). Contract for a hook source: `{ getSnapshot(), subscribe(fn) → off }`
(the catalog's `HostObservable`). Call form: `useX(selector, isEqual?)`.
`hooks.keyedHooks` yields keyed hooks (`useX(key, selector?)`).

So the safest local pattern is: **own a small store object** and expose it as `hooks.something`;
the component then reads `props.useSomething((s) => s)`. This survives re-renders, is shared by
every outlet, and matches the shipped pages. A plain `useState` + promise is fine for a
single-page read (my skeleton does this) but does not survive remounts (switching Settings
sections unmounts your component, because only the active id is rendered — `:337`, `only`).

### 2.2 Namespace access (`ctx.remote.*`)

Declared per namespace, e.g. models `inject` `:4417-4427` includes `remote`, `remote.settings`,
`remote.credentials`, `remote.llm`, `remote.session`.

Calls and their semantics:

```js
// ...\settings-models\lib\client.js:1340-1344
const [registered, declared] = await Promise.all([
    this.ctx.remote.llm.listProviders(),
    this.ctx.remote.llm.listConfigurableProviders(),
    this.describeFace.ensure()
]);
if (!registered.ok) { this.failLoad(registered.error.message); return; }

// :3180  (write with revision, path ops)
const response = await ctx.remote.settings.mutate(ns, ops, expectedRevision);
// :3172/:3176
await ctx.remote.credentials.set(ref, value);
await ctx.remote.credentials.unset(ref);
// :1383 (batched, max 64)
const response = await ctx.remote.credentials.describe(refs.slice(index, index + 64));
// :4472-4478 (forwarded Host events)
ctx.remote.$on("settings/document-updated", refreshModels)
ctx.remote.$on("credentials/record-updated", refreshModels)
ctx.remote.$on("credentials/reference-updated", refreshModels)
ctx.remote.$on("llm/adapters-updated", refreshModels)
ctx.on("connection/reset", refreshModels)          // local Cordis event
```

Every unary call resolves to `RemoteResult<T>` — `{ ok:true, value } | { ok:false, error }` and
**never rejects for a carrier problem**; only assembly faults reject
(`$PKG\dsh-api-gateway\README.md:60`). `$on` subscriptions belong to the calling fiber
(`README.md:66`); with `connection.interactions === 'none'` `$on` is unavailable, so guard the
call (see §6.9).

### 2.3 The exact `settings` namespace surface

Host controller `$PKG\dsh-api-settings-controller\lib\index.js`:

| Method | Signature | Line |
|---|---|---|
| `describe()` | `() → { writable, hasDocument, namespaces: NamespaceView[] }` | `:393-400` |
| `update(ns, patch, rev?)` | merge into the user section | `:409-411` |
| `replace(ns, section, rev?)` | replace the user section wholesale | `:420-422` |
| `mutate(ns, ops, rev?)` | ordered path ops `{op:'set'|'unset', path: string[]}` | `:433-435` |
| `openSettingsDocument(signal)` | native text editor | `:442-460` |

`NamespaceView` is projected field-by-field at `:274-289`:
`{ ns, autoGenerate, schema, value, base?, user?, applies, secrets:[{path,set}], revision }`
— always `redactSecrets:true` (`:290-296`). Path-op semantics + volatility refusal:
`$PKG\dsh-settings\lib\index.js:488-507` (`"Config field \"…\" is not volatile"`,
`No configurable plugin entry "…"`). Conflicts arrive as `settings/conflict`
(`$PKG\dsh-api-settings-controller\lib\index.js:501-508`).

### 2.4 The settings base — usable **without importing it**

`@deepseek-ai/dsh-client-ui-settings` provides two Cordis services that any client plugin can
inject **by name**:

* `settingsSchema` — `new SettingsSchemaService`/`super(ctx,"settingsSchema")`
  (`$PKG\dsh-client-ui-settings\lib\client.js:923-926`).
* `configForms` — `super(ctx,"configForms")` (`:1252-1270`) with
  `get(entryId)` → shared form (values + write queue) `:1294-1301`,
  `describe()` → the shared describe mirror `:1287-1289`,
  `whileServed(namespaces, register)` `:1315-1334`,
  `developerTools` preference `:1274`.
* The mirror itself is `SettingsDescribeMirror` `:1353+`, snapshot `{ status, view?, error? }`
  (`:1367`, `:1454-1462`), `acceptView(view)` folds a write answer in (`:1413-1421`).
* Its `inject` is `["remote","remote.settings"]` and it refreshes on
  `settings/document-updated` + `connection/reset` (`:1481-1498`).

This is the **only** settings base you may rely on if you must avoid cross-package imports:
`ctx.configForms.describe().getSnapshot().view` gives `{ writable, namespaces }` refreshed by the
host plugin, and `ctx.configForms.get(ns)` gives an accepted-values form with a write queue.
Caveat from the package README: it “owns the single `settings.describe` reader in the browser”
(`$PKG\dsh-client-ui-settings\README.md:64`) — a page that calls `ctx.remote.settings.describe()`
itself adds a second reader. Either is functionally correct; prefer the mirror for consistency.

### 2.5 React hooks / stores used by shipped pages (copy list)

| Pattern | Evidence |
|---|---|
| `useSnapshot((v) => v)` from `hooks.snapshot` | models `:2338-2340`, `:4447` |
| `useState` for per-page UI state (drafts, dialogs, busy flags) | models `:2352-2369` |
| `useId()` for a11y ids (tabs, dialog titles) | models `:2364`; general `:277`; plugins `:38` |
| `useEffect`/`useLayoutEffect` for subscriptions and modal layers | general `:368-418`; models `:2423` |
| `useRef` for focusable nodes / tab arrays | general `:278`; plugins `:39` |
| `useStore((s) => s)` + `actions` when the **registration** declares a store | general `:350-352` |
| `useSyncExternalStore` inside the framework only (never in page code) | renderer `:589`, `:714`, `:1119` |
| `React.memo`-safe `t` identity per (ns, revision) | renderer `:542-558` |
| a plain controller class + `store` outside React (survives remounts) | models `ModelsSettingsStore` `:1304+`; agent-loop controller `:99-127` |

Available React: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` are baseline
modules (see §8.1); function components returning `h(...)` are exactly what the slot renderer
expects (`SlotComponent<P> = (props) => ReactNode`, `:2221`).

---

## 3. Locale

### 3.1 Runtime registration

`ctx.locale.register(ns, { zh, en })` requires **both** shipped locales for the object form
(`$PKG\dsh-client-locale\README.md:32`):

```js
// ...\dsh-client-ui-settings-plugins\lib\client.js:168-172
const t = ctx.locale.bind(NS);
ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-settings-plugins: section dictionaries");
```

Per-locale form for extra languages, plus language packs (`README.md:40-58`):

```js
ctx.effect(() => ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }), '…');
ctx.effect(() => ctx.locale.register('common', 'ja', { cancel: 'キャンセル' }), '…');
```

Lookup walks the active language's fallback chain in the entry namespace, then repeats it in
`common`, then shows the key (`README.md:58`). A dictionary registered after mount is picked up
without remount; registration advances the locale revision, which re-derives every `t`
(`renderer:542-558`).

Two ways to get `t` into a component:

1. `locale: NS` on the registration → framework supplies prop `t` (general `:1298`, plugins
   `:206`, agent-loop `:163`).
2. Inject it yourself: `inject: () => ({ ..., t })` (models `:4444-4451`).

`ctx.locale.register` returns a disposer → wrap in `ctx.effect`.

### 3.2 Locale JSON files in the manifest

Those files are **not** the runtime dictionary — the dictionary lives inline in `lib/client.js`
(see `const en = {...}` at `...\settings-plugins\lib\client.js:134-148`). The `locale/*.json`
files carry **display metadata** for Plugin Manager / Settings rows
(`$...\cordis-plugin-development\references\host-plugin.md:31-42`):

```json
{ "meta": { "title": "My Settings Page", "description": "Adds a Demo page to Settings." } }
```

Manifest requirements:

```json
"exports": { "./locale/*.json": "./locale/*.json" },
"files": ["index.js","client.js","cordis.patch.yml","locale/*.json","icon.svg"]
```

Ship `locale/en.json` and `locale/zh.json` (same `meta` shape), an `./icon` export and an icon
file ≤256 KiB (SVG/PNG/JPEG/WebP), and a top-level `description` in `package.json` for fallback.
Missing metadata falls back to `package.json` name/description; malformed metadata is diagnosed.

---

## 4. Theme tokens that actually exist in this build

Extracted from the theme bundle (`$PKG\dsh-client-ui-theme\lib\client.js`): **107**
`--dsw-alias-*` tokens, **296** other `--dsw-*` tokens, 19 `--dsh-*` tokens. There are **no
spacing tokens** (`--dsw-space-*` does not exist) and **no `--dsw-font-family-*`** — use
`--dsh-font-family-text` / `--dsh-font-family-code`.

### 4.1 Use these for a settings page

| Purpose | Token(s) | Source of the recommendation |
|---|---|---|
| Panel surface (shell) | `--dsw-alias-bg-layer-2` | general `SettingsRoot.module.css` `.panel` |
| Section text base | `--dsw-alias-label-primary` | models `.section` |
| Card surface / stroke | `--dsw-alias-settings-card-fill`, `--dsw-alias-settings-card-stroke` (0.5px) | models `.rowCard` |
| Inner block (editor) | `--dsw-alias-bg-module-platform` | models `.editor`, `.addCard` |
| Borders | `--dsw-alias-border-l1` … `-l4` (`l2` separators, `l3` control outline, `l4` input border) | models `.customized`, `.secondaryButton`, `.input` |
| Text primary / secondary / tertiary / dimmed | `--dsw-alias-label-primary`, `-secondary`, `-tertiary`, `-dimmed` | models `.title`/`.intro`/`.fieldLabel`/`::placeholder` |
| Text on primary button | `--dsw-alias-label-primary-foreground` | models `.primaryButton` |
| Primary button fill / hover | `--dsw-alias-button-primary-fill`, `--dsw-alias-button-primary-hover` | models `.primaryButton` |
| Hover wash / solid hover / active | `--dsw-alias-interactive-bg-hover`, `-hover-solid`, `-bg-active` | models `.secondaryButton:hover` |
| Danger | `--dsw-alias-state-error-primary`, `--dsw-alias-interactive-bg-hover-danger` | models `.dangerButton`, `.credentialDotMissing` |
| Success / green dot | `--dsw-alias-state-success-primary` | models `.credentialDotConfigured`, `.accountStatus` |
| Warn / inline notice | `--dsw-alias-state-warn-label`, `-primary`, `-secondary`, `-tertiary` | models `.notice` |
| Idle dot | `--dsw-alias-state-idle-primary` | primitives `StateDot` CSS |
| Accent / focus border | `--dsw-alias-state-business-primary` | models `.input:focus` |
| Focus ring | `--dsw-focus-ring-width`, `--dsw-focus-ring-color` (fallback `--dsw-alias-state-business-primary`) | models `:focus-visible`, keyToggle |
| Input bg / border / placeholder | `--dsw-alias-bg-layer-1`, `--dsw-alias-border-l4`, `--dsw-alias-label-dimmed` | models `.input` |
| Radius | `--dsw-radius-xs` 4-ish, `-sm`, `-md`, `-lg`, `-xl`, `-panel` | models `.rowCard`(xl)/`.editor`(lg)/`.input`(md) |
| Elevation | `--dsw-elevation-prominent` (shell panel), `--dsw-elevation-panel`, `--dsw-elevation-soft`, `--dsw-shadow-lv1..3` | general `.panel` |
| Mask / blur | `--dsw-alias-bg-mask-1`, `--dsw-mask-blur` | general `.mask` |
| Scrollbar | `--dsw-alias-scrollbar-bg-l2`, `--dsw-alias-scrollbar-hover-l2`, `--dsh-scrollbar-thumb` | general `.panel`, models `.fetchDialog` |
| Nav active | `--dsw-specific-sidebar-nav-item-active` | general `.navCell.active` |
| Tag outline | `--dsw-alias-border-l3`/`-l4`, `--dsw-alias-label-secondary`/`-tertiary` | models `.rowTag`, primitives `Tag` |
| Brand (switch on) | `--dsw-alias-brand-primary` | primitives `Switch` CSS |
| Code font | `--dsh-font-family-code` | theme tokens (models uses the broken `--ds-font-family-code`, see §4.2) |

**No spacing tokens**: shipped CSS hard-codes 12/14/16px (`padding:12px 14px`, `gap:12px`,
`padding:16px 0`). Copy those numbers.

### 4.2 Host bug worth not copying

`...\settings-models\lib\client.js:78,107` use `var(--ds-font-family-code)` — a misspelled
non-existent token (correct: `--dsh-font-family-code`). Any code using `--ds-…` silently falls
back to the inherited font.

### 4.3 Where the page is laid out

Settings panel: 800px wide, `--dsw-radius-panel`, `--dsw-alias-bg-layer-2`; nav column 188px;
content header 54px; the section column is
`.wCInkW_options{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}`
(`...\dsh-client-ui-settings-general\lib\client.js:60`, CSS shipped inline per plugin with
`<style data-plugin-css="<id>">`). Sections therefore set their own `max-width`
(models 720px `:58`, plugins 760px `:11`).

---

## 5. Controls to hand-copy (so the page matches the host)

The baseline module table **does** expose `@deepseek-ai/dsh-client-ui-primitives`
(`index-CN7NIWNw.js@916075`, see §8.1), i.e. `require('@deepseek-ai/dsh-client-ui-primitives')`
would work at runtime. The authoring rules still forbid it: “the plugin imports no Harness Client
package such as `@deepseek-ai/dsh-client-ui-primitives`”
(`…\references\verification.md:6`). Hand-copy the CSS + markup below instead.

### 5.1 Button (primary / secondary / danger / link / icon)

From models CSS (`...\settings-models\lib\client.js:58`, rules 17-26, 36-37, 63-66, 80-81):

```css
.b-primary,.b-secondary{box-sizing:border-box;border-radius:var(--dsw-radius-md);height:36px;
  font:inherit;cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;
  gap:4px;padding:0 14px;font-size:14px;line-height:22px}
.b-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.b-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.b-secondary{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);background:0 0}
.b-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.b-danger{color:var(--dsw-alias-state-error-primary);background:0 0;border:none}
.b-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
/* compact row action */ .row .b-secondary,.row .b-danger{border-radius:var(--dsw-radius-sm);height:28px;padding:0 10px;font-size:12px;line-height:18px}
:is(.b-primary,.b-secondary,.b-danger):disabled{opacity:.4;cursor:default}
:is(.b-primary,.b-secondary,.b-danger):focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}
```

Markup: `<button type="button" class="b-primary">`. Ship `disabled` while busy and keep the
label stable (`t('saving')` swap is what models does). No `role` needed: it is a real `<button>`.

### 5.2 Text field / textarea / select

Models `.input` (CSS rule 82-86):

```css
.f-input{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);
  width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);padding:0 10px;font-size:14px;line-height:22px}
.f-input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}
.f-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.f-input:disabled{opacity:.6;cursor:default}
```

`<select>`: `select.f-input{cursor:pointer;max-width:240px}` plus the chevron background
(`appearance:none`, inline SVG `background-position:right 12px center`, rule 93).

Primitive equivalents, if you prefer the same DOM as the host:
`Input` = `forwardRef(({icon,className,...props}) => span.wrap > [span.icon] + input)`
(`index-CN7NIWNw.js@644393`); `settingsTextField(field)` / `settingsNumberField(field)` return
field specs `{field, format, parse}` for the shared form (`@778933`, `@779137`).

### 5.3 Switch — exact primitive markup (role/aria)

`index-CN7NIWNw.js@642543`:

```js
function Switch({ checked, onChange, label, disabled = false, title, className }) {
  return jsx("button", {
    type: "button", role: "switch", "aria-checked": checked, "aria-label": label,
    title, disabled, className: clsx(switchCls, className),
    onClick: () => { onChange(!checked) },
    children: jsx("span", { className: thumbCls })
  });
}
```

CSS (`index-BxpfOGf3.css`, class `_switch_1ik0f_5` / `_thumb_1ik0f_33`):

```css
.sw{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;
  border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
.sw[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.sw:disabled{cursor:default;opacity:.5}
.sw:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.sw-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground)}
```

Notes: it is a `<button>` so Space/Enter click natively — no key handler, no `aria-labelledby`
needed because `aria-label` carries the name; the thumb is decorative (`aria-hidden` implied by
empty span). Callers pass `checked/disabled/label/onChange` (models `:396-403`,
`...\settings-general\lib\client.js:709-721`).

### 5.4 Checkbox, Tag, StateDot, SegmentedControl

* `Checkbox` `@644128`: `<label class=checkbox title><input type="checkbox" checked disabled onChange={e=>onChange(e.target.checked)}><span>{label}</span></label>`.
* `Tag` `@641802`: `<span class=tag data-tone="outline|solid|neutral|quiet|success">{children}</span>`;
  CSS: pill, `padding:1px 8px;font-size:11px;line-height:17px;font-weight:500`,
  `[data-tone=outline]{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}`.
* `StateDot` `@637591`: `{state:'idle'|'ongoing'|'done'|'warning'|'error', size, appearance:'dot'|'step'}`;
  `ongoing` renders an SVG spinner, others `<span data-state=… aria-hidden="true">` with
  `:after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}` and
  `[data-state=done]{color:var(--dsw-alias-state-success-primary)}` etc.
  For a plain “configured” dot models uses its own 8px span:
  `.dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}`
  (CSS rules 12-14).
* `SegmentedControl` `@643190`: `{id,value,options,onChange,label,disabled,className}` →
  `div role="tablist" aria-label` + `button role="tab" aria-selected tabIndex={selected?0:-1}`
  with ArrowLeft/Right/Home/End roving focus (models uses it for its add-provider modes).

### 5.5 Modal / Dialog (focus trap, Escape, mask)

Primitive `Modal` `index-CN7NIWNw.js@666238`:

```js
function Modal({ open, onClose, title, closeLabel, description, children, footer,
                 className, contentClassName, onKeyDownCapture, headless, backdropBlur, shortcutModal }) {
  const panel = useRef(null);
  useModalLayer(panel, open, onClose);              // @647288
  return open ? createPortal(
    div.root role="presentation" onKeyDownCapture
      > div.mask aria-hidden="true" onClick={onClose}
      + div ref={panel} tabIndex={-1} data-shortcut-modal={shortcutModal}
            className dialog role="dialog" aria-modal="true" aria-label={title}
        > (headless ? children
          : div.content > div.header > h2.title{title} + button.close aria-label={closeLabel}
            + p.description? + div.body{children}
            + div.footer{footer})
    , document.body) : null;
}
```

`useModalLayer(panelRef, open, onClose)` (`@647288`) is the behavior contract to preserve if you
hand-roll:

* one modal stack per `document`; top-most wins;
* `Escape` (no Shift/Alt/Ctrl/Meta, no `defaultPrevented`, not `repeat`) → `onClose()`;
* `Tab`/`Shift+Tab` wrap inside the panel using
  `'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'`
  (`@647160`), skipping `[inert]`/`[hidden]`;
* initial focus: `[data-modal-autofocus]`, else first focusable, else the panel;
* focus is restored to the previously active element on close.

The settings shell itself uses exactly this for its own panel
(`...\settings-general\lib\client.js:279`, panel markup `:280-341` with `role="dialog"`,
`aria-modal`, `aria-labelledby`, mask click and the close button).

Design note from models: it renders **inline cards** (`addCard`, `editor`) for editing and only
uses a `Modal` for destructive confirmation and the model-picker
(`...\settings-models\lib\client.js:1113-1130`), so a page rarely needs a dialog at all.

### 5.6 Card row, empty state, inline notice

```css
/* models .rowCard/.rowHead/.rowName/.rowActions  (rules 7-16) */
.card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);
  border-radius:var(--dsw-radius-xl);display:flex;flex-direction:column;gap:12px;padding:12px 14px}
.card-head{display:flex;align-items:center;gap:10px}
.card-name{font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}
.card-actions{margin-left:auto;display:inline-flex;align-items:center;gap:4px}
/* empty */ .empty{border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);
  text-align:center;padding:12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
/* notices */ .notice{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}
.saved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
```

A11y details the host uses and a page should keep: `aria-current="true"` on the active nav cell
(general `:308`), `role="status"` for “saved”, `role="alert"` for failures (general `:706`,
models `:2432`), visually hidden labels via
`.hiddenLabel{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}`
(models rule 98).

---

## 6. Constraints, failure modes, disposal, nav, opening

### 6.1 What `ctx.slots.register` refuses (SlotCore, verbatim messages)

`SlotCore` implementation: `index-CN7NIWNw.js@485027` (surface declared in
`$PKG\dsh-cordis-client-runner\lib\client.js:2225-2226`). For a `list` slot:

* missing `id` → `list slot "settings.section" requires options.id`
* duplicate `id` at the same `priority` →
  `list slot "settings.section" already has an entry with id "x" at priority 0 (registered by …) — register at a different priority to shadow it (lowest renders)`
* un-declared slot → `slot "settings.section" is not declared (a parent entry's children table must declare it)`
  (this is what `ctx.slots.inject(key, …)` exists to avoid)
* child declaration collision → `slot "<child>" is already declared (by <declarer>)`
* `single`: any second registration at the same priority throws; `keyed`: needs `key`;
  `chain`: needs `select`; store handle reused across scopes →
  `… one handle, one scope`.

So: **never** register a child slot another plugin already declares (e.g.
`settings.models.provider-card`), and give your section a fresh `id`. Reusing a shipped id
(`models`, `general`, …) throws at priority 0; with `priority: -1` it registers and *shadows*
(the dedupe in `entriesOfSlot` keeps the lowest priority), which is almost never what you want.

### 6.2 A component that throws

Every entry renders inside `SlotErrorBoundary` (`$PKG\dsh-client-ui-renderer\lib\client.js:631-646`):
it logs `slot entry crashed in '<slotKey>':`, renders `<div data-slot-error="<slot>">`, and reports
through `reportEntryError` → `slots.onEntryError`. For list/keyed/single cells the entry
**abdicates** (removed from the live set, `:205-215`), so the shell falls back to the next
survivor or an empty cell. The dynamic-package runner forwards such crashes to the Host
(`...\dsh-cordis-client-runner\lib\client.js:421-435`). Practical rule: return `null` for a
transient “not ready” state instead of throwing (models does this at `:2326`).

### 6.3 Ownership and disposal

* `ctx.slots.register(...)` = `ctx.effect(() => core.register(...), "slots.register()")`
  (`...\dsh-client-ui-renderer\lib\client.js:1813-1816`) → the entry disappears when the plugin
  fiber unloads or the returned disposer runs.
* `ctx.slots.inject(slotKey, factory)` (`:1368-1427`): runs `factory` **synchronously** when the
  slot is already declared, otherwise after the declaring registration commits; re-runs if the
  declaration epoch changes (slot collapse + re-declaration); disposer removes both the wait and
  the contribution; setup errors throw synchronously when already declared, else are rethrown in
  a microtask (`:1400-1413`).
* Everything else you add (styles, `$on` subscriptions, shortcuts) belongs in `ctx.effect` or
  `ctx.on` with a returned cleanup (`references\ui-plugin.md:13`).
* Stores: `store` on a registration is a handle, resolved per scope, released with the last
  holder (`renderer:1780-1802`); one handle, one scope.

### 6.4 Can plain JS use hooks safely?

Yes — the slot contract is literally `(props) => ReactNode` (`:2221`), shipped bundles are plain
compiled JS, and `hooks.snapshot` becomes prop `useSnapshot` *for* you. Conditions: the component
must be a function (no class), hooks must be called unconditionally in the same order, and any
`inject` face you pass is called **once per entry** outside render (cached per entry —
`renderer:499-532`), so do not build per-render values there.

### 6.5 The Settings nav row

Rows come from the ledger, not from a registry call
(`...\dsh-client-ui-settings-general\lib\client.js:1138-1162`):

```js
rows = ctx.slots.entries("settings.section").map((e) => ({
    id: e.options.id ?? "", order: e.options.order ?? 0,
    label: resolveSlotLabel(e.options.label) ?? ""
})).sort((a, b) => a.order - b.order);
```

`subscribe` = `ctx.slots.subscribe("settings.section", …)` + `ctx.locale.subscribe(…)`, so a new
entry appears live. The nav button (`:305-317`) shows `navIcon(row.id)` + the label; unknown ids
get `IconSettingsOutlineMedium` (`:265-268`). **No label ⇒ blank row** — always pass `label`.

### 6.6 Making Settings open on your page

1. **Lowest order** (recommended): the shell renders
   `const active = rows.find((r) => r.id === activeId)?.id ?? rows[0]?.id;`
   (`:276`), and `close()` resets `activeId` to `undefined` (`:29-32`). So `order <= -1000` makes
   your page the landing page every time Settings opens. Side effect: it changes the default page
   for the whole profile — use only if the user asked for that.
2. **User clicks the nav row** — with a normal order (e.g. 12) it simply appears in the list.
3. **Programmatic, unsupported**: a section gets only `close`, and `openSection(id)` is owner
   props of `settings.onboarding` only (`$PKG\dsh-cordis-client-runner\lib\client.js:5221`).
   The shell's store lives on the `sidebar.settings` registration
   (`...\settings-general\lib\client.js:1233-1236`, `store: shellStore` with
   `actions.open()/close()/select(id)/openSection(id)` `:26-39`). From another plugin you can
   reach it as
   `ctx.slots.entries('sidebar.settings')[0].store.create().actions.openSection('settings-demo')`
   — it works (root store ⇒ one instance) but depends on another entry's private store shape and
   is not part of any published contract. Prefer 1 or 2.
4. `settings.action` (list, header cell before Close, catalog `:4889-4899`) is the right seat for
   a page-independent “Open Demo settings” button, but it has no `openSection` either — it can
   only show UI, not switch sections.

### 6.7 Other refusals to expect at write time

* `settings/rejected` → “Config field `x` is not volatile” / “No configurable plugin entry”
  (`$PKG\dsh-settings\lib\index.js:501-508`), e.g. when your `path` names a non-editable field.
* `settings/conflict` when `revision` moved (models always sends the revision it read, `:3180`).
* `describe()` is redacted: secret fields are removed and listed in `secrets[]`
  (`$PKG\dsh-settings\lib\index.js:22-44`), so a naive read-modify-write of the whole `user`
  section drops secret overrides — use path ops for those namespaces (§8.5 safety notes).
* A page that writes without `remote.settings` in `inject` fails at activation, not at click.

### 6.8 Slot-declaration ordering pitfalls

`settings.section` exists only while the `sidebar.settings` entry is mounted (catalog `:5333`).
Because the shell registers it from its own `apply`, and `ctx.slots.inject` waits, your plugin
may activate before or after `ui-settings-general` without changing behavior — do not
`ctx.inject(['…ui-settings-general'])` to “fix” ordering.

### 6.9 `$on` availability

`ctx.remote.$on` requires `connection.interactions === 'answer'`; otherwise it is unavailable
(`$PKG\dsh-api-gateway\README.md:66`). Wrap the subscription in `try/catch` (skeleton below) so a
display-only page still loads.

---

## 7. Verifying from outside a browser

**What a correct page produces.** Three independent, observable facts:

1. The Client slot ledger gains one occupant for `settings.section` with your `id`, `order`,
   `label`, `registrant` (= your loader fiber name). Live shape:
   `ctx.slots.snapshot('settings.section')` → `{ type:'slot', name, kind:'list', scope:'root',
   declaredBy, occupants:[{registrant,id,order,priority,active}], children:[] }`
   (`...\dsh-client-ui-renderer\lib\client.js:1557-1564`, `SlotCore.snapshot` `@485027`).
   Exposed read-only through the **Client Inspect** provider `Slots` / `listSubTree` with
   `{"root":"settings.section"}` (`$PKG\dsh-cordis-client-runner\lib\client.js` provider manifest).
2. The Host loader entry exists → Host Inspect `Config.listConfigs` with
   `{"name":"@local/settings-demo"}` returns the entry id and `packageDir`; `application` status
   from `plugin_manager install_bundle` is the operative one (`host-plugin.md:68`).
3. The bundle is served: `GET /plugins/<package-name>/client.js?rev=<rev>` where `rev` is the
   artifact revision the boot graph advertises (`$PKG\dsh-client-modules\lib\index.js:202-222`,
   route registration `:563-569`, strict URL+rev match `:933-950`, `:977-989`). Invalid/absent rev
   ⇒ 404, non-GET/HEAD ⇒ 405.

**Detecting a runtime error.** In the page: `slot entry crashed in '<slot>':` in the console
(`renderer:637-639`), a `<div data-slot-error="settings.section">` placeholder, and — for bundle
loading — the Web boot audit reports the last import failure per row
(`$PKG\dsh-client-modules\README.md:38`). The dynamic runner additionally surfaces
`renderFailures` and forwards the crash to the Host (`runner:421-435`).

**Is there an HTTP API of the running GUI?** Not usable unauthenticated. Measured against
`http://127.0.0.1:55099` during this research:

| Request | Result |
|---|---|
| `GET /` | **401** |
| `GET /index.html` | **401** |
| `GET /api` , `GET /api/settings` | **401** |
| `GET /plugins` | 404 |
| `GET /plugins/@deepseek-ai/dsh-client-ui-settings-models/client.js` | 404 (rev not advertised/absent) |
| `GET /assets/index-CN7NIWNw.js` | 200 (`text/javascript`) |

Reason: the browser URL carries a one-shot process launch token that mints a signed session
cookie; every other request for the index gets the same minimal 401
(`$PKG\dsh-client-connection\lib\index.js:435-484`). Do not hunt for that token. Consequence:

* **No live page ⇒ no Client Inspect.** Proof: both `Slots.listSubTree` and `Theme.listTokens`
  returned `Client inspect query … timed out after 10000ms; Open or reconnect the Harness page`.
* **What is verifiable headlessly**: JS syntax (`node --check client.js`), manifest JSON, `files`/
  `exports` presence, `dsh.client` fields, the bundle's presence in the profile's
  `node_modules`, and Host-side activation via Host Inspect / `plugin_manager` result. Visual and
  slot-level claims require a connected page (`references\verification.md:3`); report that limit.

---

## 8. Minimal working bundle (verbatim)

Layout (all files inside one workspace directory, then install that directory as a bundle):

```
settings-demo/
  package.json
  cordis.patch.yml
  index.js
  client.js
  locale/en.json
  locale/zh.json
  icon.svg
```

### 8.1 `package.json`

```json
{
  "name": "@local/settings-demo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Adds a Demo page to the Settings panel.",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-api-remotes"
      ]
    }
  }
}
```

Notes:

* `dsh.client.platform` must be `"web"`; `inject` lists the client-plane packages whose modules
  must be registered before yours (copy models' list, `...\settings-models\package.json`).
* `external` is only for **non-baseline** module ids. `react`, `react/jsx-runtime`, `react-dom`,
  `react-dom/client`, `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`,
  `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
  `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit` are the frozen
  platform table (`index-CN7NIWNw.js@916075`), so `require('react')` needs no declaration.
* `dsh.bundle.patch` + a loader row is what makes the Client half exist: the Client module table
  is composed from loader entries by package name (`$PKG\dsh-client-modules\lib\index.js:558-569`).
* `immediately: true` (decoration template) only prefetches the bundle at boot
  (`index-CN7NIWNw.js@919554`, `prefetchImmediateTier`); optional.

### 8.2 `cordis.patch.yml`

```yaml
- insert:
    - id: settings-demo
      name: '@local/settings-demo'
```

### 8.3 `index.js` (Host half — required so the package has a loader row)

```js
/** Host half of the Settings demo bundle; the Client module owns the page. */
export function apply() {}
```

### 8.4 `locale/en.json` / `locale/zh.json` (display metadata, not runtime copy)

```json
{ "meta": { "title": "Demo settings", "description": "Adds a Demo page to the Settings panel." } }
```

```json
{ "meta": { "title": "演示设置", "description": "在设置面板中增加一个演示页面。" } }
```

### 8.5 `client.js` — verbatim skeleton

Registers one `settings.section` page that lists every settings namespace as a card from
`ctx.remote.settings.describe()`, with a **Refresh** button and a **Save** action
(`settings.replace` of that namespace's user overrides, carrying the read revision). No JSX, no
bundler, no npm dependency, React from the module table.

```js
// Settings demo — plain-JS browser half (no JSX, no bundler).
// Registers one Settings page: ctx.remote.settings.describe() → card list, Refresh, Save.
window.__ModuleLoader__.load({
  id: '@local/settings-demo',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'settings.demo';
    const LOG = 'settings-demo';
    const STYLE_ID = '@local/settings-demo/SettingsDemo.css';

    // --- dictionaries: both shipped locales are required by the object form ---
    const en = {
      nav: 'Demo',
      title: 'Demo settings',
      intro: 'Every settings namespace this Host serves, as a card. Refresh re-reads the document; Save writes one namespace.',
      refresh: 'Refresh',
      loading: 'Loading settings…',
      empty: 'This deployment serves no settings namespaces.',
      loadFailed: 'Settings could not be read',
      retry: 'Retry',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      readOnly: 'This deployment stores settings read-only.',
      overrides: 'Stored overrides (JSON)',
      invalidJson: 'Enter a JSON object, or {} for no overrides.',
      revision: 'revision',
    };
    const zh = {
      nav: '演示',
      title: '演示设置',
      intro: '以卡片形式列出本 Host 提供的全部设置命名空间。刷新会重新读取文档，保存会写入其中一个命名空间。',
      refresh: '刷新',
      loading: '正在读取设置…',
      empty: '本部署没有提供任何设置命名空间。',
      loadFailed: '无法读取设置',
      retry: '重试',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      readOnly: '本部署的设置为只读。',
      overrides: '已存覆盖项（JSON）',
      invalidJson: '请填写 JSON 对象；无覆盖项请填 {}。',
      revision: '版本',
    };

    // --- styles: theme tokens only; shipped CSS has no spacing tokens ---
    const CSS = [
      '.sd-section{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}',
      '.sd-title{margin:0;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}',
      '.sd-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}',
      '.sd-toolbar{display:flex;align-items:center;gap:8px}',
      '.sd-notice{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}',
      '.sd-saved{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}',
      '.sd-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      '.sd-empty{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.sd-rows{display:flex;flex-direction:column;gap:8px;margin:12px 0 0;padding:0;list-style:none}',
      '.sd-card{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}',
      '.sd-head{display:flex;align-items:center;gap:10px}',
      '.sd-name{font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.sd-dot{width:8px;height:8px;flex:none;border-radius:50%;corner-shape:round;background:var(--dsw-alias-state-idle-primary)}',
      '.sd-dot[data-writable="true"]{background:var(--dsw-alias-state-success-primary)}',
      '.sd-tag{padding:1px 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '.sd-field{display:flex;flex-direction:column;gap:6px}',
      '.sd-label{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.sd-input{box-sizing:border-box;width:100%;min-height:96px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-family-code);font-size:13px;line-height:20px;resize:vertical}',
      '.sd-input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}',
      '.sd-actions{display:flex;align-items:center;gap:8px}',
      '.sd-primary,.sd-secondary{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 12px;border-radius:var(--dsw-radius-md);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.sd-primary{border:none;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.sd-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.sd-secondary{border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary)}',
      '.sd-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.sd-primary:disabled,.sd-secondary:disabled{opacity:.4;cursor:default}',
      '.sd-primary:focus-visible,.sd-secondary:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
    ].join('');

    // --- one fan-out for the forwarded Host invalidation, subscribed once in apply ---
    const documentListeners = new Set();
    function onDocumentUpdated(listener) {
      documentListeners.add(listener);
      return () => { documentListeners.delete(listener); };
    }

    // --- one namespace card: shows identity + edits its stored overrides ---
    function NamespaceCard(props) {
      const view = props.view;
      const t = props.t;
      const busy = props.busy === true;
      const [text, setText] = React.useState(() => JSON.stringify(view.user === undefined ? {} : view.user, null, 2));
      const [invalid, setInvalid] = React.useState(false);

      // Re-seed the editor when the Host revision moves (an external edit or our own write).
      React.useEffect(() => {
        setText(JSON.stringify(view.user === undefined ? {} : view.user, null, 2));
        setInvalid(false);
      }, [view.revision]);

      const submit = () => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (cause) {
          setInvalid(true);
          return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        props.onSave(view.ns, parsed);
      };

      const fieldId = 'sd-' + view.ns;
      return h('li', { className: 'sd-card' },
        h('div', { className: 'sd-head' },
          h('span', { className: 'sd-dot', 'data-writable': String(props.writable), 'aria-hidden': 'true' }),
          h('span', { className: 'sd-name' }, view.ns),
          h('span', { className: 'sd-tag' }, t('revision') + ' ' + String(view.revision)),
        ),
        h('div', { className: 'sd-field' },
          h('label', { className: 'sd-label', htmlFor: fieldId }, t('overrides')),
          h('textarea', {
            id: fieldId,
            className: 'sd-input',
            value: text,
            spellCheck: false,
            disabled: !props.writable || busy,
            'aria-invalid': invalid ? 'true' : undefined,
            onChange: (event) => { setText(event.target.value); },
          }),
        ),
        invalid ? h('p', { className: 'sd-error', role: 'alert' }, t('invalidJson')) : null,
        props.saveError === null || props.saveError === undefined
          ? null
          : h('p', { className: 'sd-error', role: 'alert' }, props.saveError),
        h('div', { className: 'sd-actions' },
          h('button', { type: 'button', className: 'sd-primary', disabled: !props.writable || busy, onClick: submit },
            busy ? t('saving') : t('save')),
          props.saved ? h('span', { className: 'sd-saved', role: 'status' }, t('saved')) : null,
        ),
      );
    }

    // --- the page: inject face supplies `settings` + `subscribeDocumentUpdates` ---
    function SettingsDemoSection(props) {
      const t = props.t === undefined ? ((key) => key) : props.t;
      const [status, setStatus] = React.useState('idle');
      const [view, setView] = React.useState(undefined);
      const [error, setError] = React.useState(null);
      const [busyNs, setBusyNs] = React.useState(null);
      const [savedNs, setSavedNs] = React.useState(null);
      const [saveErrorNs, setSaveErrorNs] = React.useState(null);
      const [saveError, setSaveError] = React.useState(null);

      const load = React.useCallback(() => {
        let live = true;
        setStatus((previous) => (previous === 'ready' ? previous : 'loading'));
        props.settings.describe().then((result) => {
          if (!live) return;
          if (result.ok) {
            setView(result.value);
            setError(null);
            setStatus('ready');
          } else {
            setError(result.error.message);
            setStatus('error');
          }
        }, (cause) => {
          if (!live) return;
          setError(String((cause && cause.message) || cause));
          setStatus('error');
        });
        return () => { live = false; };
      }, [props.settings]);

      React.useEffect(() => load(), [load]);
      React.useEffect(() => props.subscribeDocumentUpdates(() => { load(); }), [load, props.subscribeDocumentUpdates]);

      const save = (ns, overrides) => {
        const namespaces = view === undefined || view.namespaces === undefined ? [] : view.namespaces;
        const row = namespaces.find((candidate) => candidate.ns === ns);
        if (row === undefined) return;
        setBusyNs(ns);
        setSavedNs(null);
        setSaveError(null);
        setSaveErrorNs(null);
        // Path-op form (what models uses) is the alternative to replace():
        //   props.settings.mutate(ns, [{ op: 'set', path: ['someField'], value: 1 }], row.revision)
        props.settings.replace(ns, overrides, row.revision).then((result) => {
          if (result.ok) {
            setSavedNs(ns);
            setView((previous) => previous === undefined ? previous : {
              ...previous,
              namespaces: previous.namespaces.map((candidate) => candidate.ns === ns ? result.value : candidate),
            });
          } else {
            setSaveErrorNs(ns);
            setSaveError(result.error.message);
          }
        }, (cause) => {
          setSaveErrorNs(ns);
          setSaveError(String((cause && cause.message) || cause));
        }).then(() => { setBusyNs(null); });
      };

      const namespaces = view === undefined || view.namespaces === undefined ? [] : view.namespaces;
      const writable = view === undefined ? false : view.writable !== false;

      return h('div', { className: 'sd-section' },
        h('h2', { className: 'sd-title' }, t('title')),
        h('p', { className: 'sd-intro' }, t('intro')),
        h('div', { className: 'sd-toolbar' },
          h('button', {
            type: 'button',
            className: 'sd-secondary',
            disabled: status === 'loading',
            onClick: () => { load(); },
          }, t('refresh')),
        ),
        view !== undefined && view.writable === false ? h('p', { className: 'sd-notice' }, t('readOnly')) : null,
        status === 'error'
          ? h('div', { className: 'sd-field' },
              h('p', { className: 'sd-error', role: 'alert' }, t('loadFailed') + ': ' + String(error)),
              h('button', { type: 'button', className: 'sd-secondary', onClick: () => { load(); } }, t('retry')),
            )
          : null,
        status !== 'error' && view === undefined ? h('p', { className: 'sd-empty' }, t('loading')) : null,
        view !== undefined && namespaces.length === 0 ? h('p', { className: 'sd-empty' }, t('empty')) : null,
        namespaces.length === 0 ? null : h('ul', { className: 'sd-rows' },
          namespaces.map((row) => h(NamespaceCard, {
            key: row.ns,
            view: row,
            t: t,
            writable: writable,
            busy: busyNs === row.ns,
            saved: savedNs === row.ns,
            saveError: saveErrorNs === row.ns ? saveError : null,
            onSave: save,
          })),
        ),
      );
    }

    return {
      // Service gating only: `slots` (ledger), `locale` (dictionaries + t seat),
      // `remote` + `remote.settings` (the settings namespace this page reads/writes).
      inject: ['slots', 'locale', 'remote', 'remote.settings'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), LOG + ': dictionaries');

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/settings-demo';
          tag.dataset.pluginCss = STYLE_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => { tag.remove(); };
        }, LOG + ': styles');

        // Forwarded Host invalidation. $on needs connection.interactions === 'answer';
        // a display-only page must still load when it is unavailable.
        ctx.effect(() => {
          let off = function () {};
          try {
            off = ctx.remote.$on('settings/document-updated', () => {
              for (const listener of [...documentListeners]) listener();
            });
          } catch (cause) {
            off = function () {};
          }
          return () => { off(); };
        }, LOG + ': settings invalidation');

        // settings.section is declared by the settings shell; inject() waits for that declaration
        // and disposes the contribution with this plugin's fiber.
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'settings-demo',        // fresh id: reusing a shipped id throws at priority 0
          order: 12,                  // between models (10) and plugins (15); use -1000 to land first
          label: () => t('nav'),      // read on every projection, so locale switches follow
          locale: NS,                 // supplies the framework `t` prop
          inject: () => ({
            settings: ctx.remote.settings,
            subscribeDocumentUpdates: onDocumentUpdated,
          }),
        }, SettingsDemoSection));
      },
    };
  },
});
```

Verify the file before installing: `node --check client.js` and
`Get-Content package.json | ConvertFrom-Json` (or `node -e "JSON.parse(...)"`). Install the
directory with `plugin_manager { action: 'install_bundle', target: '<abs dir>' }`; only an
`application: applied` result (plus a later Client Inspect read of `settings.section`) counts as
success. Note the skill's rules: do not hand-write the profile's `package.json`/
`cordis.patch.yml`, and every `plugin_manager` call needs approval outside Full access.

#### Safety notes on the skeleton's `replace()` save

`describe()` is redacted: a field whose schema carries `meta.role === "secret"` is **removed**
from `value`/`user`/`base` and reported as `secrets: [{ path, set }]`
(`$PKG\dsh-settings\lib\index.js:22-44`, `:73-89`). Consequences:

* Never echo a whole `user` object back with `replace()` for a namespace that has secret fields —
  you would write a user section that no longer overrides them. For such a namespace use
  `mutate()` with `[{op:'set', path:[...], value}]` for each **non-secret** field you edited, and
  leave secrets to `ctx.remote.credentials` (what models does: `:3172-3180`).
* `replace()` merges into the inherited base (`$PKG\dsh-settings\lib\index.js:479-482`), so the
  skeleton's “save the overrides JSON” is safe for ordinary fields and is the simplest generic
  demo; it is not a general-purpose settings editor.
* Writes are refused for non-volatile paths (`:501-507`); always surface
  `result.error.message` instead of assuming success.

### 8.7 Variations

* **Conditional page** (only when the Host serves a namespace):
  `ctx.configForms.whileServed(['agent-loop'], () => ctx.slots.inject('settings.section', () => ctx.slots.register(opts, Page)))`
  — `ctx.configForms` requires `configForms` in `inject` (agent-loop `:139-143`, `:158-165`).
* **Shared store instead of `useState`**: keep the controller in `apply`, expose
  `hooks: { snapshot: controller.store }` and read `props.useSnapshot((s) => s)` (models
  `:4445-4451`, `:2338-2340`). This survives section switches because the store lives on the
  plugin fiber, not on the component.
* **Header button instead of an in-page one**: register a second entry into `settings.action`
  (`{ name:'settings.action', id, order }`, kind list, catalog `:4889-4899`).
* **Prefer the shared mirror**: replace `props.settings.describe()` with
  `ctx.configForms.describe()` (snapshot `{status, view}`) to avoid a second `settings.describe`
  reader.

---

## 9. Evidence index (file:line)

| Topic | Location |
|---|---|
| `settings.section` catalog, owner props, occupants, example | `$PKG\dsh-cordis-client-runner\lib\client.js:5291-5343` |
| `settings.action` catalog | same `:4889-4899` |
| `settings.general.item` catalog | same `:4965-4990` |
| Slot type declarations (`SlotComponent`, `SlotCore` surface, `SlotInjectFace`, `PropsRuntime`, `PropsSlotHooks`) | same `:2221-2270`, `:2049-2079` |
| `settings.onboarding` owner props (`openSection`) | same `:5215-5226` |
| Models registration / inject / dictionaries / subscriptions | `$PKG\dsh-client-ui-settings-models\lib\client.js:4485-4501`, `:4417-4427`, `:4437-4440`, `:4445-4451`, `:4467-4484` |
| Models component + props | same `:2324-2340` |
| Models remote calls | same `:1340-1344`, `:1383`, `:3172-3180`, `:4472-4478` |
| Models CSS (buttons, input, card, dot, notice, empty) | same `:58` (extracted rules quoted in §5) |
| General registration / shell children / render call / active default / nav | `$PKG\dsh-client-ui-settings-general\lib\client.js:1293-1303`, `:1233-1268`, `:337`, `:276`, `:305-317`, `:1138-1162` |
| General shell store (`open`, `close`, `select`, `openSection`) | same `:19-42` |
| General `useModalLayer` + dialog markup | same `:279-341` |
| Plugins section registration / inject / tabs a11y | `$PKG\dsh-client-ui-settings-plugins\lib\client.js:201-212`, `:162`, `:176-200`, `:69-126` |
| Agent-loop `whileServed` + `configForms.get` | `$PKG\dsh-client-ui-settings-agent-loop\lib\client.js:139-165` |
| Account order -10 / agent-presets order 20 | `$PKG\dsh-client-ui-settings-account\lib\client.js:4777-4783`; `$PKG\dsh-client-ui-agent-preset\lib\client.js:2455-2461` |
| Props composition order, kit, hooks→`use*`, `t` seat | `$PKG\dsh-client-ui-renderer\lib\client.js:773-810`, `:736-767`, `:444-459`, `:219-226`, `:542-558` |
| Error boundary / abdication | same `:631-646`; `$PKG\dsh-cordis-client-runner\lib\client.js:421-435` |
| `slots.register`/`inject`/`snapshot`/`onEntryError` service | same `:1813-1820`, `:1368-1427`, `:1557-1564`, `:1574-1576` |
| `SlotCore` register validation (runtime messages) | `$PKG\dsh-web-frontend\dist\assets\index-CN7NIWNw.js@485027` |
| Baseline module table | same `@916075` |
| `Switch` / `Modal` / `useModalLayer` / focusable selector / `Button` / `Input` / `Checkbox` / `Tag` / `StateDot` / `SegmentedControl` | same `@642543`, `@666238`, `@647288`, `@647160`, `@640338`, `@644393`, `@644128`, `@641802`, `@637591`, `@643190` |
| Switch/tag/dot CSS | `$PKG\dsh-web-frontend\dist\assets\index-BxpfOGf3.css` (`_switch_1ik0f_5`, `_tag_brmue_4`, `_dot_1i3xo_2`) |
| Settings namespace API + `NamespaceView` | `$PKG\dsh-api-settings-controller\lib\index.js:274-289`, `:393-435`, `:501-508` |
| Settings path-op/volatility rules | `$PKG\dsh-settings\lib\index.js:488-507` |
| `configForms`/`settingsSchema` services, mirror, `whileServed` | `$PKG\dsh-client-ui-settings\lib\client.js:923-926`, `:1252-1334`, `:1353-1462` |
| Remote result shape, `$on` | `$PKG\dsh-api-gateway\README.md:60`, `:66` |
| Locale registration forms / fallback | `$PKG\dsh-client-locale\README.md:32`, `:40-58` |
| Plugin route + revision match | `$PKG\dsh-client-modules\lib\index.js:202-222`, `:563-569`, `:933-950`, `:977-989`; `README.md:38`, `:50` |
| Launch-token auth / 401 | `$PKG\dsh-client-connection\lib\index.js:435-484` |
| Display metadata checklist | `…\dsh-agent-preset\skills\cordis-plugin-development\references\host-plugin.md:31-53` |
| UI plugin rules (styles via `ctx.effect`, factories side-effect free) | same skill `references\ui-plugin.md:7-13` |
| Verification rules (no primitives import, no mock pages) | same skill `references\verification.md:3-7` |

### 9.1 Negative results (checked, do not exist)

* No `--dsw-space-*` / padding scale tokens; spacing is literal px in every shipped stylesheet.
* No `--ds-font-family-code` token (models' typo); the real one is `--dsh-font-family-code`.
* No public API for a section to open another section: `openSection` is owner props of
  `settings.onboarding` only.
* `ctx.slots.inject` is not `ctx.inject`; the latter is the optional-service helper.
* Client Inspect is unavailable without a connected page; the GUI's HTTP surface is
  token-gated (401), so there is no unauthenticated read API for registrations.
