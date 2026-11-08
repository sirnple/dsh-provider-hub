# dsh-provider-hub

DeepSeek Harness 的**模型提供商与账号中心**：接入第三方提供商、为同一个提供商保存多个 API Key
账号、按需切换、额度耗尽时自动换号，并在会话头部展示每个账号的用量与配额。

A provider & account hub for [DeepSeek Harness](https://github.com/sirnple): many API-key accounts
per provider, one-click switching, quota-driven failover, and a per-account usage/quota panel.

## 功能

| 能力 | 说明 |
|---|---|
| 多提供商接入 | pi-ai 目录提供商 + 手写端点（OpenAI / Anthropic / OpenAI-Responses 三种协议） |
| 多账号 | 同一提供商保存多个 `apiKeyEnv` 凭据，切换只重写路由的 `apiKeyEnv`，下一次请求生效 |
| 自动换号 | 请求在产出内容前失败（`QUOTA` / `AUTH` / `INVALID_CREDENTIAL` / `MISSING_CREDENTIAL`）时换下一个账号，单请求最多 2 跳 |
| 用量账本 | 按 `<route>::<ref>` 记录请求数、失败数、输入/输出 token，保留 90 天，落盘 `$DSH_HOME/storages/provider-accounts/usage.json` |
| 配额与余额 | opencode-zen / deepseek / openrouter / xAI 的余额探测，按 5h / 周 / 月窗口画进度条 |
| Grok Build | **原生设备码 OAuth**（无外部网关），走 xAI 的 Build Responses 协议，配额来自 `/billing` 的周窗口百分比 |
| 会话头部面板 | 窄宽度安全的胶囊：只画条，数字放在 `title`；点开是逐账号详情 |

## 安装

```powershell
# 把仓库链接进某个 profile
#   <profile>/package.json
#     "dsh-provider-hub": "link:C:/path/to/dsh-provider-hub/plugin"
#   <profile>/dsh.profile.bundles 里加入 "dsh-provider-hub"
```

宿主需要 `@deepseek-ai/schemastery`（peer dependency，profile 里通常已有）。

## 界面

- **设置 → 模型提供商与账号**：提供商卡片、账号行（密钥、配额条、今日用量）、添加提供商（目录 / 自定义端点 / Grok Build 登录）
- **设置 → 用量与余额**（会话头部胶囊同一份数据）：逐提供商分块，逐账号一行

## Grok Build（原生 OAuth）

SuperGrok / Grok Build 订阅用 OAuth 认证，不吃 API credits。插件自己完成设备码登录与 token 轮替，
不依赖 grok2api 之类的本地网关：

1. 添加提供商 → 目录提供商 → **Grok Build (OAuth)**
2. 点「登录」，打开链接输入设备码
3. 登录后账号行显示计划、周配额百分比与今日用量

细节与协议常量见 [`plugin/README.md`](plugin/README.md)。

## 测试

`scratch/` 下有 11 个可重复运行的 harness（host 侧 7 个 + jsdom 侧 4 个），另有字典与样式检查：

```powershell
cd scratch
node grok-test.mjs      # OAuth、Responses 流式映射、计费形状、余额修复
node usage-test.mjs     # 账本、配额适配、形状版本
node smoke-dom.mjs      # 设置页交互（含 Grok 登录、用量行）
node usage-dom.mjs      # 胶囊与弹层
node check-client-dicts.cjs   # 中英字典对齐
node check-client-css.cjs     # 样式类定义/使用一致
```

## 目录

```
plugin/     bundle 源码：index.js（Host）、client.js（浏览器）、grok.js（OAuth + 适配器）、locale
research/   pi-ai / loader / remote 的调查笔记与生成脚本
scratch/    测试 harness 与夹具（一次性补丁脚本不入库）
```

## License

MIT，见 [LICENSE](LICENSE)。
