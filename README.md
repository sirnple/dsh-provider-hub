<div align="center">
  <img src="assets/icon-180.png" width="112" alt="dsh-provider-hub">
</div>

<h1 align="center">dsh-provider-hub</h1>

<p align="center">
  DeepSeek Harness 的模型提供商与账号中心：一个提供商可挂多个账号，随时切换、自动换号，并在会话头部看每个账号的用量与配额。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sirnple/dsh-provider-hub"><img alt="npm" src="https://img.shields.io/npm/v/@sirnple/dsh-provider-hub?label=npm"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="dsh" src="https://img.shields.io/badge/dsh-%E2%89%A50.2.1--rc.1-4a4a4a">
</p>

Provider and account hub for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): many
API-key accounts per provider with one-click switching, quota-driven failover, and a per-account
usage/quota panel in the conversation header. Everything runs inside the plugin — no gateway process.

---

## 解决的问题

DSH 自带的 `llm-pi-ai` 一个路由只认一个凭据（`apiKeyEnv`）。换成多条 key 就要手改配置，且不知道哪条
key 今天用了多少、哪个账号还有额度。这个插件把「提供商 → 账号」这层单独管起来：

- **一个提供商挂多个账号**，切换只重写路由的 `apiKeyEnv`，下一次请求生效
- **额度耗尽自动换号**，不用人工盯着
- **按账号记账**，请求数、失败数、输入/输出 token 都落在本地账本
- **余额与配额可视化**，能探测到的提供商直接画进度条

## 能力

| 能力 | 说明 |
|---|---|
| 接入提供商 | pi-ai 目录内的提供商（API Key）；或自定义端点，支持 `openai-completions` / `anthropic-messages` / `openai-responses` 三种协议 |
| 多账号 | 同一提供商保存任意多个凭据引用（`<ROUTE>_API_KEY_0`、`_1`…），各自独立命名与备注 |
| 切换账号 | 改写 `llm-pi-ai.providers.<route>.apiKeyEnv`，走 `configEditor.edit` 持久化，volatile 变更即时生效，无需重启 |
| 自动换号 | 请求在产出内容前失败于 `QUOTA` / `AUTH` / `INVALID_CREDENTIAL` / `MISSING_CREDENTIAL` 时切换下一个账号，单请求最多 2 跳，可整体关闭 |
| 用量账本 | 按 `<route>::<ref>` 记请求数、失败数、输入/输出/缓存 token，保留 90 天，10 秒防抖落盘 |
| 余额探测 | opencode-zen（5h/周/月窗口）、deepseek（余额与赠送）、openrouter（credits）、xAI（仅 key 有效性）；Grok Build 走订阅账单的周期百分比 |
| 会话头部面板 | 胶囊默认只画条（窄宽度安全），点开是逐提供商、逐账号详情；打开即读，弹层 15s、胶囊 30s 轮询 |
| 目录导入 | 扫描已存在的 `llm-pi-ai` 路由，一键导入成受管提供商，密钥与路由保持原样 |

## 凭据类型

插件不发明新的登录方式，只是在 DSH 已有的两种凭据上加了一层「多账号 + 归属」：

- **API Key（默认）** —— 目录提供商与自定义端点都用它。凭据存在 DSH 的 credential store，插件只保存引用名（如 `OPENCODE_GO_API_KEY_1`），不落明文。
- **OAuth（内置 Grok Build）** —— xAI 的 Grok Build / SuperGrok 订阅按 OAuth 记账，不吃 API credits，用 API Key 走不通。插件自己完成设备码登录与 token 轮替，并把 Build 的 Responses 协议翻译成 DSH 的流式事件，因此**不需要 grok2api 之类的本地网关**。详见 [plugin/README.md](plugin/README.md#grok-build-native-oauth)。

其余提供商若将来也需要订阅制 OAuth，按同样的形状加一个适配器即可（`plugin/grok.js` 是参考实现）。

## 华为云（MaaS）

华为云的模型服务有两层，只有其中一层能接进 DSH：

- **MaaS（ModelArts 模型即服务）** —— 官方 OpenAI 兼容端点 + API Key，按 token 计费。插件里已经预置厂商模板：**添加提供商 → 自定义端点 → 厂商模板 → 华为云 MaaS**，会填好端点
  `https://api-ap-southeast-1.modelarts-maas.com/v1`、协议 `openai-completions`、凭据引用 `HUAWEI_MAAS_API_KEY`，你只需把区域段换成控制台里的那个（如 `cn-north-4`）并粘 API Key，然后「探测模型」。
- **码道（CodeArts Agent）** —— 订阅制 IDE 产品（个人体验版免费，可升级套餐），登录走华为云账号浏览器 SSO。它**没有公开 API**：模型调用由本地 AgentKernel 经 `snapengine-apig.cn-north-7.myhuaweicloud.com` 用 `X-Auth-Token`（IAM 临时令牌）发起。要把它接进来只能复制官方客户端的请求，令牌约 24 小时过期且没有免密的刷新路径——插件不会存你的账号密码，所以这条路目前不做内置适配。

实测记录（2026-11）：`GET https://api-ap-southeast-1.modelarts-maas.com/v1/models` 返回 401（端点存在，缺 Key）；`cn-north-4` / `cn-south-1` 域名在本机不解析，按控制台给的区域域名填写即可。

## 安装

```sh
# 从 npm（预构建，免构建授权）
dsh plugin --profile desktop add @sirnple/dsh-provider-hub

# 或从 GitHub Release 的预构建 tarball
dsh plugin --profile desktop add https://github.com/sirnple/dsh-provider-hub/releases/latest/download/dsh-provider-hub.tgz
```

本地开发用 `link:` 指向本仓库的 `plugin/`：

```
<profile>/package.json            "@sirnple/dsh-provider-hub": "link:C:/path/to/dsh-provider-hub/plugin"
<profile>/dsh.profile.bundles     "@sirnple/dsh-provider-hub"
```

宿主需要 `@deepseek-ai/schemastery`（peer dependency，profile 里通常已有）。设置命名空间是 Loader 行 id
`provider-accounts`，与包名解耦，所以改包名不会丢已有配置。

## 界面

**设置 → 模型提供商与账号**

- 提供商卡片：id、是否目录提供商、当前活跃账号；每行一个账号，含凭据引用、配额条、今日用量
- 添加提供商：目录提供商（列表可选，选中后填 key）、自定义端点（协议 + 端点 + 探测模型）、Grok Build（直接登录）
- 自动换号开关：错误码可勾选，显示「每个请求最多切换几次」
- 目录导入：把已在 `llm-pi-ai` 里手配的路由纳管，不改动密钥与模型

**设置 → 用量与余额**，与会话头部胶囊共用同一份快照

- 逐提供商分块，逐账号一行：预付费金额、窗口配额进度条、今日 `tokens · 请求 · 失败`
- 唯一手动动作是「刷新余额」（会真的打上游计费接口）；本地账本自动读

## 一次请求怎么选账号

1. 会话模型选中某个路由（如 `opencode-go`）
2. 插件把该路由的 `apiKeyEnv` 指向当前活跃账号的凭据引用
3. pi-ai 用这条引用向提供商发请求
4. 若在产出内容前失败且错误码命中换号规则，插件改写 `apiKeyEnv` 到下一条账号并重发（最多 2 跳）
5. 无论成败，结果都记进对应账号的账本

一个路由同一时刻只有一个活跃账号——这是 pi-ai 的凭据解析模型决定的，插件没有绕过它做「按会话分凭据」。

## 数据存在哪里

| 内容 | 位置 |
|---|---|
| 提供商与账号列表 | profile 的 `cordis.patch.yml` 中 `id: provider-accounts` 那一行的 `config` |
| 请求/失败/token 账本 | `$DSH_HOME/storages/provider-accounts/usage.json`（90 天滚动，`version` 字段标记账单形状） |
| 密钥明文 | DSH 的 credential store，插件只存引用名 |
| Grok Build 的 OAuth bundle | credential store 里的 `GROK_BUILD_OAUTH`（access/refresh/过期时间/身份），快到期自动刷新 |

## 开发与测试

11 个 harness，全部可重复运行：

```sh
cd scratch

# host 侧
node smoke.mjs           # 模块装载、路由注册、命名空间
node usage-test.mjs      # 账本、配额适配、账单形状版本
node grok-test.mjs       # 设备码 OAuth、token 轮替、Responses 流式映射、计费、余额修复
node xai-test.mjs        # xAI key 探测、失败记录
node reconcile-test.mjs  # 路由自愈与回填
node failover-test.mjs   # 换号决策
node usage-contract.mjs  # 线上快照契约

# 浏览器侧（jsdom）
node smoke-dom.mjs       # 设置页交互：提供商卡片、Grok 登录、用量行
node smoke-refs.mjs      # 凭据引用与命名
node client-flows.mjs    # 添加/编辑/删除流程
node usage-dom.mjs       # 胶囊与弹层

# 一致性检查
node check-client-dicts.cjs   # 中英字典对齐
node check-client-css.cjs     # 样式类定义/使用一致
node check-pu-classes.mjs
```

## 目录

```
plugin/      bundle 源码
  index.js     Host 半边：命名空间、换号、记账、余额探测、Fetch 路由
  client.js    浏览器半边：设置页两屏 + 会话头部胶囊
  grok.js      Grok Build 适配器：设备码 OAuth、Responses → 流式事件、计费解析
  locale/      中英文案
  README.md    逐功能说明、协议细节、放行边界
research/    pi-ai / loader / remote 的调查笔记与生成脚本
scratch/     测试 harness 与夹具（一次性补丁脚本不入库）
scripts/     图标渲染等一次性工具
assets/      市场图标（位图）
```

## 边界

- 一个路由一个活跃账号，没有「按会话/按请求挑 key」
- 账本只记本插件经手的调用；切换前的历史不回填
- 余额探测依赖各家接口，上游改字段就会显示为「余额不可用」而不是瞎猜数字
- Grok Build 适配器目前无状态（未做 prompt cache / 会话亲和 / 压缩），命中率低于官方 CLI；理由见 [plugin/README.md](plugin/README.md#limits-by-design)

## License

MIT，见 [LICENSE](LICENSE)。
