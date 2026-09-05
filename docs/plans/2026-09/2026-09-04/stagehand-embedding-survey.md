# Dogear 二期「嵌入 Stagehand」勘查报告

> 勘查日期：2026-09-04 · 环境：Windows 11 / node v25.2.1 / Chrome stable 152.0.7977.82 · 只读调研，未改动任何工作区文件
> 证据标注约定：【实验】= 本机装包实测（临时目录，已清理）；【源码】= npm 包内 dist 产物逆向（index.mjs / index.d.mts / extension/service-worker.js）；【registry】= npm registry 元数据；【对比】= 同组报告 browser-nm-packaging-survey.md 的实验结论

---

## 0. TL;DR 与最终推荐

**推荐：不直接嵌入，部分借鉴（借鉴其可访问性树观察设计与 extract 协议，在自研 browser-tools 上实现）。**

核心理由（详见 §5）：

1. Stagehand v4 的 act/observe/extract 本质是「库内编排一层小模型调用」，而 Dogear 的 pi-session 主 Agent 本身就是 LLM——嵌入 act 等于在主 Agent 和浏览器之间插入第二层 LLM：token 双份、延迟翻倍、决策黑盒化。一期 observe_page + click/fill 的「主模型直读观察结果」模式与 pi-session 架构更契合。
2. 决策核心问题（模型接入）的答案比预期好：**v4 提供 ClientLLM 回调（`model: { generate }`），LLM 调用经 JSON-RPC 隧道全部路由回 SDK 使用方进程，可完整对接 pi-ai**【实验：mock ClientLLM 下 observe/act/extract 三原语端到端全通】。所以「不能接自己的模型」不构成否决项；否决它的是架构错位与维护成本。
3. 真正值得搬回来的是三样东西：**DOM/可访问性混合树的观察格式**（elementId→XPath 映射机制）、**extract 的「zod schema 严格抽取 + Metadata 完成度循环」协议**、**act/observe 的 prompt 设计**。这些自研成本远低于引入整个 Stagehand。

若未来确要「一句话完成子任务」的轻量自动化（绕过多轮工具调用），Stagehand + ClientLLM 接 pi-ai 是可行的 optional 增强，嵌入方式见 §4，风险见 §6。

---

## 1. 包现状

| 项 | 事实 | 来源 |
|---|---|---|
| 包名 / latest | `@browserbasehq/stagehand` 4.0.2（2026-08-20）；`v3-latest` dist-tag = 3.7.3；alpha = 4.1.0 | 【registry】 |
| 首发 | 2024-10-29（0.9/1.0 同日）；2025-03 v2.0；2025-10 v3.0；**2026-08 v4.0（架构推倒重来，见 §2）** | 【registry】 |
| 发布节奏 | 稳定版几乎每月 1~2 个，alpha/canary 极高频；活跃 | 【registry】 |
| 维护活跃度 | GitHub browserbase/stagehand：24,139 stars / 1,664 forks / 343 open issues；最近 push 2026-09-03 | 【registry+GitHub API】 |
| License | MIT | 【registry】 |
| 引擎要求 | **v4: `node >=22.18.0`**；v3: `^20.19.0 \|\| >=22.12.0` | 【registry】 |
| 依赖树（v4） | `zod 4.4.3`（精确 pin）+ `@browserbasehq/sdk ^2.16.0` + `@opentelemetry/api 1.9.1` / `core 2.9.0` + `chrome-launcher ^1.2.1`。**没有 playwright/puppeteer**（v3 是 peerDeps：playwright-core / puppeteer-core / patchright-core 三选一 + zod peer） | 【registry】 |
| 安装体积 | npm 实装 49 包共 **32MB**；包本体 unpacked 3.4MB / 16 文件（dist 单文件 bundle index.mjs 192KB + index.d.mts 244KB + **extension/ 2.0MB** + assets/stagehand-extension.zip 432KB） | 【实验+registry】 |
| 模块格式 | **纯 ESM**（`"type":"module"`，exports 仅 `import` 条件） | 【registry】 |
| 仓库形态 | monorepo，本包在 `packages/sdk-ts`；官方文档 stagehand.dev | 【registry】 |

对 Dogear 的两个直接约束：Electron 39.8.0 内置 Node 22.x ≥ 22.18 ✓（`package.json` electron ^39.2.7）；纯 ESM 包在主进程需 `import()`（项目红线本就要求 Vite 侧禁 require，主进程 TS 产物若为 CJS 则只能动态 import）。

---

## 2. API 与架构

### 2.1 v4 是全新架构（与社区资料中的 v3 完全不同）

v3 = 「Playwright/Puppeteer 之上的 page.act() 增强层」。**v4 彻底去掉 Playwright**，改为：

```
┌─ Node SDK（@browserbasehq/stagehand）────────────┐
│ Stagehand 类 + act/observe/extract + RPCClient   │
│ 原生 WebSocket CDP 客户端（无 playwright 依赖）   │
└──────────────╳ CDP (Target/Runtime) + JSON-RPC 隧道╳──────────┐
┌─ 浏览器内：MV3 扩展 "Stagehand Runtime"──────────────────────┐
│ service-worker（JSON-RPC server、编排、内置 provider 的 LLM 调用）│
│ content-script（全帧注入抓 DOM/a11y 树）+ offscreen + chrome.debugger │
└──────────────────────────────────────────────────────────────┘
```

- 扩展 manifest：MV3，permissions `[debugger, offscreen, scripting, tabs]`，host_permissions `<all_urls>`，content-script 全帧 ISOLATED world document_start【源码：dist/extension/manifest.json】。
- SDK 侧是 CDP over WebSocket 客户端（Node 22 原生 WebSocket，无 undici 依赖）；launch 模式用 chrome-launcher 起 Chrome，flags 含 `--enable-unsafe-extension-debugging`、`--remote-allow-origins=*`，随后经 CDP `Extensions.loadUnpacked` 从包内 `dist/extension` 注入【源码：index.mjs `launchLocalBrowser`/`connectBrowser`】。
- **绑死 Browserbase？否**。`localBrowser.launch()/connect()` 与 `browserbase.launch()/connect()` 两个 provider 平级；本地完全可用【实验】。

### 2.2 浏览器接入两种模式

| 模式 | 入口 | 说明 |
|---|---|---|
| 自起浏览器 | `localBrowser.launch({headless, executablePath, userDataDir, proxy, viewport, ...})` | chrome-launcher 找 Chrome branded 起新实例并自动注入扩展【源码+实验】 |
| **attach 已有浏览器** | `localBrowser.connect({cdpUrl, extensionId?})` | 连已有 CDP endpoint；**未传 extensionId 时自动 `Extensions.loadUnpacked` 动态注入扩展**【实验：attach 手动起的 Chrome 152 成功，`provider:local, origin:connected`】 |
| 云 | `browserbase.launch/connect` | 上传扩展 zip 到 Browserbase session |

attach 的私有 brand 校验（`stagehandBrowserBrand`）只挡「裸 CDP 句柄」，`connect({cdpUrl})` 是官方支持的 attach 路径【源码：index.d.mts StagehandBrowser 注释】。

### 2.3 三原语 I/O（都在 `Stagehand` 类上；`Page` 只有原语操作层）

```ts
act(instruction: string | Action, opts?): Promise<ActResult>
// ActResult.data = { success, message, actionDescription, actions: Action[] }
observe(instruction?, opts?): Promise<ObserveResult>       // ObserveResult.data = Action[]
extract(instruction, zodSchema?, opts?): Promise<ExtractResult>  // data = zodSchema 输出
// 公共 opts: model覆盖 / timeout / cache / locator|ignoreLocators(限定DOM作用域) / page
// act 独有: variables(%var% 模板填充，避免敏感值进 prompt)
// extract 独有: screenshot(多模态抽取)
// Action = { selector: "xpath=...", description, method, arguments }
```

- method 枚举：`click / fill / type / press / scrollTo / nextChunk / prevChunk / selectOptionFromDropdown / hover / doubleClick / dragAndDrop`【源码：ObservationSchema】。nextChunk/prevChunk 说明大页面观察是分块协议。
- 每个结果都带 `metadata.usage`（token/inferenceTimeMs）与 `metadata.cache`（HIT/MISS/DISABLED，含省 token 统计）；`sh.metrics()` 按三原语累计【实验】。

### 2.4 observe 的元素标注机制（ref 的生成与失效）

【实验】全链路抓包确认：

1. 扩展捕获「**DOM 与可访问性混合树**」，紧凑缩进文本，每行形如 `  [0-15] button: Go`；
2. LLM 返回 `elementId`（正则 `^\d+-\d+$` = **帧序-CDP backendNodeId**）；
3. 扩展用 elementId→XPath 映射表解析，**最终返回给调用方的 selector 是 `xpath=/html[1]/body[1]/button[1]`**；
4. 解析不出 XPath 的元素被丢弃并 warn（`Observed element could not be resolved to an XPath`）【源码：observeService】。

**失效语义**：backendNodeId 是 CDP DOM 域的节点 ID，页面导航/DOM 重建后失效；xpath 同样脆弱。与一期 observe_page 的「观察→立即行动」短周期假设相同，没有跨导航稳定的 ref。这与 v3 的 xpath-based ref 一脉相承。

### 2.5 extract 的两段调用协议（对借鉴最有价值）

【实验】一次 `extract("页面标题", z.object({title: z.string()}))` 产生**两次** LLM 调用：

1. `responseFormat.name="Extraction"`：schema = **用户 zod schema 的 JSON Schema**（`additionalProperties:false` 严格——返回多一个字段都报 `unrecognized_keys`）；
2. `responseFormat.name="Metadata"`：schema = `{progress: string, completed: boolean}`（ExtractMetadataSchema，描述抽取进度、goal 是否达成）→ 由库判断是否继续下一 chunk。

即：结构化抽取 + 分块续跑 + 完成度判断是一个明确的、schema 自描述的协议。

### 2.6 与原生 Playwright 混用

**v4 不能混用**：没有 Playwright 依赖，`Page/Locator/BrowserContext` 全是自研 CDP 封装（签名刻意模仿 Playwright 但不是同一个对象体系）。可行的「混用」是**进程级并存**：Playwright 与 Stagehand 作为两个 CDP 客户端连同一个浏览器（Playwright 走 launchPersistentContext 连接，Stagehand 走自己的 WebSocket CDP），共享浏览器状态但互不感知页面对象——见 §4.3。

---

## 3. 模型接入（决策核心）

### 3.1 `model` 配置二选一【源码：StagehandCreateOptionsSchema】

```ts
model: {
  // 分支 A：内置 provider —— 五家白名单，无 baseURL
  modelName: "openai/gpt-4.1" | "anthropic/claude-..." | "google/gemini-..."
           | "groq/..." | "cerebras/...",   // 模型名是 zod 模板字面量硬编码白名单
  apiKey?: string, headers?: Record<string,string>
} | {
  // 分支 B：ClientLLM —— 完全把模型调用交给使用方
  generate: (req: LLMGenerateParams) => Promise<LLMGenerateResult>
}
```

- **分支 A 不支持自定义 baseURL / OpenAI 兼容网关**：v4 类型上无 baseURL 字段；实测扩展 service-worker 内硬编码 6 个域名（api.openai.com / api.anthropic.com / generativelanguage.googleapis.com / api.groq.com / api.cerebras.ai / api.browserbase.com），推理在**浏览器扩展进程内**直连厂商——apiKey 会进入浏览器进程【源码】。对比：**v3 的 `ClientOptions` 显式支持 `baseURL`**（v3 包 modelUtils/ClientOptions 定义），v4 砍掉它换来了分支 B。
- 分支 A 在 Browserbase 会话下无 apiKey 时走 **Browserbase Model Gateway**（`{apiUrl}/llm`，OpenAI Responses 兼容，`x-bb-session-id` 头，模型名可省略由云端 `auto` 路由）【源码：createGatewayLanguageModel】。
- 分流逻辑：`model && "source" in model` → ClientLLM；否则有 apiKey 走扩展内直连；无 apiKey 有 gateway 走网关【源码：llmService generate()】。

### 3.2 ClientLLM：模型调用完全可注入（官方一等公民设计）

SDK 初始化时：`rpcClient.onRequest(StagehandMethods.llmGenerate, createConfig.model.generate)`——扩展每次需要推理，经 CDP 隧道发 JSON-RPC `llm.generate` 回 SDK 进程，SDK 调用我们的 `generate`。官方注释："An LLM callback implemented locally by the SDK consumer. **It never crosses the wire**."【源码：index.d.mts】

**协议形态**（实验抓包确认）：

```ts
// 输入
{ messages: [{role:"user"|"assistant",
   content: {type:"text",text} | [{type:"text"|"image"|"tool_use"|"tool_result",...}], ...}],
  systemPrompt?: string, temperature?: number, stopSequences?: string[],
  responseFormat: { type:"json_schema", name, schema /*JSON Schema draft 2020-12*/ } }
// 输出（必须）
{ role:"assistant", content:[...], outputFormat:"json_schema",
  structuredContent: /* 必须匹配收到的 responseFormat.schema */,
  usage: { inputTokens, outputTokens, totalTokens, reasoningTokens?, cachedInputTokens? } }
```

关键性质：

- **协议自描述**：一次 act 会依次收到 `Observation`/`Act` 等 name 的调用，extract 收到 `Extraction` + `Metadata`——适配器**不需要知道任何内部 schema**，只需「把 messages/systemPrompt 喂给模型 → 按 responseFormat.schema 做结构化输出 → 回报 usage」。
- 扩展侧对返回做双重 zod 校验（`fromJSONSchema(收到的 schema)` + `LLMGenerateResultSchema`），格式不符以 `-32602 invalid params` 报回【实验踩坑实证】。
- 实测中 mock 的 generate 收到的 user message 形如 `instruction: ...\nAccessibility Tree: \n[0-2] RootWebArea...\n  [0-15] button: Go`——观察树与指令都在 messages 里，非黑盒。

### 3.3 「把 Stagehand 的模型调用接到 pi-ai」可行性结论

**可行，且工程量小（一个适配函数）**：pi-ai 原生支持 text+image 消息与结构化输出/工具调用，JSON Schema 输入与本协议直接对齐；usage 字段一一对应。本勘查用 mock 全链路验证了协议（Observation/Act/Extraction/Metadata 四种调用全部通过、act 真实执行点击成功、extract 返回严格匹配 zod schema 的数据）【实验】。

需要适配器注意的三点（均实证）：

1. content 是「单个 text 对象**或**数组」的 union，两者都要处理；
2. `structuredContent` 必须逐字匹配收到的 JSON Schema（`additionalProperties:false` 严格）——pi-ai 的 structured output 若走 OpenAI strict 模式，需确认生成 schema 兼容（实测收到的 schema 特性简单：object/array/string/enum/pattern，无高级特性，兼容风险低）；
3. extract 主抽取的 schema **不含** progress/completed（那是独立的 Metadata 调用）——不要自己往用户 schema 里拼字段（实验中踩过：多塞字段报 unrecognized_keys）。

**但注意结论反转**：模型可注入 ≠ 应该嵌入。「Stagehand 的价值 = 内置 provider + prompt/树/缓存工程 + 一层小模型编排」；用 ClientLLM 接 pi-ai 后，前者大半保留、后者成为冗余层——完整论证见 §5。

---

## 4. 嵌入方式建议（若走嵌入路线）

### 4.1 依赖与运行环境

- 装主进程（Node 侧），无原生模块。Node ≥22.18：Electron 39.8 内置 Node 满足【代码：package.json】。
- 纯 ESM：Dogear 主进程 tsc 产物若为 CJS，须 `await import("@browserbasehq/stagehand")` 延迟加载；建议实测 `tsconfig.electron.json` 的 module/target 组合。
- 打包：`dist/extension/`（2MB）与 `assets/stagehand-extension.zip` 需进入 asar 外资源（CDP `Extensions.loadUnpacked` 需要真实文件路径）；可用环境变量 `STAGEHAND_EXTENSION_DIRECTORY_PATH` 指定扩展目录【源码+实验】。

### 4.2 attach 到 Dogear 已有 launchPersistentContext 单例（已验证可行路径）

1. browser-manager 的 launch args 追加：`--remote-debugging-port=<port>`、`--enable-unsafe-extension-debugging`、`--remote-allow-origins=*`；
2. `Stagehand.create({ browser: await localBrowser.connect({ cdpUrl: "http://127.0.0.1:<port>" }), model: piAiClientLLMAdapter })`；
3. connect 模式会自动 `Extensions.loadUnpacked` 注入扩展【实验：手动起的 Chrome 152 成功】。

两个备选/兜底：

- `Extensions.loadUnpacked` 不可用时报错文案明确："This Chrome build does not support Extensions.loadUnpacked. Launch with --load-extension and connect using extensionId instead."【源码】→ 兜底路径：launchPersistentContext args 加 `--load-extension=<扩展目录>`（Playwright 的 CFT Chromium 不受 Chrome branded 的封禁影响【对比：browser-nm-packaging-survey §2 用 Playwright Chromium 加载扩展成功】），connect 时传 extensionId（可从 CDP `Target.getTargets` 的 `chrome-extension://<id>/` service worker URL 提取【源码】）。
- **重要交叉结论**：Chrome stable 152 已封禁 `--load-extension`【对比：同组 NM 报告实验 6】，但 Stagehand v4 默认注入路径是 **CDP 命令 + `--enable-unsafe-extension-debugging` flag，实测 Chrome 152 可用**【实验】——比 NM 路线的扩展分发问题小得多（无需商店上架）。

### 4.3 与 Playwright 并存的风险点

Playwright 与 Stagehand 扩展分属两个 CDP 客户端（Playwright 走 DevTools WebSocket/pipe，扩展走 `chrome.debugger` API），协议层可共存，但：页面导航/关闭时序下 Stagehand 的 Page 引用与 elementId 会失效；`chrome.debugger` 对同一 target 的 attach 弹泡与互斥行为需集成测试验证。此项标注为**待验证**，嵌入前必须先做冒烟测试。

---

## 5. 增量价值判断与最终推荐

### 5.1 对照一期能力

一期已有（agents/tools/browser-tools.ts + electron/main/services/browser/）：observe_page「结构化元素清单 + 编号 ref + 上下文压缩」、click/fill 按 ref 定位、browser-manager launchPersistentContext 单例。即「**主模型读观察结果 → 直接输出工具调用**」闭环已经成立。

Stagehand act 的本质：把「观察→决策」的小模型调用放进库内，主调用方只给一句自然语言。对 pi-session 架构：

- pi-session 主 Agent 本身就是 LLM，act 相当于在「主 Agent → 浏览器工具」之间**再插一层 LLM**：token 双份、延迟翻倍、act 的决策过程黑盒化（只返回 success/message）、失败重试策略不受控；
- 主模型直读 observe_page 再发 click/fill，能力等价且决策可见、可流式、与对话上下文连贯；
- Stagehand 的缓存/usage 统计等工程细节，pi-session 侧已有对应位（模型统一层）。

### 5.2 Stagehand 真正值得拿走的增量（低成本自研）

| 增量 | Stagehand 做法 | 借鉴建议 |
|---|---|---|
| 观察格式 | DOM/可访问性混合树：紧凑缩进文本 + `[帧序-backendNodeId]` 编号 + elementId→XPath 映射；比自研 DOM 遍历更紧凑、语义更强（角色/名称），天然压上下文 | **高价值**。CDP `DOMSnapshot.captureSnapshot`/Accessibility 域即可自研；ref 解析用 backendNodeId→XPath 映射 |
| extract 协议 | 用户 zod schema 严格结构化抽取 + 分块续跑 + Metadata(`progress/completed`) 完成度循环 + 可选 screenshot 多模态 | **高价值**。协议自描述（§3.2），pi-session 里加一个 `extract_structured` 工具即可 |
| prompt 设计 | act/observe 的 system prompt、%variables% 模板（敏感值不进 prompt）、分块 nextChunk/prevChunk、dropdown 特化指令 | 中价值。文本可参考（实验抓包已留存完整 prompt 原文） |
| act 缓存 | actionId 缓存重复动作、cache token savings 统计 | 低优先 |
| 扩展注入工程 | CDP `Extensions.loadUnpacked` + `--enable-unsafe-extension-debugging`，绕开 `--load-extension` 封禁 | 若未来做「Dogear 受控浏览器内跑增强扩展」可复用此机制 |

### 5.3 最终推荐

**不嵌入，部分借鉴。**

- 直接嵌入（v4 + ClientLLM 接 pi-ai）技术上成立（§3、§4 均实证），但为获得「库内小模型编排」付出双 LLM 成本 + 架构错位 + 每月发版的 API 漂移（v3→v4 已证明会推倒重来）+ 2MB 扩展与打包复杂度，性价比不成立；
- 借鉴落地路径：在 browser-tools.ts 体系内自研「a11y 混合树观察 + extract 结构化协议」，无新依赖、不引入第二层 LLM；
- 保留选项：若二期确要「一句话子任务」类轻量自动化，Stagehand 作为 optional 增强按 §4 方式接入（ClientLLM 必须接 pi-ai，不接受内置 provider——apiKey 会进浏览器进程且无法统一走 pi-ai 配置）。

---

## 6. 风险清单（嵌入路线的，供未来翻案时用）

1. **API 漂移**：月度发版节奏，v3→v4 架构完全 breaking；社区文档/教程绝大多数还是 v3（page.act() 时代），v4 资料少——照抄网上示例会踩空。
2. **纯 ESM**：CJS 主进程产物只能动态 import()；bun/npm engines 检查行为差异需实测。
3. **Node ≥22.18**：Electron 39 满足；若未来降 Electron（≤37 内置 Node 22.16）将撞线（npm 仅 warning，运行时实际依赖 Node 22 原生 WebSocket）。
4. **扩展注入依赖 `--enable-unsafe-extension-debugging`**：Chrome 137 封 `--load-extension` 是政策收紧先例，该 flag 未来可能同样受限；Playwright CFT Chromium 上的 `Extensions.loadUnpacked` 未验证（本次实验用 Chrome stable 152）。
5. **双 CDP 客户端并存**：Playwright × Stagehand 扩展的时序/互斥需集成测试（§4.3，待验证）。
6. **打包**：扩展目录必须 asar 外（真实路径），2MB + zip；`STAGEHAND_EXTENSION_DIRECTORY_PATH` 可控。
7. **内置 provider 的 apiKey 进浏览器进程**（扩展内直连厂商）——若坚持模型走 pi-ai 统一层则无此问题，但内置模式不可用。
8. **ClientLLM 是内部协议**（"never crosses the wire" 描述），无独立 semver 承诺；双重 zod 校验严格，适配器需完整实现 text/image/usage/structuredContent 匹配。
9. **telemetry**：默认 endpoint 为 `example.com/v1/traces` 占位（不实际上报）；可接自建 OTLP collector，隐私风险低。
10. **chrome-launcher 只识别 Chrome branded**：不影响 connect 模式（Dogear 自管浏览器），但 localBrowser.launch 在无 Chrome 机器上不可用。

---

## 7. 主要证据索引

- npm registry 元数据与时间线：`registry.npmjs.org/@browserbasehq/stagehand`（2026-09-04 抓取）
- v4.0.2 源码逆向：`dist/index.mjs`（RPCClient/CDPClient/wireSchema/factories/llmService）、`dist/index.d.mts`（全部公共类型）、`dist/extension/{manifest.json,service-worker.js}`（扩展协议、内置 provider 域名、prompt 原文）
- 实验（临时目录 `%TEMP%/stagehand-survey`，已清理）：npm 实装 32MB/49 包；mock ClientLLM 下 observe→act→extract 端到端（含真实点击 `xpath=/html[1]/body[1]/button[1]` 生效、extract 返回严格匹配 zod schema、metrics 累计）；localBrowser.launch(headless) 与 connect(cdpUrl) 两种模式均打通（Chrome 152.0.7977.82）
- v3.7.3 对比：`ClientOptions.baseURL` 显式支持（v3 包 `modelUtils.d.ts` / `v3/types/public/model.d.ts`）
- 交叉引用：browser-nm-packaging-survey.md（Chrome 152 封 `--load-extension` 实证；Dogear 打包/浏览器分发现状）
