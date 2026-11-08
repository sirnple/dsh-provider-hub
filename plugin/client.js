/**
 * Browser half of the "Model Providers & Accounts" settings pages.
 *
 * The first page is a `settings.section` list entry: it reads the profile
 * settings namespaces `provider-accounts` (this bundle's own Host Config) and
 * `llm-pi-ai` (the live pi-ai route table), plus write-only credentials, and
 * writes both namespaces through `ctx.remote.settings.mutate`.
 *
 * The second page, "用量与余额 / Usage & balance", is the read-only sibling: it
 * fetches the Host's usage ledger and provider balances over two same-origin
 * HTTP routes on the `/api` bridge, polls while mounted, and holds no Remote
 * namespace at all.
 *
 * Nothing here imports a bundler artifact: React comes from the page's static
 * module registry, and the stylesheet is injected as one tagged <style> tag
 * with every class prefixed `pa-` (the providers page) or `pu-` (usage).
 */
window.__ModuleLoader__.load({
	id: 'dsh-provider-hub',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		/**
		 * react-dom is offered by the page's static module registry so a dialog
		 * can escape the settings panel's stacking and overflow context. It is
		 * optional: without it the overlay still renders in place.
		 */
		const reactDom = (() => {
			try {
				const module = require('react-dom')
				if (module !== null && typeof module === 'object' && typeof module.createPortal === 'function') return module
				const fallback = module?.default
				return fallback !== null && typeof fallback === 'object' && typeof fallback.createPortal === 'function' ? fallback : undefined
			} catch {
				return undefined
			}
		})()

		/** Settings namespace owned by this bundle's Host half (the profile entry id). */
		const NS = 'provider-accounts'
		/** Locale dictionary namespace owned by this plugin. */
		const LOCALE_NS = 'provider-accounts'
		/** Settings namespace holding the pi-ai route table. */
		const LLM_NS = 'llm-pi-ai'
		/** Credential references are POSIX shell identifiers, as the Host resolver requires. */
		const ACCOUNT_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
		/** Lowercase slug for a hand-declared route id. */
		const CUSTOM_ID_PATTERN = /^[a-z][a-z0-9-]*$/
		/** Printable ASCII, space excluded (twin of the Models page rule). */
		const LEGAL_API_KEY = /^[\x21-\x7E]+$/
		/**
		 * A pasted `NAME=value` environment line. Two narrowings keep real keys
		 * clear of it: the name must be upper-case, so `sk-` forms break at the
		 * hyphen, and the `=` must be followed by something other than another
		 * `=`, so base64 padding is not mistaken for an assignment.
		 */
		const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/
		/** pi-ai route ids offered by the add-provider catalog. Verified against pi-ai's provider modules. */
		const PRESETS = [
			{ id: 'opencode-go', name: 'OpenCode Go', env: 'OPENCODE_API_KEY', balanceKind: 'opencode-zen' },
			{ id: 'openai', name: 'OpenAI', env: 'OPENAI_API_KEY' },
			{ id: 'anthropic', name: 'Anthropic', env: 'ANTHROPIC_API_KEY' },
			{ id: 'deepseek', name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', balanceKind: 'deepseek' },
			{ id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY', balanceKind: 'openrouter' },
			{ id: 'google', name: 'Google', env: 'GEMINI_API_KEY' },
			{ id: 'groq', name: 'Groq', env: 'GROQ_API_KEY' },
			{ id: 'mistral', name: 'Mistral', env: 'MISTRAL_API_KEY' },
			{ id: 'xai', name: 'xAI', env: 'XAI_API_KEY' },
			{ id: 'grok-build', name: 'Grok Build (OAuth)', env: 'GROK_BUILD_OAUTH', oauth: true },
			{ id: 'zai', name: 'Z.AI', env: 'ZAI_API_KEY' },
			{ id: 'zai-coding-cn', name: 'Z.AI Coding CN', env: 'ZAI_CODING_CN_API_KEY' },
			{ id: 'moonshotai', name: 'Moonshot AI', env: 'MOONSHOT_API_KEY' },
			{ id: 'kimi-coding', name: 'Kimi For Coding', env: 'KIMI_API_KEY' },
			{ id: 'qwen-token-plan', name: 'Qwen Token Plan', env: 'QWEN_TOKEN_PLAN_API_KEY' },
			{ id: 'minimax', name: 'MiniMax', env: 'MINIMAX_API_KEY' },
			{ id: 'cerebras', name: 'Cerebras', env: 'CEREBRAS_API_KEY' },
			{ id: 'together', name: 'Together', env: 'TOGETHER_API_KEY' },
			{ id: 'fireworks', name: 'Fireworks', env: 'FIREWORKS_API_KEY' },
			{ id: 'nvidia', name: 'NVIDIA', env: 'NVIDIA_API_KEY' },
			{ id: 'huggingface', name: 'Hugging Face', env: 'HF_TOKEN' },
		]
		/** The three API protocols pi-ai accepts for a hand-declared route. */
		const PROTOCOLS = [
			{ value: 'openai-completions', key: 'protocolOpenAiCompletions' },
			{ value: 'openai-responses', key: 'protocolOpenAiResponses' },
			{ value: 'anthropic-messages', key: 'protocolAnthropicMessages' },
		]
		/** Capacity defaults pi-ai applies to a hand-declared model with no numbers of its own. */
		const DEFAULT_CONTEXT_WINDOW = 262144
		const DEFAULT_MAX_TOKENS = 32768
		/** Credentials describe accepts at most this many references per call. */
		const CREDENTIALS_CHUNK = 64
		/** Exact Fetch route serving the usage ledger snapshot; authenticated and same-origin. */
		const USAGE_URL = '/api/provider-accounts-usage'
		/** Exact Fetch route that re-probes provider balances and answers with a fresh snapshot. */
		const BALANCE_URL = '/api/provider-accounts-balance'
		const TEST_URL = '/api/provider-accounts-test'
		const GROK_URL = '/api/provider-accounts-grok'
		/** Provider id the plugin's own adapter serves. */
		const GROK_PROVIDER = 'grok-build'
		/** Credential reference holding the OAuth bundle. */
		const GROK_REF = 'GROK_BUILD_OAUTH'
		/** How often a mounted usage page re-reads the snapshot. */
		const USAGE_POLL_MS = 15_000
		/** How long a balance-refresh status line stays on screen. */
		const BALANCE_STATUS_MS = 8_000
		/** Days drawn by one account's inline bar chart. */
		const CHART_DAYS = 14
		/** Trailing days summed into the "last 7 days" metric. */
		const RECENT_DAYS = 7
		/** Balance field keys the page localizes; any other key is shown verbatim. */
		const BALANCE_FIELD_KEYS = {
			balance: 'balanceFieldBalance',
			granted: 'balanceFieldGranted',
			toppedUp: 'balanceFieldToppedUp',
			status: 'balanceFieldStatus',
			rolling: 'balanceFieldRolling',
			weekly: 'balanceFieldWeekly',
			monthly: 'balanceFieldMonthly',
			rollingReset: 'balanceFieldRollingReset',
			weeklyReset: 'balanceFieldWeeklyReset',
			monthlyReset: 'balanceFieldMonthlyReset',
			rollingStatus: 'balanceFieldRollingStatus',
			weeklyStatus: 'balanceFieldWeeklyStatus',
			monthlyStatus: 'balanceFieldMonthlyStatus',
			fiveHourSpend: 'balanceFieldFiveHourSpend',
			weeklySpend: 'balanceFieldWeeklySpend',
			monthlySpend: 'balanceFieldMonthlySpend',
			used: 'balanceFieldUsed',
			limit: 'balanceFieldLimit',
			remaining: 'balanceFieldRemaining',
			resetAt: 'balanceFieldResetAt',
			expiresAt: 'balanceFieldExpiresAt',
		}
		/**
		 * The quota meter ids the page draws, in the order one account lists them,
		 * and the dictionary key naming each one. A meter with any other id is
		 * dropped: the textual `fields` of the same entry still carry it.
		 */
		const GAUGE_IDS = ['fiveHour', 'weekly', 'monthly', 'credits']
		const GAUGE_LABEL_KEYS = {
			fiveHour: 'gaugeFiveHour',
			weekly: 'gaugeWeekly',
			monthly: 'gaugeMonthly',
			credits: 'gaugeCredits',
		}
		/** The fill class of one gauge tone; the tone itself comes from {@link gaugeTone}. */
		const GAUGE_TONE_CLASS = {
			ok: 'pu-gaugeFillOk',
			warn: 'pu-gaugeFillWarn',
			danger: 'pu-gaugeFillDanger',
		}

		//#region stylesheet
		const CSS = `
.pa-section{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.pa-head{display:flex;align-items:flex-start;gap:12px}
.pa-headText{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.pa-title{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.pa-intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.pa-notice{margin:0;color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}
.pa-savedNotice{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
.pa-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.pa-routeError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.pa-list{display:flex;flex-direction:column;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.pa-card{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}
.pa-cardHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pa-name{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.pa-chip{flex:none;padding:1px 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
.pa-dot{box-sizing:border-box;display:inline-block;flex:none;width:8px;height:8px;border-radius:50%}
.pa-dotOn{background:var(--dsw-alias-state-success-primary)}
.pa-dotOff{background:var(--dsw-alias-state-error-primary)}
.pa-badge{flex:none;padding:0 5px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:16px}
.pa-accountList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.pa-account{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg)}
.pa-accountIdentity{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.pa-accountLabel{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.pa-ref{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.pa-rowActions{display:inline-flex;align-items:center;gap:4px;flex:none;margin-left:auto}
.pa-cardActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pa-btnPrimary,.pa-btnSecondary,.pa-btnDanger,.pa-btnLink{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.pa-btnPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.pa-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.pa-btnSecondary{border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary)}
.pa-btnSecondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.pa-btnDanger{background:0 0;color:var(--dsw-alias-state-error-primary)}
.pa-btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.pa-btnLink{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.pa-btnLink:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.pa-btnPrimary:disabled,.pa-btnSecondary:disabled,.pa-btnDanger:disabled,.pa-btnLink:disabled{opacity:.4;cursor:default}
.pa-btnPrimary:focus-visible,.pa-btnSecondary:focus-visible,.pa-btnDanger:focus-visible,.pa-btnLink:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.pa-btnSmall{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}
.pa-field{display:flex;flex-direction:column;gap:6px}
.pa-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.pa-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.pa-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}
select.pa-input{cursor:pointer;max-width:240px}
.pa-input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}
.pa-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.pa-input:disabled{opacity:.6;cursor:default}
.pa-keyWrap{position:relative}
.pa-keyFilled{padding-right:40px}
.pa-keyToggle{position:absolute;inset:1px 1px 1px auto;display:inline-flex;align-items:center;justify-content:center;width:32px;padding:0;border:none;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}
.pa-keyToggle:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.pa-keyToggle:disabled{opacity:.6;cursor:default}
.pa-keyToggle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.pa-advanced{display:flex;flex-direction:column;gap:10px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.pa-disclosure{display:inline-flex;align-items:center;gap:6px;width:fit-content;padding:2px 4px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;line-height:18px;cursor:pointer}
.pa-disclosure:hover{color:var(--dsw-alias-label-primary)}
.pa-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.pa-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.pa-dialog{position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:min(520px,100%);max-height:calc(100dvh - 48px);overflow:hidden;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.pa-dialog:focus{outline:none}
.pa-dialogContent{display:flex;flex-direction:column;gap:16px;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.pa-dialogHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 0 24px}
.pa-dialogTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.pa-close{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}
.pa-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pa-close:disabled{opacity:.5;cursor:default}
.pa-dialogDesc{margin:0;padding:0 24px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.pa-dialogBody{display:flex;flex-direction:column;gap:14px;min-width:0;padding:0 24px}
.pa-dialogActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px 24px}
.pa-tabs{display:inline-flex;align-self:flex-start;gap:4px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}
.pa-tab{padding:5px 10px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.pa-tab[data-active=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.pa-tab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.pa-candidateList{display:flex;flex-direction:column;gap:2px;max-height:240px;margin:0;padding:0;overflow-y:auto;list-style:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg)}
.pa-candidate{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:none;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.pa-candidate:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pa-candidate[data-active=true]{background:var(--dsw-alias-interactive-bg-active)}
.pa-candidateName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa-candidateMeta{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
.pa-modelList{display:flex;flex-direction:column;gap:4px;max-height:180px;margin:0;padding:8px 10px;overflow-y:auto;list-style:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}
.pa-modelRow{display:flex;align-items:baseline;gap:8px;min-width:0}
.pa-modelId{overflow:hidden;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.pa-modelMeta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.pa-emptyCard{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg)}
.pa-cardTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}
.pa-failoverCard{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}
.pa-switchRow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pa-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.pa-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.pa-switch:disabled{cursor:default;opacity:.5}
.pa-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.pa-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.pa-switch[aria-checked=false] .pa-thumb{background:var(--dsw-alias-switch-thumb)}
.pa-switch[aria-checked=true] .pa-thumb{transform:translate(16px)}
.pa-codeChips{display:flex;flex-wrap:wrap;gap:4px}
.pa-code{padding:1px 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
.pa-importList{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.pa-importRow{display:flex;align-items:center;gap:8px;min-width:0}
.pa-check{display:flex;align-items:flex-start;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
.pa-check input{margin:3px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.pa-testLine{display:flex;align-items:center;gap:6px;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.pa-testOk{color:var(--dsw-alias-state-success-primary)}
.pa-testError{color:var(--dsw-alias-state-error-primary)}
.pa-hud{display:inline-flex;flex:0 1 auto;align-items:center;gap:6px;min-width:0;max-width:100%;overflow:hidden;padding:3px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;white-space:nowrap;cursor:pointer}
.pa-hud:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pa-hud[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}
.pa-hud:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pa-hudEmpty{overflow:hidden;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis}
.pa-hudGroup{display:inline-flex;flex:none;align-items:center;gap:4px;min-width:0}
.pa-hudStack{display:inline-flex;flex:none;flex-direction:column;gap:2px;width:18px}
.pa-hudBar{display:block;height:3px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-border-l2)}
.pa-hudBarFill{display:block;height:100%;border-radius:inherit;transition:width .2s ease}
.pa-hudCaret{flex:none;color:var(--dsw-alias-label-tertiary)}
.pa-hudPanel{position:fixed;z-index:60;width:min(560px,94vw);max-height:min(72vh,660px);overflow:auto;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-alias-elevation-prominent);overscroll-behavior:contain}
.pa-hudPanel .pa-section{max-width:none}
.pu-pop{display:flex;flex-direction:column;gap:8px;min-width:0}
.pu-popHead{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.pu-popTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}
.pu-popActions{display:flex;flex:none;align-items:center;gap:6px}
.pu-popMeta{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.pu-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.pu-blockHead{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;padding-top:6px;border-top:.5px solid var(--dsw-alias-border-l1)}
.pu-blockName{overflow:hidden;max-width:180px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.pu-rows{display:flex;flex-direction:column;gap:6px;min-width:0;margin:0;padding:0;list-style:none}
.pu-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md)}
.pu-rowLabel{overflow:hidden;max-width:160px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.pu-quota{display:flex;flex-wrap:wrap;align-items:center;gap:3px 10px;min-width:0}
.pu-meter{display:inline-flex;align-items:center;gap:4px}
.pu-meterTag{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}
.pu-track{display:block;width:42px;height:4px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-border-l2)}
.pu-fill{display:block;height:100%;border-radius:inherit;transition:width .2s ease}
.pu-pct{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums}
.pu-chip{flex:none;padding:0 5px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:10px;line-height:15px}
.pu-usage{display:flex;align-items:center;gap:8px;min-width:0;width:100%}
.pu-usageText{overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.pu-spark{display:block;flex:none;width:56px;height:14px;margin-left:auto}
.pu-sparkBar{fill:var(--dsw-alias-state-business-primary)}
.pu-sparkEmpty{fill:var(--dsw-alias-border-l2)}
.pu-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.pu-warn{margin:0;color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}
.pu-empty{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
@media (prefers-reduced-motion:reduce){.pa-thumb{transition:none}.pu-fill{transition:none}}
.pa-grokDetail{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}
.pa-grokStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.pa-accountUsage{display:flex;flex-direction:column;gap:2px;min-width:0;max-width:100%}
.pa-usageMeters{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-width:0}
.pa-usageMeters .pu-track{width:88px}
.pa-usageText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.pa-usageWarn{color:var(--dsw-alias-label-warning);font-size:12px;line-height:18px}
.pa-grokCode{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;min-width:0}
.pa-grokCodeValue{padding:2px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:15px;letter-spacing:1px}
.pa-switcher{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0}
.pa-switcherLabel,.pa-switcherHint{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.pa-switcherButtons{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.pa-switchBtn{max-width:220px;overflow:hidden;padding:2px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.pa-switchBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pa-switchActive{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pa-switchBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pa-switchBtn:disabled{cursor:default;opacity:.6}
.pa-routeRepair{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pu-gaugeFillOk{background:var(--dsw-alias-state-success-primary)}
.pu-gaugeFillWarn{background:var(--dsw-alias-state-warn-label)}
.pu-gaugeFillDanger{background:var(--dsw-alias-state-error-primary)}
`
		const CSS_TAG_ID = 'dsh-provider-hub/client.css'
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') === null) {
			const tag = document.createElement('style')
			tag.dataset.plugin = 'dsh-provider-hub'
			tag.dataset.pluginCss = CSS_TAG_ID
			tag.textContent = CSS
			document.head.appendChild(tag)
		}
		//#endregion

		//#region small helpers
		/** Compose class names, dropping falsy entries. */
		function cx(...values) {
			return values.filter((value) => typeof value === 'string' && value.length > 0).join(' ')
		}
		/** A string or undefined, for values read out of untyped settings JSON. */
		function asString(value) {
			return typeof value === 'string' ? value : undefined
		}
		/** A positive integer or undefined. */
		function positiveInteger(value) {
			return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
		}
		/** The message of a thrown value, as text a Host error card may show. */
		function messageOf(error) {
			if (error instanceof Error && error.message.length > 0) return error.message
			return String(error)
		}
		/** Fill `{placeholder}` slots in an already-translated template. */
		function copy(template, values) {
			return String(template).replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(values, key) ? String(values[key]) : match))
		}
		/** Whether a typed API key is acceptable; `undefined` means allow. */
		function apiKeyFailure(draft) {
			if (draft.length === 0) return undefined
			const value = draft.trim()
			if (value.length === 0) return 'keyBlank'
			if (ENV_LINE.test(value)) return 'keyIllegalCharacters'
			const first = value[0]
			if ((first === '"' || first === "'" || first === '`') && value.length > 1 && value.endsWith(first)) return 'keyIllegalCharacters'
			if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
			return undefined
		}
		/** The default credential reference name for a route id: `<ROUTE>_API_KEY`. */
		function refFromRoute(routeId) {
			return `${String(routeId).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
		}
		/**
		 * A credential reference for one more account of a provider. Accounts of the
		 * same provider must not share a reference — that would silently make two
		 * "accounts" read the same stored key — so a taken name takes the next free
		 * numeric suffix: `OPENCODE_GO_API_KEY`, `OPENCODE_GO_2_API_KEY`, …
		 * @param provider - the provider gaining an account.
		 * @param route - the provider's current `llm-pi-ai` route profile, if any.
		 * @returns {string} an unused reference name.
		 */
		function nextAccountRef(provider, route) {
			const base = refFromRoute(provider?.id ?? '')
			const taken = new Set((provider?.accounts ?? []).map((account) => account.ref))
			const liveRef = asString(route?.apiKeyEnv)
			if (liveRef !== undefined) taken.add(liveRef)
			if (!taken.has(base)) return base
			const stem = base.replace(/_API_KEY$/, '')
			for (let index = 2; index < 1000; index += 1) {
				const candidate = `${stem}_${index}_API_KEY`
				if (!taken.has(candidate)) return candidate
			}
			return `${stem}_${Date.now()}_API_KEY`
		}
		/** The suggested account label: the first account is primary, later ones are numbered. */
		function defaultAccountLabel(t, provider) {
			const count = provider?.accounts?.length ?? 0
			// `t()` returns the raw dictionary string; `copy` is what fills `{n}`.
			return count === 0 ? t('primaryAccountLabel') : copy(t('accountLabelN'), { n: count + 1 })
		}
		/** Whether an endpoint is an absolute http(s) URL. */
		function isHttpUrl(value) {
			if (!/^https?:\/\//i.test(value)) return false
			try {
				const url = new URL(value)
				return url.protocol === 'http:' || url.protocol === 'https:'
			} catch {
				return false
			}
		}
		/** A fresh account id that is unique inside its provider. */
		function makeAccountId(providerId, accounts) {
			const base = String(providerId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'account'
			const used = new Set(accounts.map((account) => account.id))
			let index = accounts.length + 1
			let candidate = `${base}-a${index}`
			while (used.has(candidate)) {
				index += 1
				candidate = `${base}-a${index}`
			}
			return candidate
		}
		/** One account row, keeping every field the config schema declares. */
		function plainAccount(account) {
			return { id: account.id, label: account.label, ref: account.ref }
		}
		/** One model row as pi-ai and this bundle's Host Config both declare it. */
		function plainModel(model) {
			const next = { id: model.id, name: model.name }
			if (model.contextWindow !== undefined) next.contextWindow = model.contextWindow
			if (model.maxTokens !== undefined) next.maxTokens = model.maxTokens
			if (model.input !== undefined) next.input = [...model.input]
			return next
		}
		/** Read a stored model row back into the normalized shape the page edits. */
		function normalizeModel(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const id = asString(raw.id)
			if (id === undefined) return undefined
			const model = { id, name: asString(raw.name) ?? id }
			const contextWindow = positiveInteger(raw.contextWindow)
			if (contextWindow !== undefined) model.contextWindow = contextWindow
			const maxTokens = positiveInteger(raw.maxTokens)
			if (maxTokens !== undefined) model.maxTokens = maxTokens
			const input = Array.isArray(raw.input) ? raw.input.filter((entry) => entry === 'text' || entry === 'image') : undefined
			if (input !== undefined && input.length > 0) model.input = input
			return model
		}
		/** Read a stored model list; `undefined` when it holds nothing usable. */
		function normalizeModels(list) {
			if (!Array.isArray(list)) return undefined
			const models = list.map(normalizeModel).filter((model) => model !== undefined)
			return models.length > 0 ? models : undefined
		}
		/** Turn a discovery result into the stored model shape, defaulting capacities pi-ai would default too. */
		function discoveredModel(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const id = asString(raw.id)
			if (id === undefined) return undefined
			const input = Array.isArray(raw.inputModalities) ? raw.inputModalities.filter((entry) => entry === 'text' || entry === 'image') : []
			return {
				id,
				name: asString(raw.name) ?? id,
				contextWindow: positiveInteger(raw.contextWindow) ?? DEFAULT_CONTEXT_WINDOW,
				maxTokens: positiveInteger(raw.maxTokens) ?? DEFAULT_MAX_TOKENS,
				input: input.length > 0 ? input : ['text'],
			}
		}
		/** One account row from stored settings, or `undefined` when it names no reference. */
		function normalizeAccount(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const ref = asString(raw.ref)
			if (ref === undefined || ref.length === 0) return undefined
			return { id: asString(raw.id) ?? ref, label: asString(raw.label) ?? ref, ref }
		}
		/** One provider card from stored settings. Malformed entries degrade instead of throwing. */
		function normalizeProvider(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const id = asString(raw.id)
			if (id === undefined || id.length === 0) return undefined
			const provider = { id, name: asString(raw.name) ?? id, catalog: raw.catalog === true, accounts: [] }
			const api = asString(raw.api)
			if (api !== undefined && api.length > 0) provider.api = api
			const baseURL = asString(raw.baseURL)
			if (baseURL !== undefined && baseURL.length > 0) provider.baseURL = baseURL
			const models = normalizeModels(raw.models)
			if (models !== undefined) provider.models = models
			if (Array.isArray(raw.accounts)) provider.accounts = raw.accounts.map(normalizeAccount).filter((account) => account !== undefined)
			return provider
		}
		/** The pi-ai route table, as a plain dict. */
		function normalizeRoutes(value) {
			const routes = {}
			if (value === null || typeof value !== 'object' || Array.isArray(value)) return routes
			for (const [id, profile] of Object.entries(value)) {
				routes[id] = profile !== null && typeof profile === 'object' && !Array.isArray(profile) ? profile : {}
			}
			return routes
		}
		/** The failover block, defaulted so the footer renders before any write. */
		function normalizeFailover(raw) {
			const value = raw !== null && typeof raw === 'object' ? raw : {}
			return {
				enabled: value.enabled === true,
				codes: Array.isArray(value.codes) ? value.codes.filter((code) => typeof code === 'string') : [],
				maxHops: typeof value.maxHops === 'number' && Number.isFinite(value.maxHops) ? value.maxHops : undefined,
			}
		}
		/** Every distinct credential reference a provider list mentions. */
		function collectRefs(providers) {
			const seen = new Set()
			for (const provider of providers) for (const account of provider.accounts) if (!seen.has(account.ref)) seen.add(account.ref)
			return [...seen]
		}
		/** Whether a reference is still used by an account other than the one being changed. */
		function refUsedElsewhere(providers, ref, skipProviderIndex, skipAccountIndex) {
			return providers.some((provider, providerIndex) => provider.accounts.some((account, accountIndex) => account.ref === ref && !(providerIndex === skipProviderIndex && accountIndex === skipAccountIndex)))
		}
		/** Whether a credential reference currently resolves to a key. */
		function credentialConfigured(credentials, ref) {
			return credentials !== null && typeof credentials === 'object' && credentials[ref]?.configured === true
		}
		/** The route profile written when a page-created route has no `llm-pi-ai` entry yet. */
		function routeProfileFor(provider, ref) {
			const profile = { apiKeyEnv: ref }
			if (typeof provider?.name === 'string' && provider.name.length > 0) profile.displayName = provider.name
			if (provider.api !== undefined) profile.api = provider.api
			if (provider.baseURL !== undefined) profile.baseURL = provider.baseURL
			if (provider.models !== undefined) profile.models = provider.models.map(plainModel)
			return profile
		}
		/** A router route id for a new custom provider is unique across both namespaces. */
		function routeIdTaken(providers, routes, id) {
			return providers.some((provider) => provider.id === id) || Object.hasOwn(routes, id)
		}
		//#endregion

		//#region locales
		/** English strings (the key-set source of truth for this pair). */
		const en = {
			nav: 'Model providers',
			title: 'Model providers and accounts',
			intro: 'Manage the model providers this profile can use, store one API key per account, and choose the account in use.',
			refresh: 'Refresh',
			refreshing: 'Refreshing…',
			loading: 'Loading…',
			loadFailed: 'Loading the provider settings failed',
			retry: 'Retry',
			readOnly: 'The settings document is read-only in this deployment.',
			namespaceMissing: 'This page needs the provider-accounts settings entry, which the Host half of this bundle declares. It is not mounted, so nothing can be read or written here yet.',
			saved: 'Saved',
			conflict: 'These settings were changed elsewhere. Please try again.',
			close: 'Close',
			cancel: 'Cancel',
			saving: 'Saving…',
			credentialConfigured: 'API key configured',
			credentialMissing: 'API key missing',
			activeAccount: 'Current',
			switchAccount: 'Switch account',
			switchGroupLabel: 'Accounts of {provider}',
			switchHint: 'takes effect on the next model request',
			switchedTo: 'Switched to {account}.',
			activate: 'Use',
			test: 'Test',
			testing: 'Testing…',
			edit: 'Edit',
			remove: 'Delete',
			addAccount: 'Add account',
			addAccountTitle: 'Add an account',
			editAccountTitle: 'Edit the account',
			accountLabel: 'Account name',
			accountLabelPlaceholder: 'e.g. Personal, Team shared',
			accountKey: 'API key',
			accountKeyPlaceholder: 'Enter your API key',
			accountKeyKeep: 'Leave blank to keep the stored key',
			accountRef: 'Credential reference name',
			accountRefHint: 'Only letters, digits, and underscores; it must start with a letter or an underscore.',
			advanced: 'Advanced options',
			labelRequired: 'An account name is required.',
			refInvalid: 'The credential reference name must match [A-Za-z_][A-Za-z0-9_]*, like OPENCODE_GO_API_KEY.',
			refDuplicate: 'Another account of this provider already uses that reference name.',
			keyRequired: 'Enter the API key.',
			keyBlank: 'Enter the API key.',
			keyIllegalCharacters: 'This API key is not in a valid format. Please check it.',
			keyReveal: 'Show secret',
			keyHide: 'Hide secret',
			saveAccount: 'Save account',
			accountAdded: 'Account added.',
			accountSaved: 'Account saved.',
			removeAccountTitle: 'Delete this account?',
			removeAccountDescription: 'The account is removed from {provider}. Its saved key stays unless you also delete it.',
			removeAccountConfirm: 'Delete account',
			removeProvider: 'Delete provider',
			removeProviderTitle: 'Delete {provider}?',
			removeProviderDescription: 'Deleting {provider} removes its provider entry and its llm-pi-ai route, so its models stop being offered. Saved keys stay unless you also delete them.',
			removeProviderConfirm: 'Delete provider',
			providerRemoved: 'Provider deleted.',
			removeCredential: 'Also delete the saved keys',
			removeCredentialHint: 'A key still used by another account is kept.',
			testOk: 'Connected · {count} models available',
			testKeyOk: 'Key accepted · {count} models available',
			testKeyRejected: 'The provider rejected this key.',
			testUnverified: '(catalogue models only, key not verified)',
			testInactiveNote: 'This test used the current account’s key.',
			primaryAccountLabel: 'Primary account',
			accountLabelN: 'Account {n}',
			addProvider: 'Add provider',
			addProviderTitle: 'Add a provider',
			modeCatalog: 'From the catalog',
			modeCustom: 'Custom endpoint',
			providerName: 'Provider name',
			providerNamePlaceholder: 'Shown in this list',
			chooseProviderHint: 'Pick a provider from the built-in pi-ai catalog. Its models come from the catalog itself.',
			presetSearch: 'Search providers',
			presetEmpty: 'No provider matches that search.',
			presetRequired: 'Choose a provider from the catalog.',
			presetEnvHint: 'Environment fallback: {env}',
			providerDuplicate: 'This provider is already on the page.',
			customId: 'Provider ID',
			customIdHint: 'A lowercase identifier that names this provider in requests and in the route table, like acme-gateway.',
			customIdPlaceholder: 'acme-gateway',
			customIdInvalid: 'Start with a lowercase letter; then lowercase letters, digits, and dashes.',
			customIdTaken: 'Another provider already uses this ID.',
			displayNameRequired: 'A provider name is required.',
			customApi: 'API protocol',
			customNeedsApi: 'Choose an API protocol.',
			baseUrl: 'Endpoint URL',
			baseUrlPlaceholder: 'https://gateway.example/v1',
			customNeedsBaseUrl: 'Enter the endpoint URL first.',
			grokTitle: 'Grok Build',
			grokAccount: 'Grok Build account',
			grokOauthExplain: 'Grok Build signs in with your xAI account (SuperGrok) — there is no API key. Finish the device sign-in, then save.',
			grokLoginRequired: 'Finish the sign-in first.',
			grokOauthTag: 'OAuth',
			grokLogin: 'Sign in',
			grokRelogin: 'Sign in again',
			grokLogout: 'Sign out',
			grokWaiting: 'Waiting for the browser to finish signing in…',
			grokWaitingShort: 'Waiting…',
			grokSignedOut: 'Not signed in. Signing in uses your xAI account (SuperGrok), not API credits.',
			grokSignedIn: 'Signed in as {account}.',
			grokLoginFailed: 'Sign-in failed.',
			grokCodeExpired: 'The device code expired; start again.',
			grokOpenLink: 'Open the sign-in page',
			grokQuota: 'Monthly quota',
			grokProbe: 'Test connection',
			grokProbing: 'Testing…',
			grokProbeOk: 'Works: {model} · {count} models · reply “{sample}”',
			grokProbeFailed: 'Failed at {stage}: {error}',
			grokUnavailable: 'The Host does not offer the Grok Build routes in this version.',
			customBaseUrlInvalid: 'Enter a valid HTTP or HTTPS URL.',
			customNeedsModels: 'Discover at least one model before saving.',
			discover: 'Discover models',
			discovering: 'Asking the endpoint…',
			discoverEmpty: 'The endpoint listed no models, so this provider cannot be added.',
			modelsFound: 'Models found: {count}',
			catalogTag: 'Catalog',
			createProvider: 'Add provider',
			creating: 'Adding…',
			providerAdded: '{provider} added.',
			emptyTitle: 'No provider is configured yet',
			emptyDescription: 'Add a provider from the catalog or by endpoint, then store one API key per account. A provider whose keys are missing still shows up here so you can fix it.',
			importTitle: 'Import existing providers',
			importDescription: 'These routes are already configured in llm-pi-ai. Importing copies them into this page; only the provider list is written, so their keys and routes stay as they are.',
			importAction: 'Import detected providers',
			importing: 'Importing…',
			importAccountLabel: 'Primary account',
			importRefSet: 'Key reference {ref}',
			importRefUnset: 'No key reference',
			importEmpty: 'Nothing detected to import.',
			importDone: 'Imported {count} providers.',
			failoverTitle: 'Automatic account failover',
			failoverHint: 'When a request fails because the account cannot serve it — quota exhausted, key rejected, or credential missing — the next account is used instead. The account in use is the one whose key the route points at.',
			failoverCodes: 'Failing codes:',
			failoverNoCodes: 'No failing codes are configured.',
			failoverHops: 'At most {hops} account switches per request.',
			failoverSaved: 'Failover setting saved.',
			testFailedLoad: 'Test failed',
			noAccounts: 'No account yet. Add one to store its key.',
			providerRouteMissing: 'This provider has no llm-pi-ai route yet, so models are not offered until an account is used.',
			createRoute: 'Create route',
			nativeProviderHint: 'Served by the plugin\'s built-in adapter (OAuth). No llm-pi-ai route is needed — sign in on the account below, then pick the Grok Build models.',
			usageNav: 'Usage & balance',
			hudTagFiveHour: '5h',
			hudTagWeekly: 'wk',
			hudTagMonthly: 'mo',
			hudTagCredits: 'cr',
			usageTitle: 'Usage and balance',
			usageLine: 'Today {tokens} · {requests} req · {failures} fail',
			sparkLabel: 'Daily tokens, last 14 days · {tokens}',
			updatedAt: 'Updated {time}',
			never: 'never',
			justNow: 'just now',
			minutesAgo: '{n} min ago',
			hoursAgo: '{n} h ago',
			daysAgo: '{n} d ago',
			untilMinutes: '{n} min',
			untilHours: '{n} h',
			untilDays: '{n} d',
			refreshBalances: 'Refresh balances',
			refreshingBalances: 'Refreshing balances…',
			balanceRefreshOk: 'Provider balances refreshed.',
			balanceRefreshOkWithErrors: 'Balances refreshed, but a provider reported an error · {message}',
			balanceRefreshFailed: 'Refreshing balances failed · {message}',
			balanceRefreshUnsupported: 'This Host version does not provide the balance service.',
			usageUnsupported: 'This Host version does not provide the usage service, so usage and balance cannot be shown here. Update the Host half of this bundle to enable it.',
			usageHttpError: 'The usage service answered HTTP {status}.',
			usageNetworkError: 'Could not reach the usage service ({message}).',
			usageInvalidBody: 'The usage service answered with something that is not JSON.',
			balanceUnavailable: 'Balance unavailable',
			balanceUnavailableLine: 'Balance unavailable · {message}',
			balanceFieldBalance: 'Balance',
			balanceFieldGranted: 'Granted',
			balanceFieldToppedUp: 'Topped up',
			balanceFieldStatus: 'Status',
			balanceFieldKeyName: 'Key name',
			balanceFieldModelCount: 'Models',
			balanceFieldCreated: 'Key created',
			balanceFieldPlan: 'Plan',
			noQuotaApi: 'No quota API',
			noQuotaApiHint: 'This provider publishes no usage or balance endpoint; only the local accounting below is available.',
			balanceFieldRolling: '5-hour usage',
			balanceFieldWeekly: 'Weekly usage',
			balanceFieldMonthly: 'Monthly usage',
			balanceFieldRollingReset: '5-hour resets',
			balanceFieldWeeklyReset: 'Weekly resets',
			balanceFieldMonthlyReset: 'Monthly resets',
			balanceFieldRollingStatus: '5-hour status',
			balanceFieldWeeklyStatus: 'Weekly status',
			balanceFieldMonthlyStatus: 'Monthly status',
			balanceFieldFiveHourSpend: '5-hour spend',
			balanceFieldWeeklySpend: 'Weekly spend',
			balanceFieldMonthlySpend: 'Monthly spend',
			balanceFieldUsed: 'Used',
			balanceFieldLimit: 'Limit',
			balanceFieldRemaining: 'Remaining',
			balanceFieldResetAt: 'Resets at',
			balanceFieldExpiresAt: 'Expires at',
			gaugeFiveHour: '5-hour',
			gaugeWeekly: 'Weekly',
			gaugeMonthly: 'Monthly',
			gaugeCredits: 'Credits',
			gaugeResetsIn: 'resets in {when}',
			gaugeResetsDue: 'reset due',
			gaugeRateLimited: 'Rate limited',
			gaugeGroupLabel: 'Quota · {account}',
			balanceChip: 'Prepaid balance',
			usageNoAccounts: 'No account data for this provider.',
			usageEmptyDescription: 'Usage is counted only for the providers managed on the "Model providers and accounts" page. Requests made before this plugin was installed are not counted.',
		}
		/** Simplified Chinese strings (same keys as {@link en}). */
		const zh = {
			nav: '模型提供商与账号',
			title: '模型提供商与账号',
			intro: '管理此配置可使用的模型提供商，为每个账号保存一个 API 密钥，并选择当前使用的账号。',
			refresh: '刷新',
			refreshing: '刷新中…',
			loading: '载入中…',
			loadFailed: '加载提供商设置失败',
			retry: '重试',
			readOnly: '当前部署的设置文档为只读。',
			namespaceMissing: '本页依赖 provider-accounts 设置项（由本插件包的 Host 半声明）。该设置项未挂载，因此暂时无法读取或写入。',
			saved: '已保存',
			conflict: '设置已在别处被修改，请重试。',
			close: '关闭',
			cancel: '取消',
			saving: '保存中…',
			credentialConfigured: 'API 密钥已配置',
			credentialMissing: 'API 密钥缺失',
			activeAccount: '当前',
			switchAccount: '切换账号',
			switchGroupLabel: '{provider} 的账号',
			switchHint: '下一次模型请求生效',
			switchedTo: '已切换到 {account}。',
			activate: '使用',
			test: '测试',
			testing: '测试中…',
			edit: '编辑',
			remove: '删除',
			addAccount: '添加账号',
			addAccountTitle: '添加账号',
			editAccountTitle: '编辑账号',
			accountLabel: '账号名称',
			accountLabelPlaceholder: '例如：个人、团队共用',
			accountKey: 'API 密钥',
			accountKeyPlaceholder: '输入 API 密钥',
			accountKeyKeep: '留空则保持已存储的密钥',
			accountRef: '凭据引用名',
			accountRefHint: '只能包含字母、数字和下划线，且需以字母或下划线开头。',
			advanced: '高级选项',
			labelRequired: '账号名称不能为空。',
			refInvalid: '凭据引用名需匹配 [A-Za-z_][A-Za-z0-9_]*，例如 OPENCODE_GO_API_KEY。',
			refDuplicate: '该提供商的另一个账号已使用这个引用名。',
			keyRequired: '请输入 API 密钥。',
			keyBlank: '请输入 API 密钥。',
			keyIllegalCharacters: '该 API 密钥格式错误，请检查。',
			keyReveal: '显示密钥',
			keyHide: '隐藏密钥',
			saveAccount: '保存账号',
			accountAdded: '账号已添加。',
			accountSaved: '账号已保存。',
			removeAccountTitle: '删除这个账号？',
			removeAccountDescription: '该账号将从 {provider} 中移除；除非同时删除密钥，否则已保存的密钥会保留。',
			removeAccountConfirm: '删除账号',
			removeProvider: '删除提供商',
			removeProviderTitle: '删除 {provider}？',
			removeProviderDescription: '删除 {provider} 会移除其提供商条目和 llm-pi-ai 路由，其模型将不再可用。除非同时删除密钥，否则已保存的密钥会保留。',
			removeProviderConfirm: '删除提供商',
			providerRemoved: '提供商已删除。',
			removeCredential: '同时删除已保存的密钥',
			removeCredentialHint: '仍被其他账号使用的密钥会保留。',
			testOk: '连接正常 · 可用模型 {count} 个',
			testKeyOk: '密钥有效 · 可用模型 {count} 个',
			testKeyRejected: '提供商拒绝了这个密钥。',
			testUnverified: '（以上为目录模型，未验证密钥）',
			testInactiveNote: '本次测试使用的是当前账号的密钥。',
			primaryAccountLabel: '主账号',
			accountLabelN: '账号 {n}',
			addProvider: '添加提供商',
			addProviderTitle: '添加提供商',
			modeCatalog: '目录提供商',
			modeCustom: '自定义端点',
			providerName: '提供商名称',
			providerNamePlaceholder: '在此列表中显示',
			chooseProviderHint: '从内置 pi-ai 目录中选择提供商，其模型来自目录本身。',
			presetSearch: '搜索提供商',
			presetEmpty: '没有匹配的提供商。',
			presetRequired: '请从目录中选择一个提供商。',
			presetEnvHint: '环境变量后备：{env}',
			providerDuplicate: '该提供商已在页面中。',
			customId: '提供商 ID',
			customIdHint: '以小写字母开头的标识，在请求和路由表中唯一标识该提供商，例如 acme-gateway。',
			customIdPlaceholder: 'acme-gateway',
			customIdInvalid: '需以小写字母开头，之后可用小写字母、数字和短横线。',
			customIdTaken: '已有提供商使用了这个 ID。',
			displayNameRequired: '提供商名称不能为空。',
			customApi: 'API 协议',
			customNeedsApi: '请选择 API 协议。',
			baseUrl: '端点地址',
			baseUrlPlaceholder: 'https://gateway.example/v1',
			customNeedsBaseUrl: '请先填写端点地址。',
			grokTitle: 'Grok Build',
			grokAccount: 'Grok Build 账号',
			grokOauthExplain: 'Grok Build 用你的 xAI 账号（SuperGrok）登录，不用 API 密钥。完成设备码登录后再保存。',
			grokLoginRequired: '请先完成登录。',
			grokOauthTag: 'OAuth',
			grokLogin: '登录',
			grokRelogin: '重新登录',
			grokLogout: '退出登录',
			grokWaiting: '等待浏览器完成登录…',
			grokWaitingShort: '等待中…',
			grokSignedOut: '未登录。登录使用你的 xAI 账号（SuperGrok），不消耗 API credits。',
			grokSignedIn: '已登录：{account}。',
			grokLoginFailed: '登录失败。',
			grokCodeExpired: '设备码已过期，请重新开始。',
			grokOpenLink: '打开登录页面',
			grokQuota: '月度配额',
			grokProbe: '测试连接',
			grokProbing: '测试中…',
			grokProbeOk: '通了：{model} · 共 {count} 个模型 · 回复“{sample}”',
			grokProbeFailed: '失败（{stage}）：{error}',
			grokUnavailable: '当前版本 Host 未提供 Grok Build 路由。',
			customBaseUrlInvalid: '请输入有效的 HTTP 或 HTTPS 地址。',
			customNeedsModels: '请先探测出至少一个模型再保存。',
			discover: '探测模型',
			discovering: '正在询问端点…',
			discoverEmpty: '该端点没有列出任何模型，无法添加此提供商。',
			modelsFound: '已探测到 {count} 个模型',
			catalogTag: '目录',
			createProvider: '添加提供商',
			creating: '添加中…',
			providerAdded: '已添加 {provider}。',
			emptyTitle: '尚未配置任何提供商',
			emptyDescription: '可以从目录或端点添加提供商，然后为每个账号保存一个 API 密钥。缺少密钥的提供商也会显示在此页，便于修正。',
			importTitle: '导入现有提供商',
			importDescription: '以下路由已在 llm-pi-ai 中配置。导入会把它们复制到本页；只写入提供商列表，密钥与路由保持原样。',
			importAction: '导入检测到的提供商',
			importing: '导入中…',
			importAccountLabel: '主账号',
			importRefSet: '密钥引用 {ref}',
			importRefUnset: '没有密钥引用',
			importEmpty: '没有检测到可导入的内容。',
			importDone: '已导入 {count} 个提供商。',
			failoverTitle: '账号自动切换',
			failoverHint: '当请求因账号无法服务而失败（配额耗尽、密钥被拒或凭据缺失）时，自动改用下一个账号。当前使用的账号即路由所指向密钥对应的账号。',
			failoverCodes: '触发错误码：',
			failoverNoCodes: '尚未配置触发错误码。',
			failoverHops: '每个请求最多切换 {hops} 次账号。',
			failoverSaved: '自动切换设置已保存。',
			testFailedLoad: '测试失败',
			noAccounts: '还没有账号，添加一个以保存密钥。',
			providerRouteMissing: '该提供商尚无 llm-pi-ai 路由，使用账号后才会提供模型。',
			createRoute: '创建路由',
			nativeProviderHint: '该提供商由插件内置适配器（OAuth）直接提供，不需要 llm-pi-ai 路由。先在下方账号上登录，然后在模型选择器里选 Grok Build 分组。',
			usageNav: '用量与余额',
			hudTagFiveHour: '5h',
			hudTagWeekly: '周',
			hudTagMonthly: '月',
			hudTagCredits: '额',
			usageTitle: '用量与余额',
			usageLine: '今日 {tokens} · 请求 {requests} · 失败 {failures}',
			sparkLabel: '近 14 天 tokens · {tokens}',
			updatedAt: '更新于 {time}',
			never: '从未',
			justNow: '刚刚',
			minutesAgo: '{n} 分钟前',
			hoursAgo: '{n} 小时前',
			daysAgo: '{n} 天前',
			untilMinutes: '{n} 分钟',
			untilHours: '{n} 小时',
			untilDays: '{n} 天',
			refreshBalances: '刷新余额',
			refreshingBalances: '正在刷新余额…',
			balanceRefreshOk: '提供商余额已刷新。',
			balanceRefreshOkWithErrors: '余额已刷新，但有提供商报错 · {message}',
			balanceRefreshFailed: '刷新余额失败 · {message}',
			balanceRefreshUnsupported: '本版本未提供余额服务。',
			usageUnsupported: '当前 Host 版本未提供用量服务，本页无法显示用量与余额。请更新本插件包的 Host 半以启用。',
			usageHttpError: '用量服务返回 HTTP {status}。',
			usageNetworkError: '无法连接用量服务（{message}）。',
			usageInvalidBody: '用量服务返回的内容不是 JSON。',
			balanceUnavailable: '余额不可用',
			balanceUnavailableLine: '余额不可用 · {message}',
			balanceFieldBalance: '余额',
			balanceFieldGranted: '赠送额度',
			balanceFieldToppedUp: '充值余额',
			balanceFieldStatus: '状态',
			balanceFieldKeyName: '密钥名称',
			balanceFieldModelCount: '可用模型',
			balanceFieldCreated: '创建时间',
			balanceFieldPlan: '计划',
			noQuotaApi: '无配额接口',
			noQuotaApiHint: '该提供商未公开用量或余额接口，只能查看下方本地统计。',
			balanceFieldRolling: '5 小时用量',
			balanceFieldWeekly: '每周用量',
			balanceFieldMonthly: '每月用量',
			balanceFieldRollingReset: '5 小时重置',
			balanceFieldWeeklyReset: '每周重置',
			balanceFieldMonthlyReset: '每月重置',
			balanceFieldRollingStatus: '5 小时状态',
			balanceFieldWeeklyStatus: '每周状态',
			balanceFieldMonthlyStatus: '每月状态',
			balanceFieldFiveHourSpend: '5 小时消费',
			balanceFieldWeeklySpend: '每周消费',
			balanceFieldMonthlySpend: '每月消费',
			balanceFieldUsed: '已用',
			balanceFieldLimit: '额度上限',
			balanceFieldRemaining: '剩余',
			balanceFieldResetAt: '重置时间',
			balanceFieldExpiresAt: '到期时间',
			gaugeFiveHour: '5 小时',
			gaugeWeekly: '每周',
			gaugeMonthly: '每月',
			gaugeCredits: '额度',
			gaugeResetsIn: '{when}后重置',
			gaugeResetsDue: '待重置',
			gaugeRateLimited: '已限流',
			gaugeGroupLabel: '额度 · {account}',
			balanceChip: '预付余额',
			usageNoAccounts: '该提供商暂无账号数据。',
			usageEmptyDescription: '用量仅统计「模型提供商与账号」页中管理的提供商。安装本插件之前的请求不会被计入。',
		}
		//#endregion

		//#region operations
		/**
		 * Bind the page's Host round-trips to the plugin's own Remote namespaces.
		 * Components receive these callbacks instead of a context, so every
		 * failure the UI renders is already classified (written, conflict,
		 * invalid, refused) and no Remote namespace leaks into React.
		 *
		 * Revisions are read from the live store snapshot at call time, so a
		 * retry after a conflict uses the revision a fresh `describe()` returned.
		 * @param ctx - the page plugin's context.
		 * @param getSnapshot - reads the page store snapshot.
		 */
		function createOperations(ctx, getSnapshot) {
			const settings = ctx.remote.settings
			const credentials = ctx.remote.credentials
			const llm = ctx.remote.llm

			/** Map one settings mutate response onto the outcomes the page renders. */
			async function mutate(ns, ops) {
				const expected = getSnapshot()?.revisions?.[ns]
				const response = await settings.mutate(ns, ops, expected)
				if (response.ok) return { kind: 'written', view: response.value }
				const { code, message } = response.error
				return code === 'settings/conflict' ? { kind: 'conflict', message } : { kind: 'refused', message }
			}
			/** Store one key; a refusal names the Host message. */
			async function setKey(ref, key) {
				const response = await credentials.set(ref, key)
				return response.ok ? { kind: 'ok' } : { kind: 'refused', message: response.error.message }
			}
			/** Remove one stored key; a refusal is not fatal to a completed settings write. */
			async function removeKey(ref) {
				const response = await credentials.unset(ref)
				return response.ok ? { kind: 'ok' } : { kind: 'refused', message: response.error.message }
			}
			/** A field-level refusal whose message is a dictionary key. */
			function invalid(key) {
				return { kind: 'invalid', key }
			}
			/** Describe stored keys in chunks, since the Remote caps references per call. */
			async function describeKeys(refs) {
				const merged = {}
				for (let index = 0; index < refs.length; index += CREDENTIALS_CHUNK) {
					const chunk = refs.slice(index, index + CREDENTIALS_CHUNK)
					const response = await credentials.describe(chunk)
					if (response.ok) Object.assign(merged, response.value ?? {})
				}
				return merged
			}
			/** Route diagnostics from the adapter registry; a failure here is not fatal. */
			async function readDiagnostics() {
				const diagnostics = {}
				const response = await llm.listConfigurableProviders()
				if (!response.ok) return diagnostics
				for (const entry of response.value ?? []) {
					const provider = asString(entry?.provider)
					if (provider === undefined) continue
					diagnostics[provider] = {
						displayName: asString(entry.displayName),
						error: asString(entry.error),
					}
				}
				return diagnostics
			}
			/** Point a provider's pi-ai route at one credential reference, creating the route when it is absent. */
			async function pointRouteAt(provider, ref) {
				const route = getSnapshot()?.routes?.[provider.id]
				const ops = route === undefined
					? [{ op: 'set', path: ['providers', provider.id], value: routeProfileFor(provider, ref) }]
					: [{ op: 'set', path: ['providers', provider.id, 'apiKeyEnv'], value: ref }]
				return mutate(LLM_NS, ops)
			}
			/** Validate the fields every account form shares. */
			function accountFailure({ label, ref, key, provider, editing }) {
				if (label.trim().length === 0) return invalid('labelRequired')
				if (!ACCOUNT_REF_PATTERN.test(ref)) return invalid('refInvalid')
				if (!editing) {
					if (provider.accounts.some((account) => account.ref === ref)) return invalid('refDuplicate')
					if (key.trim().length === 0) return invalid('keyRequired')
				}
				const failure = apiKeyFailure(key.trim())
				if (failure !== undefined) return invalid(failure)
				return undefined
			}
			/** Guard every write flow so a transport throw becomes a rendered message. */
			function guarded(fn) {
				return async (input) => {
					try {
						return await fn(input)
					} catch (error) {
						return { kind: 'refused', message: messageOf(error) }
					}
				}
			}

			return {
				/**
				 * Read the page: both namespaces, the key states, and route
				 * diagnostics. A throw becomes the same `{ ok: false }` shape a
				 * refused Remote answer produces, which is what the store expects.
				 */
				read: async () => {
					try {
						const described = await settings.describe()
						if (!described.ok) return { ok: false, message: described.error.message }
						const views = Array.isArray(described.value?.namespaces) ? described.value.namespaces : []
						const own = views.find((view) => view.ns === NS)
						if (own === undefined) return { ok: false, missing: true, message: `settings namespace "${NS}" is not mounted` }
						const llmView = views.find((view) => view.ns === LLM_NS)
						const rawProviders = Array.isArray(own.value?.providers) ? own.value.providers : []
						const providers = rawProviders.map(normalizeProvider).filter((provider) => provider !== undefined)
						const routes = llmView === undefined ? {} : normalizeRoutes(llmView.value?.providers)
						const refs = collectRefs(providers)
						const storedKeys = refs.length === 0 ? {} : await describeKeys(refs)
						const diagnostics = await readDiagnostics()
						return {
							ok: true,
							writable: described.value.writable === true,
							providers,
							routes,
							credentials: storedKeys,
							diagnostics,
							failover: normalizeFailover(own.value?.failover),
							revisions: { [NS]: own.revision, [LLM_NS]: llmView?.revision },
							llmMounted: llmView !== undefined,
						}
					} catch (error) {
						return { ok: false, message: messageOf(error) }
					}
				},

				/** Probe a configured route, or a draft endpoint with a typed key. */
				/** Verify one account's stored key against the provider; unsupported means no probe exists. */
				/** Record the signed-in Grok Build provider so its billing joins the quota surfaces. */
				ensureGrokProvider: guarded(async ({ index, label }) => {
					await mutate(NS, [{
						op: 'set',
						path: ['providers', String(index)],
						value: {
							id: 'grok-build',
							name: 'Grok Build',
							catalog: false,
							accounts: [{ id: 'grok-build-a1', label, ref: 'GROK_BUILD_OAUTH' }],
						},
					}])
					return { kind: 'ok' }
				}),

				testKey: guarded(async ({ providerId, ref }) => {
					let response
					try {
						response = await fetch(TEST_URL, {
							method: 'POST',
							credentials: 'same-origin',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify(ref === undefined ? { providerId } : { providerId, ref }),
						})
					} catch (error) {
						return { kind: 'failed', message: messageOf(error) }
					}
					if (response.status === 404) return { kind: 'unsupported' }
					let body
					try {
						body = await response.json()
					} catch {
						return { kind: 'failed', message: 'the test route did not answer with JSON' }
					}
					if (body !== null && typeof body === 'object' && body.supported === false) return { kind: 'unsupported' }
					if (body !== null && typeof body === 'object' && body.ok === true) return { kind: 'valid' }
					const message = body !== null && typeof body === 'object' && typeof body.error === 'string' ? body.error : t('testKeyRejected')
					return { kind: 'invalid', message }
				}),

				discover: guarded(async (request) => {
					const response = await llm.discoverModels(LLM_NS, request)
					if (response.ok) return { kind: 'found', models: Array.isArray(response.value) ? response.value : [] }
					return { kind: 'refused', message: response.error.message }
				}),

				/** Add one account to an existing provider and store its key. */
				addAccount: guarded(async ({ providerIndex, provider, label, key, ref, activate }) => {
					const accountRef = ref.trim()
					const failure = accountFailure({ label, ref: accountRef, key, provider, editing: false })
					if (failure !== undefined) return failure
					const stored = await setKey(accountRef, key.trim())
					if (stored.kind !== 'ok') return stored
					const accounts = [...provider.accounts.map(plainAccount), plainAccount({ id: makeAccountId(provider.id, provider.accounts), label: label.trim(), ref: accountRef })]
					const written = await mutate(NS, [{ op: 'set', path: ['providers', String(providerIndex), 'accounts'], value: accounts }])
					if (written.kind !== 'written') return written
					if (activate) {
						const routed = await pointRouteAt(provider, accountRef)
						if (routed.kind !== 'written') return routed
					}
					return { kind: 'ok' }
				}),

				/** Point the provider's route at an existing account. */
				activateAccount: guarded(async ({ account, provider }) => {
					const routed = await pointRouteAt(provider, account.ref)
					return routed.kind === 'written' ? { kind: 'ok' } : routed
				}),

				/** Rename an account and, when a new key was typed, replace its stored key. */
				updateAccount: guarded(async ({ providerIndex, accountIndex, provider, account, label, key }) => {
					const failure = accountFailure({ label, ref: account.ref, key, provider, editing: true })
					if (failure !== undefined) return failure
					const trimmed = key.trim()
					if (trimmed.length > 0) {
						const stored = await setKey(account.ref, trimmed)
						if (stored.kind !== 'ok') return stored
					}
					if (label.trim() === account.label) return { kind: 'ok' }
					const written = await mutate(NS, [{ op: 'set', path: ['providers', String(providerIndex), 'accounts', String(accountIndex), 'label'], value: label.trim() }])
					return written.kind === 'written' ? { kind: 'ok' } : written
				}),

				/** Remove one account, repointing or clearing the route when it was the active one. */
				removeAccount: guarded(async ({ providerIndex, accountIndex, provider, account, removeCredential }) => {
					const remaining = provider.accounts.filter((_, index) => index !== accountIndex)
					const written = await mutate(NS, [{ op: 'unset', path: ['providers', String(providerIndex), 'accounts', String(accountIndex)] }])
					if (written.kind !== 'written') return written
					const route = getSnapshot()?.routes?.[provider.id]
					if (route !== undefined && asString(route.apiKeyEnv) === account.ref) {
						const nextRef = remaining.length > 0 ? remaining[0].ref : undefined
						const llmOps = nextRef === undefined
							? [{ op: 'unset', path: ['providers', provider.id, 'apiKeyEnv'] }]
							: [{ op: 'set', path: ['providers', provider.id, 'apiKeyEnv'], value: nextRef }]
						const routed = await mutate(LLM_NS, llmOps)
						if (routed.kind !== 'written') return routed
					}
					if (removeCredential) {
						const providers = getSnapshot()?.providers ?? []
						if (!refUsedElsewhere(providers, account.ref, providerIndex, accountIndex)) await removeKey(account.ref)
					}
					return { kind: 'ok' }
				}),

				/** Create a catalog route and the page entry that fronts it. */
				addCatalogProvider: guarded(async ({ preset, name, label, key, ref }) => {
					const providerName = name.trim()
					const accountRef = ref.trim()
					if (providerName.length === 0) return invalid('displayNameRequired')
					const failure = accountFailure({ label, ref: accountRef, key, provider: { accounts: [] }, editing: false })
					if (failure !== undefined) return failure
					if (getSnapshot().providers.some((provider) => provider.id === preset.id)) return invalid('providerDuplicate')
					const stored = await setKey(accountRef, key.trim())
					if (stored.kind !== 'ok') return stored
					// A catalog route needs only the reference: pi-ai supplies api, endpoint, and models.
					const routed = await mutate(LLM_NS, [
						{ op: 'set', path: ['providers', preset.id, 'apiKeyEnv'], value: accountRef },
						{ op: 'set', path: ['providers', preset.id, 'displayName'], value: providerName },
					])
					if (routed.kind !== 'written') return routed
					const account = { id: makeAccountId(preset.id, []), label: label.trim(), ref: accountRef }
					const index = getSnapshot().providers.length
					const written = await mutate(NS, [{
						op: 'set',
						path: ['providers', String(index)],
						value: {
							id: preset.id,
							name: providerName,
							catalog: true,
							...(preset.balanceKind === undefined ? {} : { balanceKind: preset.balanceKind }),
							accounts: [account],
						},
					}])
					return written.kind === 'written' ? { kind: 'ok' } : written
				}),

				/** Create a hand-declared route plus the page entry that fronts it. */
				addCustomProvider: guarded(async ({ id, name, api, baseURL, models, label, key, ref }) => {
					const routeId = id.trim()
					const providerName = name.trim()
					const accountRef = ref.trim()
					if (!CUSTOM_ID_PATTERN.test(routeId)) return invalid('customIdInvalid')
					if (routeIdTaken(getSnapshot().providers, getSnapshot().routes, routeId)) return invalid('customIdTaken')
					if (providerName.length === 0) return invalid('displayNameRequired')
					if (baseURL.trim().length === 0) return invalid('customNeedsBaseUrl')
					if (!isHttpUrl(baseURL.trim())) return invalid('customBaseUrlInvalid')
					if (!PROTOCOLS.some((protocol) => protocol.value === api)) return invalid('customNeedsApi')
					if (!Array.isArray(models) || models.length === 0) return invalid('customNeedsModels')
					const failure = accountFailure({ label, ref: accountRef, key, provider: { accounts: [] }, editing: false })
					if (failure !== undefined) return failure
					const endpoint = baseURL.trim()
					const plainModels = models.map(plainModel)
					const stored = await setKey(accountRef, key.trim())
					if (stored.kind !== 'ok') return stored
					const routed = await mutate(LLM_NS, [{ op: 'set', path: ['providers', routeId], value: { apiKeyEnv: accountRef, api, baseURL: endpoint, models: plainModels } }])
					if (routed.kind !== 'written') return routed
					const account = { id: makeAccountId(routeId, []), label: label.trim(), ref: accountRef }
					const index = getSnapshot().providers.length
					const written = await mutate(NS, [{
						op: 'set',
						path: ['providers', String(index)],
						value: { id: routeId, name: providerName, catalog: false, api, baseURL: endpoint, models: plainModels.map((model) => ({ ...model, input: [...model.input ?? ['text']] })), accounts: [account] },
					}])
					return written.kind === 'written' ? { kind: 'ok' } : written
				}),

				/** Delete a provider: its route first, then the page entry, then its unused keys. */
				removeProvider: guarded(async ({ providerIndex, provider, removeCredential }) => {
					// The page entry goes first. If that write is refused the route stays,
					// so the provider keeps working; the reverse order could leave a route
					// deleted while the entry still claims the provider, which hides every
					// model of that route from the picker.
					const written = await mutate(NS, [{ op: 'unset', path: ['providers', String(providerIndex)] }])
					if (written.kind !== 'written') return written
					if (Object.hasOwn(getSnapshot().routes, provider.id)) {
						const routed = await mutate(LLM_NS, [{ op: 'unset', path: ['providers', provider.id] }])
						if (routed.kind !== 'written') return routed
					}
					if (removeCredential) {
						const providers = getSnapshot()?.providers ?? []
						for (const account of provider.accounts) {
							if (!providers.some((candidate, index) => index !== providerIndex && candidate.accounts.some((other) => other.ref === account.ref))) await removeKey(account.ref)
						}
					}
					return { kind: 'ok' }
				}),

				/** Copy detected llm-pi-ai routes into the page's provider list only. */
				importRoutes: guarded(async ({ entries, accountLabel }) => {
					if (!Array.isArray(entries) || entries.length === 0) return invalid('importEmpty')
					const base = getSnapshot().providers.length
					const ops = entries.map(({ id, route }, offset) => {
						const ref = asString(route?.apiKeyEnv) ?? refFromRoute(id)
						const entry = {
							id,
							name: asString(route?.displayName) ?? id,
							catalog: asString(route?.api) === undefined && asString(route?.baseURL) === undefined,
							accounts: [{ id: makeAccountId(id, []), label: accountLabel, ref }],
						}
						const api = asString(route?.api)
						if (api !== undefined) entry.api = api
						const baseURL = asString(route?.baseURL)
						if (baseURL !== undefined) entry.baseURL = baseURL
						const models = normalizeModels(route?.models)
						if (models !== undefined) entry.models = models
						return { op: 'set', path: ['providers', String(base + offset)], value: entry }
					})
					const written = await mutate(NS, ops)
					return written.kind === 'written' ? { kind: 'ok' } : written
				}),

				/** Toggle the failover block in the page's own namespace. */
				setFailover: guarded(async ({ enabled }) => {
					const written = await mutate(NS, [{ op: 'set', path: ['failover', 'enabled'], value: enabled === true }])
					return written.kind === 'written' ? { kind: 'ok' } : written
				}),
			}
		}
		//#endregion

		//#region store
		/**
		 * The page's single immutable snapshot. Every field is replaced, never
		 * mutated, so `useSyncExternalStore` can compare by identity.
		 */
		class ProviderAccountsStore {
			constructor(loader) {
				this.loader = loader
				this.listeners = new Set()
				this.pending = false
				/** Whether one read has succeeded; a failed first read may be retried on mount. */
				this.settled = false
				/** When the last successful read finished, so a remount can tell stale data. */
				this.lastLoadedAt = 0
				/** Whether the page has mounted, which gates refresh-on-invalidation. */
				this.opened = false
				this.snapshot = Object.freeze({
					status: 'idle',
					error: null,
					missing: false,
					loading: false,
					writable: true,
					providers: Object.freeze([]),
					routes: Object.freeze({}),
					credentials: Object.freeze({}),
					diagnostics: Object.freeze({}),
					failover: Object.freeze({ enabled: false, codes: Object.freeze([]), maxHops: undefined }),
					revisions: Object.freeze({}),
					llmMounted: false,
				})
				this.getSnapshot = () => this.snapshot
				this.subscribe = (listener) => {
					this.listeners.add(listener)
					return () => {
						this.listeners.delete(listener)
					}
				}
			}
			/** Publish a replaced snapshot and wake every subscriber. */
			update(patch) {
				this.snapshot = Object.freeze({ ...this.snapshot, ...patch })
				for (const listener of [...this.listeners]) {
					try {
						listener()
					} catch {
						// A subscriber that throws must not stop the others.
					}
				}
			}
			/** Load once, when the page first mounts (or retry a first read that failed). */
			ensureLoaded() {
				if (this.pending) return
				if (this.snapshot.status === 'idle' || (this.snapshot.status === 'error' && !this.settled)) void this.load()
			}
			/** The page is on screen: allow pushed invalidations and refresh data from an earlier visit. */
			markOpened() {
				this.opened = true
				if (this.snapshot.status === 'idle' || (this.snapshot.status === 'error' && !this.settled)) {
					this.ensureLoaded()
					return
				}
				// Data warmed at activation is reused; anything older is re-read on mount.
				if (this.lastLoadedAt === 0 || Date.now() - this.lastLoadedAt >= 1000) void this.load()
			}
			/** Re-read every source; concurrent calls collapse into the first. */
			async load() {
				if (this.pending) return
				this.pending = true
				this.update({ loading: true })
				let result
				try {
					result = await this.loader()
				} catch (error) {
					result = { ok: false, message: messageOf(error) }
				}
				this.pending = false
				if (!result.ok) {
					this.update({
						loading: false,
						status: this.snapshot.status === 'ready' ? 'ready' : 'error',
						error: result.message ?? '',
						missing: result.missing === true,
					})
					return
				}
				this.settled = true
				this.lastLoadedAt = Date.now()
				this.update({
					loading: false,
					status: 'ready',
					error: null,
					missing: false,
					writable: result.writable,
					providers: result.providers,
					routes: result.routes,
					credentials: result.credentials,
					diagnostics: result.diagnostics,
					failover: result.failover,
					revisions: result.revisions,
					llmMounted: result.llmMounted,
				})
			}
		}
		/** Subscribe to a store snapshot (the hook the injected face names `hooks.snapshot`). */
		function useSnapshot(store) {
			return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
		}
		//#endregion

		//#region usage data
		/** Reused formatters: built on first use and then shared by every cell. */
		let countFormatter
		let tokenFormatter
		let dateFormatter

		/**
		 * A non-negative whole number from an untrusted value. Every count and
		 * timestamp arriving from the Host passes through here before the page does
		 * arithmetic on it, so a missing or malformed field reads as 0.
		 * @param value - a raw JSON value.
		 * @returns {number} the count: never negative, fractional, or NaN.
		 */
		function countOf(value) {
			return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
		}

		/** A finite number from an untrusted value, or undefined (dollars, percentages). */
		function finiteNumber(value) {
			return typeof value === 'number' && Number.isFinite(value) ? value : undefined
		}

		/**
		 * The local calendar day (`YYYY-MM-DD`) of one timestamp. The Host buckets
		 * usage by this same local day, so both sides agree on what "today" means.
		 * @param at - epoch milliseconds.
		 * @returns {string} the day key.
		 */
		function dayKey(at) {
			const date = new Date(at)
			const month = String(date.getMonth() + 1).padStart(2, '0')
			const day = String(date.getDate()).padStart(2, '0')
			return `${date.getFullYear()}-${month}-${day}`
		}

		/**
		 * The local day `offset` days before `at`; `0` is today.
		 * @param at - epoch milliseconds to count back from.
		 * @param offset - whole days back.
		 * @returns {string} the day key.
		 */
		function dayKeyBefore(at, offset) {
			const date = new Date(at)
			date.setDate(date.getDate() - offset)
			return dayKey(date.getTime())
		}

		/** A grouped integer (`12,345`). */
		function formatCount(value) {
			countFormatter ??= new Intl.NumberFormat(undefined)
			return countFormatter.format(value)
		}

		/** A token count: exact below ten thousand, compact above (`12.3K`). */
		function formatTokens(value) {
			if (value < 10_000) return formatCount(value)
			tokenFormatter ??= new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
			return tokenFormatter.format(value)
		}

		/** A local date and time for a tooltip; empty when the value is not a timestamp. */
		function formatDateTime(at) {
			if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return ''
			dateFormatter ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
			return dateFormatter.format(at)
		}

		/**
		 * How long ago a moment was, in the page's own words (`just now`, `3 min ago`).
		 * @param t - the page's locale reader.
		 * @param at - epoch milliseconds; `undefined` or 0 reads as "never".
		 * @returns {string} the localized phrase.
		 */
		function relativeTime(t, at) {
			if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return t('never')
			const elapsed = Date.now() - at
			if (elapsed < 45_000) return t('justNow')
			const minutes = Math.round(elapsed / 60_000)
			if (minutes < 60) return copy(t('minutesAgo'), { n: minutes })
			const hours = Math.round(elapsed / 3_600_000)
			if (hours < 24) return copy(t('hoursAgo'), { n: hours })
			return copy(t('daysAgo'), { n: Math.round(elapsed / 86_400_000) })
		}

		/**
		 * How long until a quota window resets, as a short localized countdown
		 * (`resets in 2 h`, `2 小时后重置`), or the "due" phrase once that moment has
		 * passed. A missing or unreadable timestamp yields no countdown at all.
		 * @param t - the page's locale reader.
		 * @param resetsAt - the ISO timestamp the Host reported, if any.
		 * @returns {string|undefined} the countdown text.
		 */
		function gaugeResetText(t, resetsAt) {
			if (typeof resetsAt !== 'string' || resetsAt.length === 0) return undefined
			const at = Date.parse(resetsAt)
			if (!Number.isFinite(at)) return undefined
			const delta = at - Date.now()
			if (delta <= 0) return t('gaugeResetsDue')
			const minutes = Math.round(delta / 60_000)
			if (minutes < 60) return copy(t('gaugeResetsIn'), { when: copy(t('untilMinutes'), { n: Math.max(1, minutes) }) })
			const hours = Math.round(delta / 3_600_000)
			if (hours < 24) return copy(t('gaugeResetsIn'), { when: copy(t('untilHours'), { n: hours }) })
			return copy(t('gaugeResetsIn'), { when: copy(t('untilDays'), { n: Math.round(delta / 86_400_000) }) })
		}

		/** A dollar amount with two decimals (`$12.30`); undefined when there is no number. */
		function dollarText(value) {
			return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : undefined
		}

		/** The `$used / $limit` pair of one meter, when it carries both dollar amounts. */
		function meterDollars(meter) {
			const used = dollarText(meter.usedUSD)
			const limit = dollarText(meter.limitUSD)
			return used === undefined || limit === undefined ? undefined : `${used} / ${limit}`
		}

		/**
		 * The visual tone of one gauge: danger when the provider throttled that
		 * window or it is nearly used up, warning from 70 %, and the healthy tone
		 * below that. The colors are stylesheet tokens; this only names the tone.
		 * @param percent - the meter's 0…100 percentage.
		 * @param status - the Host's meter status (`ok`, `rate-limited`, or absent).
		 * @returns {'ok'|'warn'|'danger'} the tone name.
		 */
		function gaugeTone(percent, status) {
			if (status === 'rate-limited' || percent >= 90) return 'danger'
			return percent >= 70 ? 'warn' : 'ok'
		}

		/**
		 * One account's day buckets, defaulted field by field. Keys that are not
		 * `YYYY-MM-DD` and buckets that are not objects are dropped, so the chart
		 * and the "today" sums never see a malformed date.
		 * @param raw - the `days` value of one account.
		 * @returns {Object<string, {requests:number, failures:number, input:number, output:number}>}
		 */
		function normalizeUsageDays(raw) {
			const days = {}
			if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return days
			for (const [key, bucket] of Object.entries(raw)) {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
				if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) continue
				days[key] = {
					requests: countOf(bucket.requests),
					failures: countOf(bucket.failures),
					input: countOf(bucket.input),
					output: countOf(bucket.output),
				}
			}
			return days
		}

		/** One account row of the snapshot, with every metric defaulted. */
		function normalizeUsageAccount(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const ref = asString(raw.ref)
			const providerId = asString(raw.providerId)
			if (ref === undefined || ref.length === 0) return undefined
			if (providerId === undefined || providerId.length === 0) return undefined
			const lastUsedAt = countOf(raw.lastUsedAt)
			const lastError = raw.lastError !== null && typeof raw.lastError === 'object'
				? { code: asString(raw.lastError.code) ?? '', message: asString(raw.lastError.message) ?? '', at: countOf(raw.lastError.at) }
				: undefined
			return {
				providerId,
				providerName: asString(raw.providerName) ?? providerId,
				ref,
				label: asString(raw.label) ?? ref,
				active: raw.active === true,
				requests: countOf(raw.requests),
				failures: countOf(raw.failures),
				switches: countOf(raw.switches),
				input: countOf(raw.input),
				output: countOf(raw.output),
				cacheRead: countOf(raw.cacheRead),
				cacheWrite: countOf(raw.cacheWrite),
				reasoning: countOf(raw.reasoning),
				lastUsedAt: lastUsedAt > 0 ? lastUsedAt : undefined,
				lastError,
				days: normalizeUsageDays(raw.days),
			}
		}

		/**
		 * One quota meter of a balance entry: the percentage the page draws as a
		 * bar, plus the dollars and the reset time it can also show. The percentage
		 * may be absent on the wire, so it is derived from the dollar pair; a meter
		 * carrying neither is dropped rather than drawn as an empty, meaningless bar.
		 * @param raw - one `meters[]` entry of the Host's wire shape.
		 * @returns {object|undefined} a normalized meter, or undefined.
		 */
		function normalizeUsageMeter(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const id = asString(raw.id)
			if (id === undefined || !Object.hasOwn(GAUGE_LABEL_KEYS, id)) return undefined
			const usedUSD = finiteNumber(raw.usedUSD)
			const limitUSD = finiteNumber(raw.limitUSD)
			const reported = finiteNumber(raw.percent)
			const derived = usedUSD === undefined || limitUSD === undefined || limitUSD <= 0 ? undefined : (usedUSD / limitUSD) * 100
			const percent = reported ?? derived
			if (percent === undefined) return undefined
			return {
				id,
				percent: Math.min(100, Math.max(0, percent)),
				usedUSD,
				limitUSD,
				resetsAt: asString(raw.resetsAt) ?? '',
				status: asString(raw.status) ?? '',
			}
		}

		/** One provider's balance probe result: fields, meters, when it was fetched, or its error. */
		function normalizeUsageBalance(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const ok = raw.ok === true
			const fields = Array.isArray(raw.fields)
				? raw.fields
					.filter((field) => field !== null && typeof field === 'object')
					.slice(0, 12)
					.map((field) => ({ key: asString(field.key) ?? '', value: asString(field.value) ?? '' }))
					.filter((field) => field.key.length > 0)
				: []
			// A failed probe carries no usable gauges: drawing its empty meters would
			// show a stale-looking 0 % bar instead of the warning line.
			const meters = ok && Array.isArray(raw.meters)
				? raw.meters
					.map(normalizeUsageMeter)
					.filter((meter) => meter !== undefined)
					.sort((left, right) => GAUGE_IDS.indexOf(left.id) - GAUGE_IDS.indexOf(right.id))
					.slice(0, GAUGE_IDS.length)
				: []
			return {
				kind: asString(raw.kind) ?? '',
				ok,
				fetchedAt: countOf(raw.fetchedAt),
				fields,
				meters,
				error: asString(raw.error) ?? '',
			}
		}

		/** One provider row of the snapshot. */
		function normalizeUsageProvider(raw) {
			if (raw === null || typeof raw !== 'object') return undefined
			const id = asString(raw.id)
			if (id === undefined || id.length === 0) return undefined
			return {
				id,
				name: asString(raw.name) ?? id,
				catalog: raw.catalog === true,
				balanceKind: asString(raw.balanceKind) ?? '',
				activeRef: asString(raw.activeRef) ?? '',
			}
		}

		/**
		 * The whole snapshot: providers, accounts, balances, and its own update time.
		 * Any array or object may be missing and reads as empty, and a balance entry
		 * keyed by a route the page does not show simply never gets looked up.
		 * @param raw - the JSON body the Host answered with.
		 * @returns {object} a normalized snapshot.
		 */
		function normalizeUsageSnapshot(raw) {
			const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
			const providers = Array.isArray(value.providers)
				? value.providers.map(normalizeUsageProvider).filter((provider) => provider !== undefined)
				: []
			const accounts = Array.isArray(value.accounts)
				? value.accounts.map(normalizeUsageAccount).filter((account) => account !== undefined)
				: []
			const balances = {}
			if (value.balances !== null && typeof value.balances === 'object' && !Array.isArray(value.balances)) {
				for (const [rawKey, entry] of Object.entries(value.balances)) {
					const balance = normalizeUsageBalance(entry)
					if (balance === undefined) continue
					// The wire contract keys a balance `<providerId>::<ref>`; a Host that
					// serves its ledger keys verbatim separates them with a NUL byte
					// instead, so both spellings resolve to the same lookup below.
					balances[rawKey.replace('\u0000', '::')] = balance
				}
			}
			return { updatedAt: countOf(value.updatedAt), providers, accounts, balances }
		}

		/**
 * One account's ledger slice for the settings page: its today totals and its
 * balance entry, looked up by `(providerId, ref)` in the normalized snapshot.
 * @param data - a normalized snapshot, or null before the first read.
 * @param providerId - the provider row the account belongs to.
 * @param account - the configured account.
 * @returns {object|undefined} `{ totals, balance }`, or undefined without data.
 */
function usageSlice(data, providerId, account) {
  if (data === null || data === undefined) return undefined
  const entry = data.accounts.find((candidate) => candidate.providerId === providerId && candidate.ref === account.ref)
  return {
    totals: entry === undefined ? undefined : usageTotals([entry], Date.now()),
    balance: usageBalanceOf(data, providerId, account.ref),
  }
}

/** The balance entry of one provider's active account, keyed as the snapshot normalizes it. */
		function usageBalanceOf(data, providerId, ref) {
			return ref.length === 0 ? undefined : data.balances[`${providerId}::${ref}`]
		}

		/**
		 * Group providers with their accounts, keeping Host order. An account whose
		 * provider row is missing (an older Host, or a route added mid-request) gets
		 * a group of its own instead of disappearing from the page.
		 * @param data - a normalized snapshot.
		 * @returns {Array<object>} one entry per provider, each carrying `accounts`.
		 */
		function usageGroups(data) {
			const groups = []
			const byId = new Map()
			for (const provider of data.providers) {
				const group = { id: provider.id, name: provider.name, catalog: provider.catalog, activeRef: provider.activeRef, accounts: [] }
				byId.set(group.id, group)
				groups.push(group)
			}
			for (const account of data.accounts) {
				let group = byId.get(account.providerId)
				if (group === undefined) {
					group = { id: account.providerId, name: account.providerName, catalog: false, activeRef: '', accounts: [] }
					byId.set(group.id, group)
					groups.push(group)
				}
				group.accounts.push(account)
				if (group.activeRef.length === 0 && account.active) group.activeRef = account.ref
				// A provider row that never named itself takes the account's own name.
				if (group.name === group.id && account.providerName !== account.providerId) group.name = account.providerName
			}
			return groups
		}

		/**
		 * Today's requests, tokens (input + output), and failures, summed across
		 * every managed account. Only day buckets count: an account's lifetime
		 * totals are not today's numbers.
		 * @param accounts - every normalized account row.
		 * @param at - the moment "today" is measured from.
		 */
		function usageTotals(accounts, at) {
			const key = dayKey(at)
			const totals = { requests: 0, tokens: 0, failures: 0 }
			for (const account of accounts) {
				const bucket = account.days[key]
				if (bucket === undefined) continue
				totals.requests += bucket.requests
				totals.tokens += bucket.input + bucket.output
				totals.failures += bucket.failures
			}
			return totals
		}

		/** Tokens (input + output) one account used over the trailing `days` days. */
		function recentTokens(account, at, days = RECENT_DAYS) {
			let tokens = 0
			for (let offset = 0; offset < days; offset += 1) {
				const bucket = account.days[dayKeyBefore(at, offset)]
				if (bucket !== undefined) tokens += bucket.input + bucket.output
			}
			return tokens
		}

		/** One bucket per chart day, oldest first, with the date the bar stands for. */
		function chartBuckets(account, at, days = CHART_DAYS) {
			const buckets = []
			for (let offset = days - 1; offset >= 0; offset -= 1) {
				const date = dayKeyBefore(at, offset)
				const bucket = account.days[date]
				buckets.push({ date, tokens: bucket === undefined ? 0 : bucket.input + bucket.output })
			}
			return buckets
		}

		/** The localized label of one balance field key; an unknown key stays verbatim. */
		function balanceFieldLabel(t, key) {
			return Object.hasOwn(BALANCE_FIELD_KEYS, key) ? t(BALANCE_FIELD_KEYS[key]) : key
		}

		/** A balance value: an epoch or ISO timestamp of a date-like key becomes local time. */
		function balanceFieldValue(key, value) {
			const dateLike = key === 'resetAt' || key === 'expiresAt' || /Reset$/.test(key)
			if (dateLike && /^\d{12,}$/.test(value)) {
				const formatted = formatDateTime(Number(value))
				if (formatted.length > 0) return formatted
			}
			if (dateLike && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
				const parsed = Date.parse(value)
				if (Number.isFinite(parsed)) {
					const formatted = formatDateTime(parsed)
					if (formatted.length > 0) return formatted
				}
			}
			return value
		}

		/** The first inline balance error of a snapshot, for the transient status line. */
		function firstBalanceError(data) {
			if (data === null || data === undefined) return undefined
			for (const balance of Object.values(data.balances)) {
				if (balance.ok !== true && balance.error.length > 0) return balance.error
			}
			return undefined
		}

		/**
		 * One inline message for a failed route call: the store classifies, the page
		 * localizes. Never throws, whatever the store recorded.
		 * @param t - the page's locale reader.
		 * @param error - the store's classified error.
		 * @returns {string} the text of the error line.
		 */
		function usageErrorText(t, error) {
			if (error === null || error === undefined) return ''
			if (error.kind === 'http') return copy(t('usageHttpError'), { status: error.status })
			if (error.kind === 'network') return copy(t('usageNetworkError'), { message: error.message === undefined ? '' : error.message })
			return t('usageInvalidBody')
		}

		/**
		 * Read one exact Fetch route as JSON, classifying every failure the page can
		 * render instead of throwing: `unsupported` for a 404 (a Host without the
		 * route), `http` for any other non-2xx answer, `body` for a non-JSON body,
		 * and `network` for a rejected fetch.
		 * @param url - same-origin route path.
		 * @param init - fetch init (method, headers).
		 * @returns {Promise<object>} `{ kind: 'ok', body }` or one classified failure.
		 */
		async function readJsonRoute(url, init) {
			if (typeof fetch !== 'function') return { kind: 'network', message: 'fetch is unavailable' }
			let response
			try {
				response = await fetch(url, init)
			} catch (error) {
				return { kind: 'network', message: messageOf(error) }
			}
			if (response === null || typeof response !== 'object') return { kind: 'network', message: 'fetch is unavailable' }
			if (response.status === 404) return { kind: 'unsupported' }
			if (response.ok !== true) return { kind: 'http', status: typeof response.status === 'number' ? response.status : 0 }
			try {
				return { kind: 'ok', body: await response.json() }
			} catch {
				return { kind: 'body' }
			}
		}

		/** GET the usage snapshot the Host serves on this page's origin. */
		async function readUsageSnapshot() {
			const result = await readJsonRoute(USAGE_URL, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' })
			return result.kind === 'ok' ? { kind: 'ok', data: normalizeUsageSnapshot(result.body) } : result
		}

		/** POST to re-probe provider balances; the Host answers with a fresh snapshot. */
		async function refreshProviderBalances() {
			const result = await readJsonRoute(BALANCE_URL, { method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin' })
			return result.kind === 'ok' ? { kind: 'ok', data: normalizeUsageSnapshot(result.body) } : result
		}

		/**
		 * The usage page's single immutable snapshot. It owns both route reads, so
		 * the component never touches `fetch` itself and a failed refresh replaces
		 * one field instead of the tree.
		 */
		class UsageStore {
			constructor(loader, balanceLoader) {
				this.loader = loader
				this.balanceLoader = balanceLoader
				this.listeners = new Set()
				/** One in-flight read at a time: a poll never stacks behind a slow Host. */
				this.pending = false
				this.balancePending = false
				/** Whether the page has been on screen, which gates polling. */
				this.opened = false
				this.snapshot = Object.freeze({
					status: 'idle',
					loading: false,
					data: null,
					error: null,
					fetchedAt: 0,
					balancePending: false,
				})
				this.getSnapshot = () => this.snapshot
				this.subscribe = (listener) => {
					this.listeners.add(listener)
					return () => {
						this.listeners.delete(listener)
					}
				}
			}
			/** Publish a replaced snapshot and wake every subscriber. */
			update(patch) {
				this.snapshot = Object.freeze({ ...this.snapshot, ...patch })
				for (const listener of [...this.listeners]) {
					try {
						listener()
					} catch {
						// A subscriber that throws must not stop the others.
					}
				}
			}
			/** The page mounted: read once, or re-read when the last read is stale. */
			markOpened() {
				this.opened = true
				if (this.pending) return
				if (this.snapshot.status === 'idle' || this.snapshot.status === 'unsupported') {
					void this.load()
					return
				}
				// A snapshot the poll just wrote is reused when the page reopens at once.
				if (this.snapshot.fetchedAt === 0 || Date.now() - this.snapshot.fetchedAt >= 1000) void this.load()
			}
			/** Whether the poll may ask again: a Host without the route is not retried on a timer. */
			shouldPoll() {
				return this.snapshot.status !== 'unsupported'
			}
			/**
			 * Read the snapshot. A failure keeps the last good data and records the
			 * classified error next to it, so the page shows stale numbers plus one
			 * inline warning instead of blanking.
			 * @param options - `{ silent: true }` for a background poll (no spinner).
			 */
			async load(options) {
				if (this.pending) return
				const silent = options !== null && typeof options === 'object' && options.silent === true
				this.pending = true
				if (!silent) this.update({ loading: true })
				let result
				try {
					result = await this.loader()
				} catch (error) {
					result = { kind: 'network', message: messageOf(error) }
				}
				this.pending = false
				if (result.kind === 'ok') {
					this.update({ loading: false, status: 'ready', data: result.data, error: null, fetchedAt: Date.now() })
					return
				}
				if (result.kind === 'unsupported') {
					this.update({ loading: false, status: 'unsupported', error: null, fetchedAt: Date.now() })
					return
				}
				this.update({
					loading: false,
					status: this.snapshot.data === null ? 'error' : 'ready',
					error: { kind: result.kind, status: result.status, message: result.message },
				})
			}
			/**
			 * Ask the Host to re-probe provider balances, then adopt the snapshot it
			 * answers with. The caller renders the outcome; a refusal is not a throw.
			 * @returns {Promise<object>} `{kind:'ok'|'unsupported'|'failed'|'busy'}`.
			 */
			async refreshBalances() {
				if (this.balancePending) return { kind: 'busy' }
				this.balancePending = true
				this.update({ balancePending: true })
				let result
				try {
					result = await this.balanceLoader()
				} catch (error) {
					result = { kind: 'network', message: messageOf(error) }
				}
				this.balancePending = false
				if (result.kind === 'ok') {
					this.update({ balancePending: false, status: 'ready', loading: false, data: result.data, error: null, fetchedAt: Date.now() })
					return { kind: 'ok', data: result.data }
				}
				this.update({ balancePending: false })
				if (result.kind === 'unsupported') return { kind: 'unsupported' }
				return { kind: 'failed', error: { kind: result.kind, status: result.status, message: result.message } }
			}
		}

		/** Build one usage page store bound to the Host's two routes. */
		function createUsageStore() {
			return new UsageStore(readUsageSnapshot, refreshProviderBalances)
		}
		//#endregion

		//#region shared UI
		/** Render inside a body portal when the module registry offers react-dom. */
		function portal(node) {
			if (reactDom !== undefined && typeof document !== 'undefined' && document.body !== null) return reactDom.createPortal(node, document.body)
			return node
		}
		/** A configured/missing key dot with a spoken label. */
		function StatusDot({ on, label }) {
			return h('span', { className: cx('pa-dot', on ? 'pa-dotOn' : 'pa-dotOff'), role: 'img', 'aria-label': label, title: label })
		}
		/** One labeled field; the label is bound to the control by id. */
		function Field({ id, label, hint, children }) {
			return h('div', { className: 'pa-field' },
				h('label', { className: 'pa-label', htmlFor: id }, label),
				children,
				hint === undefined ? null : h('p', { className: 'pa-hint' }, hint))
		}
		/** Write-only secret input with a reveal toggle. */
		function KeyInput({ id, value, onChange, disabled, t, placeholder, autoFocus }) {
			const [revealedValue, setRevealedValue] = React.useState(undefined)
			const revealed = value.length > 0 && revealedValue === value
			return h('div', { className: 'pa-keyWrap' },
				h('input', {
					id,
					className: cx('pa-input', value.length > 0 && 'pa-keyFilled'),
					type: revealed ? 'text' : 'password',
					autoComplete: 'new-password',
					autoCapitalize: 'off',
					autoCorrect: 'off',
					spellCheck: false,
					value,
					disabled,
					placeholder,
					'data-autofocus': autoFocus === true ? '' : undefined,
					onChange: (event) => {
						setRevealedValue(undefined)
						onChange(event.target.value)
					},
				}),
				value.length === 0 ? null : h('button', {
					type: 'button',
					className: 'pa-keyToggle',
					'aria-label': t(revealed ? 'keyHide' : 'keyReveal'),
					'aria-pressed': revealed,
					disabled,
					onClick: () => setRevealedValue(revealed ? undefined : value),
				}, h('svg', {
					width: 16,
					height: 16,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.3,
					strokeLinecap: 'round',
					'aria-hidden': 'true',
				}, h('path', { d: revealed ? 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8ZM2.5 2.5L13.5 13.5' : 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8ZM10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z' }))))
		}
		/** The host switch: a real button with role="switch". */
		function Switch({ checked, onChange, label, disabled }) {
			return h('button', {
				type: 'button',
				role: 'switch',
				'aria-checked': checked,
				'aria-label': label,
				disabled,
				className: 'pa-switch',
				onClick: () => onChange(!checked),
			}, h('span', { className: 'pa-thumb' }))
		}
		/** A checkbox row for a destructive dialog's optional key deletion. */
		function CheckRow({ t, checked, onChange, disabled }) {
			const id = React.useId()
			return h('div', { className: 'pa-field' },
				h('label', { className: 'pa-check', htmlFor: id },
					h('input', { id, type: 'checkbox', checked, disabled, onChange: (event) => onChange(event.target.checked) }),
					h('span', null, t('removeCredential'))),
				h('p', { className: 'pa-hint' }, t('removeCredentialHint')))
		}
		/**
		 * A self-contained modal: overlay, centered surface, title, body, footer.
		 * Escape closes it (unless a write is in flight), Tab stays inside, focus
		 * moves to the first marked control and returns to the opener on close.
		 */
		function Modal({ t, title, description, onClose, busy, children, footer }) {
			const titleId = React.useId()
			const dialogRef = React.useRef(null)
			/**
			 * Keep the latest close/busy handlers in a ref: they change identity on
			 * every keystroke in a dialog, and re-running the focus effect would
			 * steal focus from the field being typed into.
			 */
			const handlers = React.useRef({ onClose, busy })
			handlers.current = { onClose, busy }
			React.useEffect(() => {
				const opener = document.activeElement
				const dialog = dialogRef.current
				const initial = dialog?.querySelector('[data-autofocus]') ?? dialog
				if (initial !== null && typeof initial?.focus === 'function') initial.focus()
				const onKeyDown = (event) => {
					const current = dialogRef.current
					if (current === null) return
					if (event.key === 'Escape' && !event.shiftKey) {
						event.preventDefault()
						if (!handlers.current.busy) handlers.current.onClose()
						return
					}
					if (event.key !== 'Tab') return
					const focusable = [...current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
						.filter((element) => element.closest('[hidden]') === null)
					if (focusable.length === 0) {
						event.preventDefault()
						current.focus()
						return
					}
					const first = focusable[0]
					const last = focusable[focusable.length - 1]
					if (!current.contains(document.activeElement)) {
						event.preventDefault()
						first.focus()
						return
					}
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault()
						last.focus()
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault()
						first.focus()
					}
				}
				document.addEventListener('keydown', onKeyDown, true)
				return () => {
					document.removeEventListener('keydown', onKeyDown, true)
					if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
				}
			}, [])
			return portal(h('div', { className: 'pa-overlay' },
				h('div', { className: 'pa-mask', 'aria-hidden': 'true', onClick: () => { if (!busy) onClose() } }),
				h('div', { ref: dialogRef, className: 'pa-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1 },
					h('div', { className: 'pa-dialogContent' },
						h('div', { className: 'pa-dialogHead' },
							h('h2', { className: 'pa-dialogTitle', id: titleId }, title),
							h('button', { type: 'button', className: 'pa-close', 'aria-label': t('close'), disabled: busy, onClick: onClose },
								h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': 'true' },
									h('path', { d: 'M3 3l8 8M11 3l-8 8' })))),
						description === undefined ? null : h('p', { className: 'pa-dialogDesc' }, description),
						h('div', { className: 'pa-dialogBody' }, children)),
					footer === undefined ? null : h('div', { className: 'pa-dialogActions' }, footer))))
		}
		/** Cancel and confirm pair shared by every dialog. */
		function DialogActions({ t, busy, confirmLabel, busyLabel, onCancel, onConfirm, danger, confirmDisabled }) {
			return h(React.Fragment, null,
				h('button', { type: 'button', className: 'pa-btnSecondary', disabled: busy, onClick: onCancel }, t('cancel')),
				h('button', {
					type: 'button',
					className: danger ? 'pa-btnDanger' : 'pa-btnPrimary',
					disabled: busy || confirmDisabled === true,
					onClick: onConfirm,
				}, busy ? t(busyLabel ?? 'saving') : t(confirmLabel)))
		}
		//#endregion

		//#region dialogs
		/** Add or edit one account of a provider. */
		function AccountDialog({ t, state, operations, controller, request, onClose, onSaved }) {
			const editing = request.kind === 'account-edit'
			const provider = state.providers[request.providerIndex]
			const account = editing ? provider?.accounts[request.accountIndex] : undefined
			const fieldId = React.useId()
			const fallbackRef = editing ? account?.ref ?? '' : nextAccountRef(provider, state.routes[provider?.id ?? ''])
			const [label, setLabel] = React.useState(editing ? account?.label ?? '' : defaultAccountLabel(t, provider))
			const [ref, setRef] = React.useState(fallbackRef)
			const [key, setKey] = React.useState('')
			const [advanced, setAdvanced] = React.useState(false)
			const [busy, setBusy] = React.useState(false)
			const [error, setError] = React.useState(null)
			if (provider === undefined || (editing && account === undefined)) return null
			const routeMissing = asString(state.routes[provider.id]?.apiKeyEnv) === undefined
			const submit = async () => {
				if (busy) return
				setBusy(true)
				setError(null)
				const result = editing
					? await operations.updateAccount({ providerIndex: request.providerIndex, accountIndex: request.accountIndex, provider, account, label, key })
					: await operations.addAccount({ providerIndex: request.providerIndex, provider, label, key, ref, activate: routeMissing })
				setBusy(false)
				if (result.kind === 'ok') {
					onSaved(t(editing ? 'accountSaved' : 'accountAdded'))
					return
				}
				if (result.kind === 'conflict') {
					setError(t('conflict'))
					await controller.load()
					return
				}
				setError(result.key === undefined ? result.message ?? '' : t(result.key))
			}
			return h(Modal, {
				t,
				title: t(editing ? 'editAccountTitle' : 'addAccountTitle'),
				description: `${provider.name} · ${provider.id}`,
				onClose,
				busy,
				footer: h(DialogActions, { t, busy, confirmLabel: 'saveAccount', onCancel: onClose, onConfirm: submit }),
			},
				h(Field, { id: `${fieldId}-label`, label: t('accountLabel') },
					h('input', {
						id: `${fieldId}-label`,
						className: 'pa-input',
						type: 'text',
						value: label,
						disabled: busy,
						placeholder: t('accountLabelPlaceholder'),
						'data-autofocus': '',
						onChange: (event) => setLabel(event.target.value),
					})),
				h(Field, { id: `${fieldId}-key`, label: t('accountKey'), hint: editing ? t('accountKeyKeep') : undefined },
					h(KeyInput, { id: `${fieldId}-key`, value: key, onChange: setKey, disabled: busy, t, placeholder: t('accountKeyPlaceholder') })),
				editing
					? h('p', { className: 'pa-hint' }, `${t('accountRef')}: ${account.ref}`)
					: h('div', null,
						h('button', {
							type: 'button',
							className: 'pa-disclosure',
							'aria-expanded': advanced,
							onClick: () => setAdvanced(!advanced),
						}, t('advanced')),
						advanced ? h('div', { className: 'pa-advanced' },
							h(Field, { id: `${fieldId}-ref`, label: t('accountRef'), hint: t('accountRefHint') },
								h('input', {
									id: `${fieldId}-ref`,
									className: 'pa-input',
									type: 'text',
									value: ref,
									disabled: busy,
									spellCheck: false,
									autoCapitalize: 'off',
									onChange: (event) => setRef(event.target.value),
								}))) : null),
				error === null ? null : h('p', { className: 'pa-error', role: 'alert' }, error))
		}

		/** Confirm deleting one account, optionally with its stored key. */
		function DeleteAccountDialog({ t, operations, controller, request, onClose, onSaved }) {
			const [busy, setBusy] = React.useState(false)
			const [removeCredential, setRemoveCredential] = React.useState(false)
			const [error, setError] = React.useState(null)
			const submit = async () => {
				if (busy) return
				setBusy(true)
				setError(null)
				const result = await operations.removeAccount({
					providerIndex: request.providerIndex,
					accountIndex: request.accountIndex,
					provider: request.provider,
					account: request.account,
					removeCredential,
				})
				setBusy(false)
				if (result.kind === 'ok') {
					onSaved(t('accountSaved'))
					return
				}
				if (result.kind === 'conflict') {
					setError(t('conflict'))
					await controller.load()
					return
				}
				setError(result.message ?? '')
			}
			return h(Modal, {
				t,
				title: t('removeAccountTitle'),
				description: copy(t('removeAccountDescription'), { provider: request.provider.name }),
				onClose,
				busy,
				footer: h(DialogActions, {
					t,
					busy,
					confirmLabel: 'removeAccountConfirm',
					onCancel: onClose,
					onConfirm: submit,
					danger: true,
				}),
			},
				h('p', { className: 'pa-hint' }, `${request.account.label} · ${request.account.ref}`),
				h(CheckRow, { t, checked: removeCredential, onChange: setRemoveCredential, disabled: busy }),
				error === null ? null : h('p', { className: 'pa-error', role: 'alert' }, error))
		}

		/** Confirm deleting a provider, its route, and optionally its keys. */
		function DeleteProviderDialog({ t, operations, controller, request, onClose, onSaved }) {
			const [busy, setBusy] = React.useState(false)
			const [removeCredential, setRemoveCredential] = React.useState(false)
			const [error, setError] = React.useState(null)
			const submit = async () => {
				if (busy) return
				setBusy(true)
				setError(null)
				const result = await operations.removeProvider({
					providerIndex: request.providerIndex,
					provider: request.provider,
					removeCredential,
				})
				setBusy(false)
				if (result.kind === 'ok') {
					onSaved(t('providerRemoved'))
					return
				}
				if (result.kind === 'conflict') {
					setError(t('conflict'))
					await controller.load()
					return
				}
				setError(result.message ?? '')
			}
			return h(Modal, {
				t,
				title: copy(t('removeProviderTitle'), { provider: request.provider.name }),
				description: copy(t('removeProviderDescription'), { provider: request.provider.name }),
				onClose,
				busy,
				footer: h(DialogActions, {
					t,
					busy,
					confirmLabel: 'removeProviderConfirm',
					onCancel: onClose,
					onConfirm: submit,
					danger: true,
				}),
			},
				h(CheckRow, { t, checked: removeCredential, onChange: setRemoveCredential, disabled: busy }),
				error === null ? null : h('p', { className: 'pa-error', role: 'alert' }, error))
		}

		/** One catalog panel row. */
		function PresetCandidate({ preset, active, disabled, onSelect }) {
			return h('li', null,
				h('button', {
					type: 'button',
					className: 'pa-candidate',
					'data-active': active ? 'true' : undefined,
					'aria-pressed': active,
					disabled,
					onClick: onSelect,
				},
					h('span', { className: 'pa-candidateName' }, preset.name),
					h('span', { className: 'pa-candidateMeta' }, preset.env)))
		}

		/** Add a provider: catalog preset or hand-declared endpoint. */
		function AddProviderDialog({ t, state, operations, controller, onClose, onSaved }) {
			const fieldId = React.useId()
			const [mode, setMode] = React.useState('catalog')
			const [busy, setBusy] = React.useState(false)
			const [error, setError] = React.useState(null)
			// Catalog mode draft.
			const [search, setSearch] = React.useState('')
			const [presetId, setPresetId] = React.useState(undefined)
			const [name, setName] = React.useState('')
			const [label, setLabel] = React.useState(t('primaryAccountLabel'))
			const [key, setKey] = React.useState('')
			const [ref, setRef] = React.useState('')
			// Custom mode draft.
			const [customId, setCustomId] = React.useState('')
			const [customName, setCustomName] = React.useState('')
			const [protocol, setProtocol] = React.useState(PROTOCOLS[0].value)
			const [baseUrl, setBaseUrl] = React.useState('')
			const [customKey, setCustomKey] = React.useState('')
			const [customLabel, setCustomLabel] = React.useState(t('primaryAccountLabel'))
			const [customRef, setCustomRef] = React.useState('')
			const [models, setModels] = React.useState([])
			// OAuth preset (Grok Build): the sign-in runs inside the dialog.
			const [oauthStatus, setOauthStatus] = React.useState('idle')
			const [oauthDevice, setOauthDevice] = React.useState(null)
			const [oauthEmail, setOauthEmail] = React.useState(undefined)
			const [oauthError, setOauthError] = React.useState(null)
			const oauthPollRef = React.useRef(null)
			React.useEffect(() => () => {
				if (oauthPollRef.current !== null) clearInterval(oauthPollRef.current)
			}, [])
			const [discovering, setDiscovering] = React.useState(false)
			const preset = PRESETS.find((candidate) => candidate.id === presetId)
			const query = search.trim().toLowerCase()
			const visible = query.length === 0 ? PRESETS : PRESETS.filter((candidate) => `${candidate.id} ${candidate.name} ${candidate.env}`.toLowerCase().includes(query))
			const choose = (candidate) => {
				setPresetId(candidate.id)
				setName(candidate.name)
				setRef(refFromRoute(candidate.id))
				setError(null)
			}
			const discover = async () => {
				if (discovering) return
				const endpoint = baseUrl.trim()
				if (endpoint.length === 0) {
					setError(t('customNeedsBaseUrl'))
					return
				}
				if (!isHttpUrl(endpoint)) {
					setError(t('customBaseUrlInvalid'))
					return
				}
				const failure = apiKeyFailure(customKey.trim())
				if (failure !== undefined) {
					setError(t(failure))
					return
				}
				setDiscovering(true)
				setError(null)
				setModels([])
				const result = await operations.discover({ baseURL: endpoint, api: protocol, apiKey: customKey.trim() })
				setDiscovering(false)
				if (result.kind !== 'found') {
					setError(result.message ?? t('testFailedLoad'))
					return
				}
				const found = result.models.map(discoveredModel).filter((model) => model !== undefined)
				if (found.length === 0) {
					setError(t('discoverEmpty'))
					return
				}
				setModels(found)
			}
			/**
			 * The custom endpoint's credential reference: the typed name once there
			 * is one, otherwise the route-derived default shown in the same field.
			 */
			/**
			 * The custom endpoint's credential reference: the typed name once there
			 * is one, otherwise the route-derived default shown in the same field.
			 */
			const effectiveCustomRef = customRef.trim().length > 0 ? customRef.trim() : refFromRoute(customId.trim())
			/** Device sign-in used by the OAuth preset. */
			const startOauth = async () => {
				if (oauthStatus === 'starting' || oauthStatus === 'waiting') return
				setOauthStatus('starting')
				setOauthError(null)
				try {
					const response = await fetch(GROK_URL + '/start', { method: 'POST', credentials: 'same-origin' })
					const body = await response.json()
					if (body?.ok !== true) {
						setOauthStatus('failed')
						setOauthError(body?.error ?? t('grokLoginFailed'))
						return
					}
					const device = body.device
					setOauthDevice(device)
					setOauthStatus('waiting')
					const deadline = Date.now() + (device.expiresInMs ?? 600000)
					oauthPollRef.current = setInterval(async () => {
						if (Date.now() > deadline) {
							clearInterval(oauthPollRef.current)
							setOauthStatus('failed')
							setOauthError(t('grokCodeExpired'))
							return
						}
						try {
							const poll = await fetch(GROK_URL + '/poll', {
								method: 'POST',
								credentials: 'same-origin',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ deviceCode: device.deviceCode }),
							})
							const result = await poll.json()
							if (result?.status === 'ok') {
								clearInterval(oauthPollRef.current)
								oauthPollRef.current = null
								setOauthStatus('ok')
								setOauthDevice(null)
								setOauthEmail(result.tokens?.email)
								if (typeof result.tokens?.email === 'string' && result.tokens.email.length > 0) setLabel(result.tokens.email)
								return
							}
							if (result?.status === 'denied' || result?.status === 'failed') {
								clearInterval(oauthPollRef.current)
								oauthPollRef.current = null
								setOauthStatus('failed')
								setOauthError(result.message ?? t('grokLoginFailed'))
								setOauthDevice(null)
							}
						} catch {
							// Retry on the next tick.
						}
					}, Math.max(2000, device.intervalMs ?? 5000))
				} catch (error) {
					setOauthStatus('failed')
					setOauthError(messageOf(error))
				}
			}
			const submit = async () => {
				if (busy) return
				setBusy(true)
				setError(null)
				const result = mode === 'catalog'
					? (preset === undefined
						? { kind: 'invalid', key: 'presetRequired' }
						: preset.oauth === true
							? (oauthStatus !== 'ok'
								? { kind: 'invalid', key: 'grokLoginRequired' }
								: await operations.ensureGrokProvider({ index: state.providers.length, label: label.trim().length > 0 ? label.trim() : oauthEmail ?? t('grokAccount') }))
							: await operations.addCatalogProvider({ preset, name, label, key, ref: ref.trim() }))
					: await operations.addCustomProvider({
						id: customId,
						name: customName,
						api: protocol,
						baseURL: baseUrl,
						models,
						label: customLabel,
						key: customKey,
						ref: effectiveCustomRef,
					})
				setBusy(false)
				if (result.kind === 'ok') {
					const added = mode === 'catalog' ? name.trim() : customName.trim()
					onSaved(copy(t('providerAdded'), { provider: added }))
					return
				}
				if (result.kind === 'conflict') {
					setError(t('conflict'))
					await controller.load()
					return
				}
				setError(result.key === undefined ? result.message ?? '' : t(result.key))
			}
			const catalogBody = [
				h('div', { key: 'search', className: 'pa-field' },
					h('label', { className: 'pa-label', htmlFor: `${fieldId}-search` }, t('presetSearch')),
					h('input', {
						id: `${fieldId}-search`,
						className: 'pa-input',
						type: 'search',
						value: search,
						disabled: busy,
						placeholder: t('presetSearch'),
						'data-autofocus': presetId === undefined ? '' : undefined,
						onChange: (event) => setSearch(event.target.value),
					})),
				h('p', { key: 'hint', className: 'pa-hint' }, t('chooseProviderHint')),
				visible.length === 0
					? h('p', { key: 'empty', className: 'pa-hint' }, t('presetEmpty'))
					: h('ul', { key: 'list', className: 'pa-candidateList', role: 'list' },
						visible.map((candidate) => h(PresetCandidate, {
							key: candidate.id,
							preset: candidate,
							active: candidate.id === presetId,
							disabled: busy,
							onSelect: () => choose(candidate),
						}))),
				h(Field, { key: 'name', id: `${fieldId}-name`, label: t('providerName') },
					h('input', {
						id: `${fieldId}-name`,
						className: 'pa-input',
						type: 'text',
						value: name,
						disabled: busy,
						placeholder: t('providerNamePlaceholder'),
						onChange: (event) => setName(event.target.value),
					})),
				h(Field, { key: 'label', id: `${fieldId}-label`, label: t('accountLabel') },
					h('input', {
						id: `${fieldId}-label`,
						className: 'pa-input',
						type: 'text',
						value: label,
						disabled: busy,
						placeholder: t('accountLabelPlaceholder'),
						onChange: (event) => setLabel(event.target.value),
					})),
				preset?.oauth === true
					? h('div', { key: 'oauth', className: 'pa-field' },
						h('p', { className: 'pa-hint' }, t('grokOauthExplain')),
						h('div', { className: 'pa-rowActions' },
							h('button', {
								type: 'button',
								className: 'pa-btnPrimary pa-btnSmall',
								disabled: busy || oauthStatus === 'waiting' || oauthStatus === 'starting',
								onClick: () => { void startOauth() },
							}, t(oauthStatus === 'ok' ? 'grokRelogin' : oauthStatus === 'waiting' ? 'grokWaitingShort' : 'grokLogin'))),
						oauthDevice === null ? null : h('div', { className: 'pa-grokCode' },
							h('span', { className: 'pa-grokCodeValue' }, oauthDevice.userCode),
							h('a', {
								className: 'pa-btnLink',
								href: oauthDevice.verificationUriComplete ?? oauthDevice.verificationUri,
								target: '_blank',
								rel: 'noreferrer',
							}, t('grokOpenLink'))),
						oauthStatus === 'ok'
							? h('p', { className: 'pa-hint pa-testOk' }, copy(t('grokSignedIn'), { account: oauthEmail ?? t('grokAccount') }))
							: null,
						oauthError === null ? null : h('p', { className: 'pa-hint pa-error', role: 'alert' }, oauthError))
					: null,
				preset?.oauth === true ? null : h(Field, { key: 'key', id: `${fieldId}-key`, label: t('accountKey'), hint: preset === undefined ? undefined : copy(t('presetEnvHint'), { env: preset.env }) },
					h(KeyInput, { id: `${fieldId}-key`, value: key, onChange: setKey, disabled: busy, t })),
				preset?.oauth === true ? null : h(Field, { key: 'ref', id: `${fieldId}-ref`, label: t('accountRef'), hint: t('accountRefHint') },
					h('input', {
						id: `${fieldId}-ref`,
						className: 'pa-input',
						type: 'text',
						value: ref,
						disabled: busy,
						spellCheck: false,
						autoCapitalize: 'off',
						onChange: (event) => setRef(event.target.value),
					})),
			]
			const customBody = [
				h(Field, { key: 'id', id: `${fieldId}-cid`, label: t('customId'), hint: t('customIdHint') },
					h('input', {
						id: `${fieldId}-cid`,
						className: 'pa-input',
						type: 'text',
						value: customId,
						disabled: busy,
						spellCheck: false,
						autoCapitalize: 'off',
						placeholder: t('customIdPlaceholder'),
						'data-autofocus': '',
						onChange: (event) => setCustomId(event.target.value),
					})),
				h(Field, { key: 'name', id: `${fieldId}-cname`, label: t('providerName') },
					h('input', {
						id: `${fieldId}-cname`,
						className: 'pa-input',
						type: 'text',
						value: customName,
						disabled: busy,
						placeholder: t('providerNamePlaceholder'),
						onChange: (event) => setCustomName(event.target.value),
					})),
				h(Field, { key: 'api', id: `${fieldId}-api`, label: t('customApi') },
					h('select', {
						id: `${fieldId}-api`,
						className: 'pa-input',
						value: protocol,
						disabled: busy,
						onChange: (event) => setProtocol(event.target.value),
					}, PROTOCOLS.map((option) => h('option', { key: option.value, value: option.value }, t(option.key))))),
				h(Field, { key: 'url', id: `${fieldId}-url`, label: t('baseUrl') },
					h('input', {
						id: `${fieldId}-url`,
						className: 'pa-input',
						type: 'url',
						value: baseUrl,
						disabled: busy,
						placeholder: t('baseUrlPlaceholder'),
						spellCheck: false,
						onChange: (event) => setBaseUrl(event.target.value),
					})),
				h(Field, { key: 'ckey', id: `${fieldId}-ckey`, label: t('accountKey') },
					h(KeyInput, { id: `${fieldId}-ckey`, value: customKey, onChange: setCustomKey, disabled: busy, t })),
				h('div', { key: 'discover', className: 'pa-cardActions' },
					h('button', { type: 'button', className: 'pa-btnSecondary pa-btnSmall', disabled: busy || discovering, onClick: discover }, t(discovering ? 'discovering' : 'discover'))),
				models.length === 0 ? null : h('div', { key: 'models', className: 'pa-field' },
					h('span', { className: 'pa-label' }, copy(t('modelsFound'), { count: models.length })),
					h('ul', { className: 'pa-modelList' },
						models.map((model) => h('li', { key: model.id, className: 'pa-modelRow' },
							h('span', { className: 'pa-modelId', title: model.id }, model.name === model.id ? model.id : `${model.name} · ${model.id}`),
							h('span', { className: 'pa-modelMeta' }, `${model.contextWindow} / ${model.maxTokens}`))))),
				h(Field, { key: 'clabel', id: `${fieldId}-clabel`, label: t('accountLabel') },
					h('input', {
						id: `${fieldId}-clabel`,
						className: 'pa-input',
						type: 'text',
						value: customLabel,
						disabled: busy,
						placeholder: t('accountLabelPlaceholder'),
						onChange: (event) => setCustomLabel(event.target.value),
					})),
				h(Field, { key: 'cref', id: `${fieldId}-cref`, label: t('accountRef'), hint: t('accountRefHint') },
					h('input', {
						id: `${fieldId}-cref`,
						className: 'pa-input',
						type: 'text',
						value: customRef.length === 0 ? refFromRoute(customId.trim()) : customRef,
						disabled: busy,
						spellCheck: false,
						autoCapitalize: 'off',
						onChange: (event) => setCustomRef(event.target.value),
					})),
			]
			return h(Modal, {
				t,
				title: t('addProviderTitle'),
				onClose,
				busy,
				footer: h(DialogActions, {
					t,
					busy,
					confirmLabel: 'createProvider',
					busyLabel: 'creating',
					onCancel: onClose,
					onConfirm: submit,
				}),
			},
				h('div', { className: 'pa-tabs', role: 'tablist', 'aria-label': t('addProvider') },
					h('button', {
						type: 'button',
						role: 'tab',
						className: 'pa-tab',
						'data-active': mode === 'catalog' ? 'true' : undefined,
						'aria-selected': mode === 'catalog',
						disabled: busy,
						onClick: () => { setMode('catalog'); setError(null) },
					}, t('modeCatalog')),
					h('button', {
						type: 'button',
						role: 'tab',
						className: 'pa-tab',
						'data-active': mode === 'custom' ? 'true' : undefined,
						'aria-selected': mode === 'custom',
						disabled: busy,
						onClick: () => { setMode('custom'); setError(null) },
					}, t('modeCustom'))),
				mode === 'catalog' ? catalogBody : customBody,
				error === null ? null : h('p', { className: 'pa-error', role: 'alert' }, error))
		}
		//#endregion

		//#region page pieces
		/** One account row with its activate/test/edit/delete actions. */
		function AccountRow({ t, provider, providerIndex, account, accountIndex, active, configured, disabled, testState, onAction, onTest, onProbe, native, grok, onGrokLogin, onGrokLogout, usage }) {
			const key = `account:${providerIndex}:${accountIndex}`
			const meters = usage?.balance === undefined || usage.balance.ok !== true ? [] : usage.balance.meters
			const totals = usage?.totals
			const balanceFailure = usage?.balance !== undefined && usage.balance.ok !== true ? usage.balance : undefined
			const usageDetail = meters.length === 0 && totals === undefined && balanceFailure === undefined
				? null
				: h('span', { className: 'pa-accountUsage' },
					meters.length === 0 ? null : h('span', {
						className: 'pa-usageMeters',
						role: 'group',
						'aria-label': copy(t('gaugeGroupLabel'), { account: account.label }),
					}, meters.map((meter) => h(CompactMeter, { key: meter.id, t, meter }))),
					totals === undefined ? null : h('span', { className: 'pa-usageText' }, copy(t('usageLine'), {
						tokens: formatTokens(totals.tokens),
						requests: formatCount(totals.requests),
						failures: formatCount(totals.failures),
					})),
					balanceFailure === undefined ? null : h('span', { className: 'pa-usageWarn' },
						balanceFailure.error.length === 0 ? t('balanceUnavailable') : copy(t('balanceUnavailableLine'), { message: balanceFailure.error })))
			const grokDetail = native === true
				? h('span', { className: 'pa-grokDetail' },
					h('span', { className: cx('pa-grokStatus', grok?.status === 'failed' && 'pa-error') }, grok?.status === 'signedIn'
						? copy(t('grokSignedIn'), { account: grok.email ?? t('grokAccount') })
						: grok?.status === 'waiting'
							? t('grokWaiting')
							: grok?.status === 'failed'
								? grok.message ?? t('grokLoginFailed')
								: t('grokSignedOut')),
					grok?.device === null || grok?.device === undefined ? null : h('span', { className: 'pa-grokCode' },
						h('span', { className: 'pa-grokCodeValue' }, grok.device.userCode),
						h('a', {
							className: 'pa-btnLink',
							href: grok.device.verificationUriComplete ?? grok.device.verificationUri,
							target: '_blank',
							rel: 'noreferrer',
						}, t('grokOpenLink'))),
					)
				: null
			const testMessage = testState === undefined ? null : h('p', {
				className: cx('pa-testLine', testState.status === 'ok' ? 'pa-testOk' : testState.status === 'error' ? 'pa-testError' : undefined),
				role: 'status',
			}, testState.message)
			return h('li', { className: 'pa-account' },
				h(StatusDot, { on: configured, label: t(configured ? 'credentialConfigured' : 'credentialMissing') }),
				h('div', { className: 'pa-accountIdentity' },
					h('span', { className: 'pa-accountLabel' },
						account.label,
						active ? h('span', { className: 'pa-badge' }, t('activeAccount')) : null),
					h('span', { className: 'pa-ref', title: account.ref }, account.ref),
					grokDetail,
					usageDetail,
					testMessage),
				h('span', { className: 'pa-rowActions' },
					native === true ? h('button', {
						type: 'button',
						className: 'pa-btnPrimary pa-btnSmall',
						disabled: disabled || grok?.status === 'waiting' || grok?.status === 'starting',
						onClick: () => { void onGrokLogin() },
					}, t(grok?.status === 'signedIn' ? 'grokRelogin' : grok?.status === 'waiting' ? 'grokWaitingShort' : 'grokLogin')) : null,
					active ? null : h('button', {
						type: 'button',
						className: 'pa-btnSecondary pa-btnSmall',
						disabled,
						onClick: () => onAction({ kind: 'activate', providerIndex, provider, account }),
					}, t('activate')),
					h('button', {
						type: 'button',
						className: 'pa-btnSecondary pa-btnSmall',
						disabled: disabled || testState?.status === 'running',
						onClick: () => (native
							? onProbe(key)
							: onTest(key, { provider: provider.id, ref: account.ref }, active ? undefined : t('testInactiveNote'))),
					}, t(testState?.status === 'running' ? 'testing' : 'test')),
					native === true ? null : h('button', {
						type: 'button',
						className: 'pa-btnSecondary pa-btnSmall',
						disabled,
						onClick: () => onAction({ kind: 'account-edit', providerIndex, provider, accountIndex, account }),
					}, t('edit')),
					native === true ? h('button', {
						type: 'button',
						className: 'pa-btnSecondary pa-btnSmall',
						disabled: disabled || grok?.status !== 'signedIn',
						onClick: () => { void onGrokLogout() },
					}, t('grokLogout')) : null,
					h('button', {
						type: 'button',
						className: 'pa-btnDanger pa-btnSmall',
						disabled,
						onClick: () => onAction({ kind: 'account-delete', providerIndex, provider, accountIndex, account }),
					}, t('remove'))))
		}

		/** One provider card: identity, status, accounts, and card-level actions. */
		function ProviderCard({ t, state, provider, providerIndex, disabled, testState, onAction, onTest, onProbe, onAddAccount, grok, onGrokLogin, onGrokLogout, usageData }) {
			const route = state.routes[provider.id]
			// Providers this plugin serves itself have no pi-ai route by design.
			const native = provider.id === GROK_PROVIDER
			const activeRef = asString(route?.apiKeyEnv)
			const active = provider.accounts.find((account) => account.ref === activeRef) ?? provider.accounts[0]
			const activeConfigured = active === undefined ? false : credentialConfigured(state.credentials, active.ref)
			const diagnostic = asString(state.diagnostics?.[provider.id]?.error)
			const providerTest = testState(`provider:${providerIndex}`)
			return h('li', { className: 'pa-card' },
				h('div', { className: 'pa-cardHead' },
					h('span', { className: 'pa-name' }, provider.name),
					h('span', { className: 'pa-chip', title: provider.id }, provider.id),
					active === undefined ? null : h(StatusDot, { on: activeConfigured, label: t(activeConfigured ? 'credentialConfigured' : 'credentialMissing') }),
					provider.catalog ? h('span', { className: 'pa-chip' }, t('catalogTag')) : null,
					h('span', { className: 'pa-rowActions' },
						h('button', {
							type: 'button',
							className: 'pa-btnSecondary pa-btnSmall',
							disabled: disabled || providerTest?.status === 'running',
							onClick: () => (native
								? onProbe(`provider:${providerIndex}`)
								: onTest(`provider:${providerIndex}`, { provider: provider.id }, undefined)),
						}, t(providerTest?.status === 'running' ? 'testing' : 'test')),
						h('button', {
							type: 'button',
							className: 'pa-btnDanger pa-btnSmall',
							disabled,
							onClick: () => onAction({ kind: 'provider-delete', providerIndex, provider }),
						}, t('removeProvider')))),
				diagnostic === undefined ? null : h('p', { className: 'pa-routeError', role: 'alert' }, diagnostic),
				native || provider.accounts.length === 0
					? null
					: h('div', { className: 'pa-switcher' },
						h('span', { className: 'pa-switcherLabel' }, t('switchAccount')),
						h('div', {
							className: 'pa-switcherButtons',
							role: 'group',
							'aria-label': copy(t('switchGroupLabel'), { provider: provider.name }),
						},
							provider.accounts.map((candidate, accountIndex) => {
								const isActive = candidate === active
								return h('button', {
									key: `${candidate.id}:${accountIndex}`,
									type: 'button',
									className: cx('pa-switchBtn', isActive && 'pa-switchActive'),
									'aria-pressed': isActive ? 'true' : 'false',
									title: candidate.ref,
									disabled,
									onClick: () => {
										if (!isActive) onAction({ kind: 'activate', providerIndex, provider, account: candidate, accountIndex })
									},
								}, candidate.label)
							})),
						h('span', { className: 'pa-switcherHint' }, t('switchHint'))),
				native
					? h('div', { className: 'pa-routeRepair' },
						h('p', { className: 'pa-hint' }, t('nativeProviderHint')))
					: route === undefined
					? h('div', { className: 'pa-routeRepair' },
						h('p', { className: 'pa-hint' }, t('providerRouteMissing')),
						provider.accounts.length === 0 || disabled
							? null
							: h('button', {
								type: 'button',
								className: 'pa-btnSecondary pa-btnSmall',
								onClick: () => onAction({ kind: 'activate', providerIndex, provider, account: provider.accounts[0] }),
							}, t('createRoute')))
					: null,
				provider.accounts.length === 0
					? h('p', { className: 'pa-hint' }, t('noAccounts'))
					: h('ul', { className: 'pa-accountList' },
						provider.accounts.map((account, accountIndex) => h(AccountRow, {
							key: `${account.ref}:${accountIndex}`,
							t,
							provider,
							providerIndex,
							account,
							accountIndex,
							native,
							onProbe: (key) => onProbe(key),
							usage: usageSlice(usageData, provider.id, account),
							grok,
							onGrokLogin,
							onGrokLogout,
							active: account === active,
							configured: credentialConfigured(state.credentials, account.ref),
							disabled,
							testState: testState(`account:${providerIndex}:${accountIndex}`),
							onAction,
							onTest,
						}))),
				providerTest?.message === undefined ? null : h('p', {
					className: cx('pa-testLine', providerTest.status === 'ok' ? 'pa-testOk' : 'pa-testError'),
					role: 'status',
				}, providerTest.message),
				h('div', { className: 'pa-cardActions' },
					h('button', { type: 'button', className: 'pa-btnSecondary pa-btnSmall', disabled, onClick: () => onAddAccount(providerIndex, provider) }, t('addAccount'))))
		}

		/** First-run empty state plus the llm-pi-ai import card. */
		function EmptyState({ t, state, disabled, importing, onAdd, onImport, importError }) {
			const routes = Object.entries(state.routes ?? {})
			return h(React.Fragment, null,
				h('div', { className: 'pa-emptyCard' },
					h('p', { className: 'pa-cardTitle' }, t('emptyTitle')),
					h('p', { className: 'pa-hint' }, t('emptyDescription')),
					h('div', { className: 'pa-cardActions' },
						h('button', { type: 'button', className: 'pa-btnPrimary', disabled, onClick: onAdd }, t('addProvider')))),
				routes.length === 0 ? null : h('div', { className: 'pa-emptyCard' },
					h('p', { className: 'pa-cardTitle' }, t('importTitle')),
					h('p', { className: 'pa-hint' }, t('importDescription')),
					h('ul', { className: 'pa-importList' },
						routes.map(([id, route]) => h('li', { key: id, className: 'pa-importRow' },
							h('span', { className: 'pa-chip' }, id),
							h('span', { className: 'pa-hint' }, asString(route?.apiKeyEnv) === undefined ? t('importRefUnset') : copy(t('importRefSet'), { ref: asString(route.apiKeyEnv) }))))),
					importError === null ? null : h('p', { className: 'pa-error', role: 'alert' }, importError),
					h('div', { className: 'pa-cardActions' },
						h('button', { type: 'button', className: 'pa-btnSecondary', disabled: disabled || importing, onClick: onImport }, t(importing ? 'importing' : 'importAction')))))
		}

		/** The failover footer card. */
		function FailoverCard({ t, state, disabled, busy, onToggle }) {
			const failover = state.failover ?? { enabled: false, codes: [], maxHops: undefined }
			return h('div', { className: 'pa-failoverCard' },
				h('div', { className: 'pa-switchRow' },
					h('p', { className: 'pa-cardTitle' }, t('failoverTitle')),
					h(Switch, {
						checked: failover.enabled === true,
						onChange: onToggle,
						label: t('failoverTitle'),
						disabled: disabled || busy,
					})),
				h('p', { className: 'pa-hint' }, t('failoverHint')),
				h('div', { className: 'pa-codeChips' },
					h('span', { className: 'pa-hint' }, t('failoverCodes')),
					failover.codes.length === 0
						? h('span', { className: 'pa-hint' }, t('failoverNoCodes'))
						: failover.codes.map((code) => h('span', { key: code, className: 'pa-code' }, code))),
				failover.maxHops === undefined ? null : h('p', { className: 'pa-hint' }, copy(t('failoverHops'), { hops: failover.maxHops })))
		}

		/** The settings page itself. */
		function ProviderAccountsSection(props) {
			const { t, controller, operations, usage } = props
			const state = useSnapshot(controller)
			// The same ledger the quota pill reads: one row per account, so the settings
			// page and the header never disagree about what an account has used.
			const usageState = useSnapshot(usage)
			const usageData = usageState?.data ?? null
			const [notice, setNotice] = React.useState(null)
			const [dialog, setDialog] = React.useState(null)
			const [tests, setTests] = React.useState({})
			const [importing, setImporting] = React.useState(false)
			const [importError, setImportError] = React.useState(null)
			const [savingFailover, setSavingFailover] = React.useState(false)
			/** The account whose activation write is in flight, if any. */
			const [activating, setActivating] = React.useState(undefined)
			// Native Grok Build sign-in state.
			const [grok, setGrok] = React.useState({ status: 'idle' })
			const [grokDevice, setGrokDevice] = React.useState(null)
			const [grokBusy, setGrokBusy] = React.useState(false)
			const [grokProbe, setGrokProbe] = React.useState(null)
			const grokPollRef = React.useRef(null)
			const loadGrok = React.useCallback(async () => {
				try {
					const response = await fetch(GROK_URL + '/status', { credentials: 'same-origin' })
					const body = await response.json()
					setGrok(body !== null && typeof body === 'object' && body.signedIn === true
						? { status: 'signedIn', email: body.email, plan: body.plan, quota: body.quota, expiresAt: body.expiresAt }
						: { status: 'signedOut' })
				} catch {
					setGrok({ status: 'unavailable' })
				}
			}, [])
			React.useEffect(() => {
				void loadGrok()
				return () => {
					if (grokPollRef.current !== null) clearInterval(grokPollRef.current)
				}
			}, [loadGrok])
			const stopGrokPolling = () => {
				if (grokPollRef.current !== null) clearInterval(grokPollRef.current)
				grokPollRef.current = null
			}
			const finishGrokLogin = async () => {
				stopGrokPolling()
				setGrokDevice(null)
				setGrokBusy(false)
				await loadGrok()
				// Give the provider an entry so its billing lands in the quota pill.
				const providers = state.providers ?? []
				if (!providers.some((provider) => provider.id === GROK_PROVIDER)) {
					const index = providers.length
					await operations.ensureGrokProvider({ index, label: grok.email ?? t('grokAccount') })
					await controller.load()
				}
			}
			const startGrokLogin = async () => {
				if (grokBusy) return
				setGrokBusy(true)
				setGrok({ status: 'starting' })
				try {
					const response = await fetch(GROK_URL + '/start', { method: 'POST', credentials: 'same-origin' })
					const body = await response.json()
					if (body === null || typeof body !== 'object' || body.ok !== true) {
						setGrok({ status: 'failed', message: body?.error ?? t('grokLoginFailed') })
						setGrokBusy(false)
						return
					}
					const device = body.device
					setGrokDevice(device)
					setGrok({ status: 'waiting' })
					const deadline = Date.now() + (device.expiresInMs ?? 600000)
					grokPollRef.current = setInterval(async () => {
						if (Date.now() > deadline) {
							stopGrokPolling()
							setGrok({ status: 'failed', message: t('grokCodeExpired') })
							setGrokBusy(false)
							return
						}
						try {
							const poll = await fetch(GROK_URL + '/poll', {
								method: 'POST',
								credentials: 'same-origin',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ deviceCode: device.deviceCode }),
							})
							const result = await poll.json()
							if (result?.status === 'ok') {
								await finishGrokLogin()
								return
							}
							if (result?.status === 'denied' || result?.status === 'failed') {
								stopGrokPolling()
								setGrok({ status: 'failed', message: result.message ?? t('grokLoginFailed') })
								setGrokDevice(null)
								setGrokBusy(false)
							}
						} catch {
							// A transient poll failure is retried on the next tick.
						}
					}, Math.max(2000, device.intervalMs ?? 5000))
				} catch (error) {
					setGrok({ status: 'failed', message: messageOf(error) })
					setGrokBusy(false)
				}
			}
			/** Run the Grok probe and record it under the same key shape the key test uses. */
			const runGrokProbeFor = async (key) => {
				setTests((previous) => ({ ...previous, [key]: { status: 'running', message: t('grokProbing') } }))
				try {
					const response = await fetch(GROK_URL + '/probe', { method: 'POST', credentials: 'same-origin' })
					const body = await response.json()
					const probe = body?.probe
					const message = probe?.ok === true
						? copy(t('grokProbeOk'), { model: probe.model, count: probe.models, sample: probe.sample.length > 0 ? probe.sample : '—' })
						: copy(t('grokProbeFailed'), { stage: probe?.stage ?? 'http', error: probe?.error ?? body?.error ?? '' })
					setTests((previous) => ({ ...previous, [key]: { status: probe?.ok === true ? 'ok' : 'error', message } }))
				} catch (error) {
					setTests((previous) => ({ ...previous, [key]: { status: 'error', message: messageOf(error) } }))
				}
			}
			const runGrokProbe = async () => {
				setGrokProbe({ status: 'running' })
				try {
					const response = await fetch(GROK_URL + '/probe', { method: 'POST', credentials: 'same-origin' })
					const body = await response.json()
					const probe = body?.probe
					if (probe?.ok === true) {
						setGrokProbe({ status: 'ok', text: copy(t('grokProbeOk'), { model: probe.model, count: probe.models, sample: probe.sample.length > 0 ? probe.sample : '—' }) })
					} else {
						setGrokProbe({ status: 'error', text: copy(t('grokProbeFailed'), { stage: probe?.stage ?? 'http', error: probe?.error ?? body?.error ?? '' }) })
					}
				} catch (error) {
					setGrokProbe({ status: 'error', text: messageOf(error) })
				}
			}
			const logoutGrok = async () => {
				if (grokBusy) return
				setGrokBusy(true)
				try {
					await fetch(GROK_URL + '/logout', { method: 'POST', credentials: 'same-origin' })
				} catch {
					// Signing out locally is best effort.
				}
				setGrokBusy(false)
				await loadGrok()
			}
			React.useEffect(() => {
				controller.markOpened()
			}, [controller])
			React.useEffect(() => {
				if (usage === undefined) return undefined
				usage.markOpened()
				const timer = setInterval(() => {
					if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
					if (!usage.shouldPoll()) return
					void usage.load({ silent: true })
				}, 30_000)
				return () => clearInterval(timer)
			}, [usage])
			const announce = (kind, text) => setNotice({ kind, text })
			const saved = (message) => {
				setDialog(null)
				announce('success', message ?? t('saved'))
				void controller.load()
			}
			const openDialog = (request) => {
				setNotice(null)
				setDialog(request)
			}
			const runTest = async (key, request, suffix) => {
				setTests((previous) => ({ ...previous, [key]: { status: 'running', message: t('testing') } }))
				// A catalogue-backed route answers discovery without any network call, so it
				// cannot vouch for the key. Ask the Host to verify the credential first.
				const probe = await operations.testKey({ providerId: request.provider, ref: request.ref })
				if (probe.kind === 'invalid') {
					setTests((previous) => ({ ...previous, [key]: { status: 'error', message: probe.message } }))
					return
				}
				const result = await operations.discover(request)
				if (result.kind === 'found') {
					const verified = probe.kind === 'valid'
					const message = (verified
						? copy(t('testKeyOk'), { count: result.models.length })
						: copy(t('testOk'), { count: result.models.length }) + ' ' + t('testUnverified')) + (suffix === undefined ? '' : ` ${suffix}`)
					setTests((previous) => ({ ...previous, [key]: { status: 'ok', message } }))
					return
				}
				setTests((previous) => ({ ...previous, [key]: { status: 'error', message: result.message ?? t('testFailedLoad') } }))
			}
			const onAction = async (request) => {
				if (request.kind === 'activate') {
					if (activating !== undefined) return
					setActivating(`${request.providerIndex}:${request.accountIndex}`)
					setNotice(null)
					const result = await operations.activateAccount({ provider: request.provider, account: request.account })
					setActivating(undefined)
					if (result.kind === 'ok') {
						announce('success', copy(t('switchedTo'), { account: request.account.label }))
						void controller.load()
						return
					}
					announce('error', result.kind === 'conflict' ? t('conflict') : result.message ?? '')
					if (result.kind === 'conflict') void controller.load()
					return
				}
				openDialog(request)
			}
			const toggleFailover = async (enabled) => {
				if (savingFailover) return
				setSavingFailover(true)
				setNotice(null)
				const result = await operations.setFailover({ enabled })
				setSavingFailover(false)
				if (result.kind === 'ok') {
					announce('success', t('failoverSaved'))
					void controller.load()
					return
				}
				announce('error', result.kind === 'conflict' ? t('conflict') : result.message ?? '')
				if (result.kind === 'conflict') void controller.load()
			}
			const importDetected = async () => {
				if (importing) return
				setImporting(true)
				setImportError(null)
				const entries = Object.entries(state.routes ?? {}).map(([id, route]) => ({ id, route }))
				const result = await operations.importRoutes({ entries, accountLabel: t('importAccountLabel') })
				setImporting(false)
				if (result.kind === 'ok') {
					announce('success', copy(t('importDone'), { count: entries.length }))
					void controller.load()
					return
				}
				if (result.kind === 'conflict') {
					setImportError(t('conflict'))
					void controller.load()
					return
				}
				setImportError(result.key === undefined ? result.message ?? '' : t(result.key))
			}
			const header = h('div', { className: 'pa-head' },
				h('div', { className: 'pa-headText' },
					h('h2', { className: 'pa-title' }, t('title')),
					h('p', { className: 'pa-intro' }, t('intro'))),
				h('button', {
					type: 'button',
					className: 'pa-btnLink',
					disabled: state.loading,
					onClick: () => { void controller.load() },
				}, t(state.loading ? 'refreshing' : 'refresh')))
			let body
			if (state.status === 'error') {
				body = h('div', { className: 'pa-emptyCard' },
					h('p', { className: 'pa-cardTitle' }, t('loadFailed')),
					state.missing ? h('p', { className: 'pa-hint' }, t('namespaceMissing')) : null,
					h('p', { className: 'pa-error', role: 'alert' }, state.error ?? ''),
					h('div', { className: 'pa-cardActions' },
						h('button', { type: 'button', className: 'pa-btnSecondary', onClick: () => { void controller.load() } }, t('retry'))))
			} else if (state.status !== 'ready') {
				body = h('p', { className: 'pa-hint' }, t('loading'))
			} else {
				const readOnly = state.writable !== true
				const disabled = readOnly
				const testFor = (key) => tests[key]
				body = h(React.Fragment, null,
					readOnly ? h('p', { className: 'pa-notice' }, t('readOnly')) : null,
					state.error === null ? null : h('p', { className: 'pa-error', role: 'alert' }, state.error),
					notice === null ? null : h('p', {
						className: notice.kind === 'success' ? 'pa-savedNotice' : 'pa-error',
						role: notice.kind === 'success' ? 'status' : 'alert',
						'aria-live': 'polite',
					}, notice.text),
					state.providers.length === 0
						? h(EmptyState, { t, state, disabled, importing, importError, onAdd: () => openDialog({ kind: 'provider-add' }), onImport: importDetected })
						: h('ul', { className: 'pa-list' },
							state.providers.map((provider, providerIndex) => h(ProviderCard, {
								key: `${provider.id}:${providerIndex}`,
								t,
								state,
								provider,
								providerIndex,
								disabled: disabled || activating !== undefined,
								testState: testFor,
								onAction,
								onTest: runTest,
								onProbe: runGrokProbeFor,
								usageData,
								grok: { status: grok.status, email: grok.email, plan: grok.plan, quota: grok.quota, device: grokDevice, message: grok.message },
								onGrokLogin: startGrokLogin,
								onGrokLogout: logoutGrok,
								onAddAccount: (index, target) => openDialog({ kind: 'account-add', providerIndex: index, provider: target }),
							}))),
					state.providers.length === 0 ? null : h('div', { className: 'pa-cardActions' },
						h('button', { type: 'button', className: 'pa-btnSecondary', disabled, onClick: () => openDialog({ kind: 'provider-add' }) }, t('addProvider'))),
					h(FailoverCard, { t, state, disabled, busy: savingFailover, onToggle: toggleFailover }),
					dialog === null ? null : renderDialog())
			return h('div', { className: 'pa-section' }, header, body)
			}
			/** Render whichever dialog is open; each owns its own draft and busy state. */
			function renderDialog() {
				const request = dialog
				if (request === null) return null
				const shared = { t, state, operations, controller, request, onClose: () => setDialog(null), onSaved: saved }
				if (request.kind === 'account-add' || request.kind === 'account-edit') return h(AccountDialog, { key: 'account', ...shared })
				if (request.kind === 'account-delete') return h(DeleteAccountDialog, { key: 'account-delete', t, operations, controller, request, onClose: shared.onClose, onSaved: saved })
				if (request.kind === 'provider-add') return h(AddProviderDialog, { key: 'provider-add', ...shared })
				return h(DeleteProviderDialog, { key: 'provider-delete', t, operations, controller, request, onClose: shared.onClose, onSaved: saved })
			}

		}
		//#endregion

		//#region usage popover
		/** One quota window as a compact inline meter (bar + short tag + number). */
		function CompactMeter({ t, meter }) {
			const percent = Math.round(meter.percent)
			const name = t(HUD_TAG_KEYS[meter.id] ?? GAUGE_LABEL_KEYS[meter.id])
			const dollars = meterDollars(meter)
			const reset = gaugeResetText(t, meter.resetsAt)
			const title = [t(GAUGE_LABEL_KEYS[meter.id]), percent + '%', dollars, reset, meter.status === 'rate-limited' ? t('gaugeRateLimited') : undefined, meter.resetsAt]
				.filter((part) => part !== undefined)
				.join(' · ')
			return h('span', { className: 'pu-meter', title },
				h('span', { className: 'pu-meterTag' }, name),
				h('span', {
					className: 'pu-track',
					role: 'progressbar',
					'aria-valuemin': '0',
					'aria-valuemax': '100',
					'aria-valuenow': String(percent),
					'aria-label': t(GAUGE_LABEL_KEYS[meter.id]),
					'aria-valuetext': dollars === undefined ? percent + '%' : percent + '% · ' + dollars,
				},
					h('span', {
						className: cx('pu-fill', GAUGE_TONE_CLASS[gaugeTone(meter.percent, meter.status)]),
						style: { width: percent + '%' },
					})),
				h('span', { className: 'pu-pct' }, percent + '%'))
		}

		/**
		 * 14 tiny bars of the account's daily tokens. No axes or labels: the accessible
		 * name carries the window total, so the sparkline is a shape, not a chart page.
		 */
		function CompactSpark({ t, account, at }) {
			const values = []
			let total = 0
			for (let offset = 13; offset >= 0; offset -= 1) {
				const bucket = account.days[dayKeyBefore(at, offset)]
				const value = bucket === undefined ? 0 : bucket.input + bucket.output
				values.push(value)
				total += value
			}
			const peak = Math.max(...values, 1)
			const label = copy(t('sparkLabel'), { tokens: formatTokens(total) })
			return h('svg', { className: 'pu-spark', viewBox: '0 0 56 14', role: 'img', 'aria-label': label },
				values.map((value, index) => {
					const height = value === 0 ? 1 : Math.max(2, Math.round((value / peak) * 14))
					return h('rect', {
						key: index,
						x: index * 4,
						y: 14 - height,
						width: 3,
						height,
						className: value === 0 ? 'pu-sparkEmpty' : 'pu-sparkBar',
					})
				}))
		}

		/** One account row: identity, its own balance, its three meters, its usage line. */
		function CompactRow({ t, account, at, balance }) {
			const today = account.days[dayKey(at)]
			const tokensToday = today === undefined ? 0 : today.input + today.output
			const meters = balance === undefined ? [] : balance.meters
			const prepaid = balance === undefined ? undefined : balance.fields.find((field) => field.key === 'balance' && field.value.length > 0)
			const fields = balance === undefined || meters.length > 0 ? [] : balance.fields.slice(0, 3)
			return h('li', { className: 'pu-row' },
				h('span', { className: 'pu-rowLabel', title: account.ref }, account.label),
				account.active ? h('span', { className: 'pa-badge' }, t('activeAccount')) : null,
				prepaid === undefined ? null : h('span', { className: 'pu-chip', title: t('balanceChip') }, prepaid.value),
				meters.length === 0
					? fields.length === 0 ? null : h('span', { className: 'pu-quota' },
						fields.map((field, index) => h('span', { key: field.key + ':' + index, className: 'pu-meter' },
							h('span', { className: 'pu-meterTag' }, balanceFieldLabel(t, field.key)),
							h('span', { className: 'pu-pct', title: field.value }, balanceFieldValue(field.key, field.value)))))
					: h('span', { className: 'pu-quota', role: 'group', 'aria-label': copy(t('gaugeGroupLabel'), { account: account.label }) },
						meters.map((meter) => h(CompactMeter, { key: meter.id, t, meter }))),
				h('div', { className: 'pu-usage' },
					h('span', { className: 'pu-usageText' }, copy(t('usageLine'), {
						tokens: formatTokens(tokensToday),
						requests: formatCount(account.requests),
						failures: formatCount(account.failures),
					})),
					Object.keys(account.days).length === 0 ? null : h(CompactSpark, { t, account, at })),
				balance === undefined || balance.ok === true ? null : h('p', { className: 'pu-warn' },
					balance.error.length === 0 ? t('balanceUnavailable') : copy(t('balanceUnavailableLine'), { message: balance.error })),
				account.lastError === undefined ? null : h('p', { className: 'pu-error' },
					(account.lastError.code.length === 0 ? '' : account.lastError.code + ' · ') + account.lastError.message))
		}

		/**
		 * The popover body: one compact block per provider, one row per account. It
		 * keeps the two reading rules that matter — quotas as bars, usage as a line —
		 * and drops the settings-page chrome (title block, summary card, big charts).
		 */
		function UsagePopover({ t, controller }) {
			const state = useSnapshot(controller)
			const [balanceStatus, setBalanceStatus] = React.useState(null)
			const at = Date.now()
			React.useEffect(() => {
				controller.markOpened()
				// Opening the panel is an explicit "show me now": read once even when the
				// last snapshot is a second old.
				void controller.load({ silent: true })
			}, [controller])
			React.useEffect(() => {
				if (typeof document === 'undefined') return undefined
				const poll = () => {
					if (document.visibilityState === 'hidden') return
					if (!controller.shouldPoll()) return
					void controller.load({ silent: true })
				}
				const timer = setInterval(poll, USAGE_POLL_MS)
				const onVisibility = () => {
					if (document.visibilityState !== 'hidden') poll()
				}
				document.addEventListener('visibilitychange', onVisibility)
				return () => {
					clearInterval(timer)
					document.removeEventListener('visibilitychange', onVisibility)
				}
			}, [controller])
			React.useEffect(() => {
				if (balanceStatus === null) return undefined
				const timer = setTimeout(() => setBalanceStatus(null), BALANCE_STATUS_MS)
				return () => clearTimeout(timer)
			}, [balanceStatus])
			const refresh = () => {
				void controller.load()
			}
			const refreshBalances = async () => {
				if (state.balancePending) return
				setBalanceStatus(null)
				const result = await controller.refreshBalances()
				if (result.kind === 'busy') return
				if (result.kind === 'ok') {
					const firstError = firstBalanceError(result.data)
					setBalanceStatus(firstError === undefined
						? { kind: 'ok', text: t('balanceRefreshOk') }
						: { kind: 'warn', text: copy(t('balanceRefreshOkWithErrors'), { message: firstError }) })
					return
				}
				setBalanceStatus({
					kind: 'error',
					text: result.kind === 'unsupported' ? t('balanceRefreshUnsupported') : copy(t('balanceRefreshFailed'), { message: usageErrorText(t, result.error) }),
				})
			}
			const updatedAt = state.data !== null && state.data.updatedAt > 0 ? state.data.updatedAt : state.fetchedAt
			const groups = state.data === null ? [] : usageGroups(state.data)
			const retry = h('div', { className: 'pu-popActions' },
				h('button', { type: 'button', className: 'pa-btnSecondary pa-btnSmall', onClick: refresh }, t('retry')))
			let body
			if (state.status === 'unsupported') {
				body = h(React.Fragment, null,
					h('p', { className: 'pu-empty' }, t('usageUnsupported')),
					retry)
			} else if (state.status === 'error') {
				body = h(React.Fragment, null,
					h('p', { className: 'pu-error', role: 'alert' }, usageErrorText(t, state.error)),
					retry)
			} else if (state.data === null) {
				body = h('p', { className: 'pu-empty' }, t('loading'))
			} else if (groups.length === 0) {
				body = h('p', { className: 'pu-empty' }, t('usageEmptyDescription'))
			} else {
				body = groups.map((group) => h('div', { key: group.id, className: 'pu-block' },
					h('div', { className: 'pu-blockHead' },
						h('span', { className: 'pu-blockName' }, group.name),
						h('span', { className: 'pa-chip', title: group.id }, group.id),
						group.accounts.some((account) => usageBalanceOf(state.data, group.id, account.ref) !== undefined)
							? null
							: h('span', { className: 'pa-chip', title: t('noQuotaApiHint') }, t('noQuotaApi'))),
					group.accounts.length === 0
						? h('p', { className: 'pu-empty' }, t('usageNoAccounts'))
						: h('ul', { className: 'pu-rows' }, group.accounts.map((account, index) => h(CompactRow, {
							key: account.ref + ':' + index,
							t,
							account,
							at,
							balance: usageBalanceOf(state.data, group.id, account.ref),
						})))))
			}
			return h('div', { className: 'pu-pop' },
				h('div', { className: 'pu-popHead' },
					h('span', { className: 'pu-popTitle' }, t('usageTitle')),
					h('span', { className: 'pu-popActions' },
						h('button', {
							type: 'button',
							className: 'pa-btnSecondary pa-btnSmall',
							disabled: state.balancePending || state.status === 'unsupported',
							onClick: () => { void refreshBalances() },
						}, t(state.balancePending ? 'refreshingBalances' : 'refreshBalances')))),
				updatedAt === 0 ? null : h('p', { className: 'pu-popMeta' }, copy(t('updatedAt'), { time: relativeTime(t, updatedAt) })),
				balanceStatus === null ? null : h('p', {
					className: balanceStatus.kind === 'ok' ? 'pu-popMeta' : balanceStatus.kind === 'warn' ? 'pu-warn' : 'pu-error',
					role: 'status',
					'aria-live': 'polite',
				}, balanceStatus.text),
				body)
		}
		//#endregion

		//#region usage hud
		/** How often the closed header pill refreshes the snapshot. */
		const HUD_POLL_MS = 30_000

		/** Short meter tags for the header pill, shorter than the gauge names. */
		const HUD_TAG_KEYS = {
			fiveHour: 'hudTagFiveHour',
			weekly: 'hudTagWeekly',
			monthly: 'hudTagMonthly',
			credits: 'hudTagCredits',
		}

		/**
		 * Compact quota facts for the header pill: for every provider with a probed
		 * account, that account's meters and its prepaid balance.
		 * @param data - the usage snapshot, or null before the first read.
		 * @returns {object[]} what the pill draws.
		 */
		function hudEntries(data) {
			if (data === null) return []
			const entries = []
			for (const group of usageGroups(data)) {
				const account = group.accounts.find((candidate) => candidate.active) ?? group.accounts[0]
				if (account === undefined) continue
				const balance = usageBalanceOf(data, group.id, account.ref)
				if (balance === undefined || balance.meters.length === 0) continue
				entries.push({
					key: group.id + ':' + account.ref,
					name: group.name,
					prepaid: balance.fields.find((field) => field.key === 'balance' && field.value.length > 0),
					meters: balance.meters,
				})
			}
			return entries
		}

		/**
		 * The always-visible header pill: one compact quota group per provider (bars
		 * plus the prepaid chip), opening the full per-account panel on click. It
		 * polls slowly while closed so the numbers never go stale, and the panel reuses
		 * the same store, so opening it shows data immediately.
		 * @param props - `t` plus the usage store.
		 */
		function UsageHud(props) {
			const { t, controller } = props
			const state = useSnapshot(controller)
			const [open, setOpen] = React.useState(false)
			const [anchor, setAnchor] = React.useState(null)
			const buttonRef = React.useRef(null)
			const panelRef = React.useRef(null)
			const entries = hudEntries(state.data).slice(0, 2)
			React.useEffect(() => {
				controller.markOpened()
				void controller.load({ silent: true })
			}, [controller])
			React.useEffect(() => {
				if (typeof document === 'undefined') return undefined
				const poll = () => {
					if (document.visibilityState === 'hidden') return
					if (!controller.shouldPoll()) return
					void controller.load({ silent: true })
				}
				const timer = setInterval(poll, HUD_POLL_MS)
				return () => clearInterval(timer)
			}, [controller])
			React.useEffect(() => {
				if (!open) return undefined
				const onDown = (event) => {
					if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
					setOpen(false)
				}
				const onKey = (event) => {
					if (event.key !== 'Escape') return
					setOpen(false)
					buttonRef.current?.focus()
				}
				document.addEventListener('mousedown', onDown, true)
				document.addEventListener('keydown', onKey)
				return () => {
					document.removeEventListener('mousedown', onDown, true)
					document.removeEventListener('keydown', onKey)
				}
			}, [open])
			const toggle = () => {
				const rect = buttonRef.current?.getBoundingClientRect()
				if (rect !== undefined) setAnchor(rect)
				setOpen((value) => !value)
			}
			const label = entries.length === 0
				? t('usageNav')
				: entries.map((entry) => entry.name + ' ' + entry.meters.map((meter) => t(HUD_TAG_KEYS[meter.id] ?? GAUGE_LABEL_KEYS[meter.id]) + ' ' + Math.round(meter.percent) + '%').join(' ')).join(' · ')
			const panelStyle = anchor === null || typeof window === 'undefined' ? undefined : {
				top: Math.round(anchor.bottom + 8) + 'px',
				right: Math.max(8, Math.round(window.innerWidth - anchor.right)) + 'px',
			}
			return h(React.Fragment, null,
				h('button', {
					ref: buttonRef,
					type: 'button',
					className: 'pa-hud',
					'aria-expanded': open ? 'true' : 'false',
					'aria-haspopup': 'dialog',
					'aria-label': label,
					title: label,
					onClick: toggle,
				},
					entries.length === 0
						? h('span', { className: 'pa-hudEmpty' }, t('usageNav'))
						: entries.map((entry) => h('span', { key: entry.key, className: 'pa-hudGroup' },
							h('span', { className: 'pa-hudStack', 'aria-hidden': 'true' },
								entry.meters.map((meter) => h('span', { key: meter.id, className: 'pa-hudBar' },
									h('span', {
										className: cx('pa-hudBarFill', GAUGE_TONE_CLASS[gaugeTone(meter.percent, meter.status)]),
										style: { width: Math.round(meter.percent) + '%' },
									})))),
							)),
					h('svg', { className: 'pa-hudCaret', width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' },
						h('path', {
							d: open ? 'M2 6.5L5 3.5L8 6.5' : 'M2 3.5L5 6.5L8 3.5',
							fill: 'none',
							stroke: 'currentColor',
							strokeWidth: 1.3,
							strokeLinecap: 'round',
						}))),
				open ? portal(h('div', {
					ref: panelRef,
					className: 'pa-hudPanel',
					role: 'dialog',
					'aria-label': t('usageNav'),
					style: panelStyle,
				}, h(UsagePopover, { t, controller }))) : null)
		}
		//#endregion

		//#region plugin body
		/** Required services (cordis fiber inject); the target slot arrives through `slots.inject`. */
		const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'remote.llm']

		/**
		 * Register this bundle's two settings sections once `settings.section` is on
		 * the ledger: the provider/account editor and its usage-and-balance sibling.
		 * The editor's store is kept fresh on every pushed invalidation and both
		 * pages are exposed as inject faces, so no card ever sees a Remote namespace.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			let store
			const operations = createOperations(ctx, () => store.getSnapshot())
			store = new ProviderAccountsStore(() => operations.read())
			/** The usage page's store is inert until its page mounts, so nothing is fetched on activation. */
			const usage = createUsageStore()
			/**
			 * One read at activation warms the page, so opening it shows data
			 * instead of starting from zero. Pushed invalidations refresh it only
			 * once the page has been on screen, so a plugin whose page nobody opens
			 * does not chase every settings write.
			 */
			store.ensureLoaded()
			const t = ctx.locale.bind(LOCALE_NS)
			ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'provider-accounts: page dictionaries')
			ctx.effect(() => {
				const refresh = () => {
					if (!store.opened) return
					if (store.getSnapshot().status === 'idle') return
					void store.load()
				}
				const disposers = [
					ctx.remote.$on('settings/document-updated', refresh),
					ctx.remote.$on('credentials/record-updated', refresh),
					ctx.remote.$on('credentials/reference-updated', refresh),
					ctx.remote.$on('llm/adapters-updated', refresh),
					ctx.on('connection/reset', refresh),
				]
				return () => {
					for (const dispose of disposers) dispose()
				}
			}, 'provider-accounts: pushed invalidations')
			// Usage lives in the conversation header, not in Settings: a glanceable pill
			// that opens the full per-account panel. The providers page keeps its own
			// settings section below.
			ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
				name: 'conversation.session.header.utilities',
				id: 'provider-usage',
				order: 20,
				locale: LOCALE_NS,
				label: () => t('usageNav'),
				inject: () => ({
					t,
					controller: usage,
				}),
			}, UsageHud))
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'provider-accounts',
				order: 20,
				locale: LOCALE_NS,
				label: () => t('nav'),
				inject: () => ({
					t,
					controller: store,
					operations,
					usage,
					hooks: { snapshot: store },
				}),
			}, ProviderAccountsSection))
		}

		return { inject, apply }
	},
})
