---
step: 2f
title: PiSession 工具包接入与权限批量免确认
status: pending
---

## 目标

让 PiSession（Harness 主会话）按用户的 `enabledToolPacks` 设置和 conversation 的 `groupId` 挂载 Step 2E 中立化后的工具包，达到与旧 SDK 主会话对等的工具访问能力；并在 pi 侧新增"工具包粒度批量免确认"机制，对齐旧 SDK `allowedTools: mcp__<server>__*` 通配符"开工具包=不弹确认"的体验，不产生权限 UX 降级。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2E 已把 article/stock-quote/stock-analysis/stock-announcement/stock-picking 五个工具包重写为 `createXxxToolDefs(): ToolDef[]`（具体签名见 step2e.md 的「给下一步的接力棒」）。
- Step 3 的代码改动已写好但未提交，已 `git stash`（message: `step3-pending-before-patch`）。本 step 验收通过后，主会话把 `pop` 出来续验收提交；本 step 不需要等 Step 3 落地也能独立验证（可以用当前仍存在的 `attachPiConversation` 分支直接测）。
- 用户已决策：权限 UX 采用「新增工具包级别批量免确认，对齐旧 SDK 体验」（不接受逐工具确认降级）。
- 现状要点（来自 Step 3 验收时的调研）：
  - `PiSession.start()`（`electron/main/agents/pi-session/pi-session.ts` 约 194-217 行）目前一次性组装 `toolDefs`（skill/search/memory）→ `toPiTools(toolDefs)` → 和 `createBuiltinFileTools()` 合并成 `tools: AgentHarnessTool[]` → 传给 `new PiHarnessAdapter({ tools, toolContext: { env }, ... })`。工具集合在 Harness 构造时固定，没有运行中追加 API，所以新工具包必须在这里、`new PiHarnessAdapter(...)` 之前完成拼装。
  - `PiSessionConfig` 接口（`pi-session.ts` 约 44-56 行）目前没有 `enabledToolPacks`、`groupId`、`role` 字段；`attachPiConversation()`（`electron/main/services/conversation-runtime-service.ts` 约 450-499 行）调 `createSession()` 时也没有取出/传入这些信息。
  - `OPTIONAL_TOOL_PACKS`（`electron/main/services/tool-packs.ts:39`）是 UI 开关的注册表：`article`→`dogear-article`、`stock-quote`→`dogear-stock`、`stock-analysis`→`dogear-stock-analysis`、`stock-announcement`→`dogear-stock-announcement`、`stock-picking`→`dogear-stock-picking`；旧 SDK 侧读它决定挂哪些 MCP server（`conversation-runtime-service.ts:19,143,167`，已在 Step 3 的 stash 里被删，pop 回来前这几行仍在 git 历史里，可用 `git show HEAD:...` 查）。
  - `dogear-group`（`electron/main/agents/tools/group-tools.ts`）、`dogear-memory-review`（`electron/main/agents/tools/review-tools.ts`，交互式复盘工具，注意不要跟 `category-tools.ts`/`group-digest-tools.ts` 那几个 GROUP_DIGEST_SESSION/CATEGORIZE_SESSION 后台任务专属文件混淆）不受 `enabledToolPacks` 控制，旧 SDK 侧分别按 `conversation.groupId` 存在、`workspacePath` 齐全两个条件放行。
  - `dogear-delegation`（`electron/main/agents/tools/delegation-tools.ts`）按 `groupId` 存在放行，且工具子集按 `role: 'main' | 'sub'` 判别（`DelegationToolsOpts` 判别联合，约 40-58 行；子会话只拿 SendMessage/WaitForMessage/ListLinkedSessions，主会话额外拿 CreateSession/CreateSessionBatch/StopSession，约 73-323 行）。本 step 只服务主会话（`role: 'main'`），子会话工具包接入是 Step 5（delegation 的 `sdkSessionId` 协议迁移）的范围，不在这里做。
  - `dogear-reference`（`electron/main/agents/tools/reference-tools.ts`）**确认不需要给主会话挂**——文件头注释已明确"只装到子会话"，旧 SDK 侧主会话 `allowedTools` 里出现它只是防御性占位，从未真正注册这个 server。
  - pi 侧权限拦截点是 `PiSession.handleToolCall()`（`pi-session.ts` 约 358-387 行），逐次判断 `dontAsk` → `isPermissionExempt`（`permission-rules.ts:12,14`，硬编码 `Set(['read','Glob','Grep'])`）或 `sessionAllowedTools` → `isToolPreapproved`（`permission-rules.ts:19-21`，裸工具名精确匹配 `settings.permissionRules.allow`）→ 否则弹确认。目前没有"按工具包批量免确认"的概念；pi 侧工具名是裸名（不带 `mcp__server__` 前缀），无法照抄旧 SDK 的通配符匹配方式，需要新建一张"工具名 → 所属工具包"的映射表。

## 计划改动

- [ ] 确认 `delegation-tools.ts`、`group-tools.ts`、`review-tools.ts`（dogear-memory-review）当前是否已是 `ToolDef[]` 中立形态；若仍是纯 SDK 形状，按 Step 2E 同样的模式各自补一个 `createXxxToolDefs(...): ToolDef[]`（`delegation-tools.ts` 要保留 `role` 判别的工具子集逻辑）。
- [ ] `PiSessionConfig`（`pi-session.ts`）新增 `enabledToolPacks: string[]`、`groupId?: string`。role 固定为 `'main'`（PiSession 目前只服务主会话，无需做成可配置项）。
- [ ] `PiSession.start()`：在组装 `toolDefs` 时，按 `enabledToolPacks ∩ OPTIONAL_TOOL_PACKS` 挂载 article/stock-quote/stock-analysis/stock-announcement/stock-picking 对应的 `createXxxToolDefs(...)`；`groupId` 存在时挂 `dogear-group` 和 `dogear-delegation`（role='main'）；`workspacePath` 齐全时挂 `dogear-memory-review`。
- [ ] 组装过程中同步构建一张"工具名 → 工具包/来源标识"的映射（可以是 `Map<string, string>` 存在 PiSession 实例上，或作为 `toolContext` 的一部分传给权限判定逻辑），供下一条的批量免确认使用。
- [ ] `permission-rules.ts` 新增按工具包批量免确认的判定函数（具体命名和签名自定，只需保证语义：给定工具名和上面的映射表，若该工具所属的工具包在 `enabledToolPacks` 里，或属于 `dogear-group`/`dogear-delegation`(role main 场景)/`dogear-memory-review` 这几个常驻放行类别，直接判定免确认），接入 `handleToolCall()` 的判定链（放在 `isPermissionExempt`/`sessionAllowedTools` 之后、`isToolPreapproved` 之前或之后均可，只要不弹确认即可）。
- [ ] `conversation-runtime-service.ts` 的 `attachPiConversation()`：读取 `appSettings.enabledToolPacks ?? []`、`conversation.groupId`，传给 `PiSessionManager.createSession()` 的 config。
- [ ] 执行 `bun run build:electron`，确认无类型错误。
- [ ] 人工验证：在启用了至少一个可选工具包（如 stock-quote）的工作区里新建一个挂了 `groupId` 的对话，实际调用一个来自新工具包的工具（如 `GetStockQuote`）和 `dogear-group`/`dogear-delegation` 各一个工具，确认：① 不弹权限确认框；② 能拿到正确结果；③ 未启用的工具包对应工具不会出现在可用工具列表里。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- PiSessionConfig 最终字段和 PiSession.start() 挂载逻辑位置：
- 工具包批量免确认机制的具体实现方式（映射表存哪、判定函数签名）：
- 已验证的工具包和确认框行为：
- 未覆盖或已知限制（例如：子会话的 pi 化工具包接入留给 Step 5）：
- 下个 step 入口：本 step 通过后，主会话把 `step3-pending-before-patch` stash pop 回来，继续 Step 3 的验收提交流程。
