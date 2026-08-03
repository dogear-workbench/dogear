---
step: 2f
title: PiSession 工具包接入与权限批量免确认
status: done
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

- [x] 确认 `delegation-tools.ts`、`group-tools.ts`、`review-tools.ts`（dogear-memory-review）当前是否已是 `ToolDef[]` 中立形态；若仍是纯 SDK 形状，按 Step 2E 同样的模式各自补一个 `createXxxToolDefs(...): ToolDef[]`（`delegation-tools.ts` 要保留 `role` 判别的工具子集逻辑）。（`group-tools.ts`/`review-tools.ts` 已是中立形态，只改了 `delegation-tools.ts`）
- [x] `PiSessionConfig`（`pi-session.ts`）新增 `enabledToolPacks: string[]`、`groupId?: string`。role 固定为 `'main'`。
- [x] `PiSession.start()`：按 `enabledToolPacks ∩ OPTIONAL_TOOL_PACKS` 挂载五个可选工具包；`groupId` 存在时挂 `dogear-group` 和 `dogear-delegation`（role='main'）；`workspacePath` 齐全时挂 `dogear-memory-review`。
- [x] 组装过程中同步构建 `Map<string, string>`（工具名 → 工具包标识），存于 `PiSession` 实例私有字段 `toolPackMap`。
- [x] `permission-rules.ts` 新增 `isToolInEnabledPack()` 判定函数 + `ALWAYS_ALLOWED_TOOL_PACKS` 常量，接入 `handleToolCall()` 判定链（`isPermissionExempt`/`sessionAllowedTools` 之后，`isToolPreapproved` 之前）。
- [x] `conversation-runtime-service.ts` 的 `attachPiConversation()`：新增读取 `appSettings.enabledToolPacks ?? []`、`conversation.groupId || undefined` 传给 `createSession()`。
- [x] 执行 `bun run build:electron`，无类型错误。
- [ ] ~~人工验证~~：未做端到端人工验证，仅做代码层自洽验证（见实施回填）。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：人工验证环节改为代码层自洽验证（编译产物模拟调用 `isToolInEnabledPack`，覆盖 7 种场景，结果符合预期），未启动真实 Electron App 做端到端验证。写操作工具（`ModifyWatchlist`）的口径采用"整包无差别放行，不区分读写"，与旧 SDK `mcp__<server>__*` 通配符口径一致，未额外加限制（依据：旧 `buildConversationSessionConfig()` 代码仍在，已核实其确实不区分读写）。
- 改动文件清单：`delegation-tools.ts`（补 `createDelegationToolDefs`）、`pi-session.ts`（`PiSessionConfig` 新字段 + `start()` 挂载逻辑 + `toolPackMap` 字段 + `handleToolCall()` 判定）、`permission-rules.ts`（新增 `isToolInEnabledPack`/`ALWAYS_ALLOWED_TOOL_PACKS`）、`conversation-runtime-service.ts`（`attachPiConversation()` 传参两行）。

### 给下一步的接力棒

- `PiSessionConfig` 新字段：`enabledToolPacks: string[]`、`groupId?: string`；挂载逻辑在 `pi-session.ts::start()` 的 `toolDefs` 组装段（`registerPack` helper + `OPTIONAL_TOOL_PACKS` 遍历 + `groupId`/`workspacePath` 条件分支）。
- 权限批量免确认：`toolPackMap: Map<string,string>`（PiSession 实例私有字段）+ `isToolInEnabledPack(toolName, toolPackMap, enabledToolPacks)`（`permission-rules.ts`），接入点 `handleToolCall()`。
- 已验证：TS 类型检查通过；`isToolInEnabledPack` 的 7 种场景代码层验证符合预期。**未验证**：真实运行时挂载效果、权限确认框实际弹出行为、未启用工具包是否真的不出现在工具列表（理论上由 `toPiTools(toolDefs)` 组装逻辑保证，未做运行时确认）。
- 未覆盖或已知限制：子会话的 pi 化工具包接入完全留给 Step 5（`role` 硬编码 `'main'`）；`dogear-reference` 确认不挂主会话，未改动。
- 下个 step 入口：本 step 验收通过，主会话把 `step3-pending-before-patch` stash pop 回来，继续 Step 3 的验收提交流程。建议在 Step 2D 已跳过的人工回归 + 本 step 未做的工具包运行时验证一起，找机会补做一次实测。
