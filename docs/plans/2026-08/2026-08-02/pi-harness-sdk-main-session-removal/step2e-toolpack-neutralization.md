---
step: 2e
title: 可选工具包 ToolDef 中立化改造
status: pending
---

## 目标

把 `article-tools.ts` / `stock-tools.ts` / `stock-analysis-tools.ts` / `stock-announcement-tools.ts` / `stock-picking-tools.ts` 五个仍是纯 SDK 形状的工具工厂，按 `memory-tools.ts` 已验证的模式改造成"中立 `ToolDef[]` + SDK 薄壳"两段式，为 Step 2F 让 PiSession 消费这些工具包扫清类型障碍。不改变任何现有 SDK 侧调用方的行为或签名。

## 依赖上下文（接力棒输入）

- 触发原因：Step 3 验收时发现 PiSession 从 Step 1 到 2D 全程只挂了内建文件工具 + 常驻记忆工具，未接入其余可选工具包；Step 3 计划把所有主会话强制切到 PiSessionManager，若不先补齐会导致主会话（含当前默认 `anthropic-sdk` profile 的对话）功能倒退。Step 3 的代码改动已写好但未提交，已 `git stash`（message: `step3-pending-before-patch`），等 2E/2F 验收通过后再 pop 出来续验收提交。
- 参照范例：`electron/main/agents/tools/memory-tools.ts` —— `createMemoryToolDefs(workspacePath, opts?)`（约第 45 行）返回中立 `ToolDef[]`；`createMemoryTools(workspacePath, opts?)`（约第 284 行）是薄壳，内部 `toSdkServer('dogear-memory', '1.0.0', createMemoryToolDefs(...))`，对外签名和行为完全不变。
- 中立层定义在 `electron/main/agents/pi/tool-adapter.ts`：`ToolDef`（`name/description/schema(z.object)/handler`）、`defineTool()`、`toSdkServer()`（喂给 SDK 的 `createSdkMcpServer`）、`toPiTools()`（喂给 pi 的 `AgentHarnessTool[]`，工具名裸名不带 `mcp__server__` 前缀，`isError:true` 会被自动翻转成 `throw`，handler 不用改错误约定）。
- 五个目标文件当前现状（均是 `import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'`，内联 `tool(name, desc, zodShape, handler)`，没有经过 `ToolDef` 中立层）：
  - `electron/main/agents/tools/article-tools.ts:24` `createArticleTools(workspacePath: string)`
  - `electron/main/agents/tools/stock-tools.ts:85` `createStockTools()`
  - `electron/main/agents/tools/stock-analysis-tools.ts:175` `createStockAnalysisTools()`
  - `electron/main/agents/tools/stock-announcement-tools.ts:51` `createAnnouncementTools()`
  - `electron/main/agents/tools/stock-picking-tools.ts:97` `createStockPickingTools()`
- `OPTIONAL_TOOL_PACKS`（`electron/main/services/tool-packs.ts:39`）是这几个工具包在 UI/enabledToolPacks 里的注册表，`mcpServerName` 字段对应旧 SDK server 名；Step 2F 会按这张表决定 PiSession 该挂哪些包，本 step 不用动这个文件。
- 范围边界：`delegation-tools.ts`、`group-tools.ts`（dogear-group）、`review-tools.ts`（dogear-memory-review，交互式复盘工具，不要跟 `category-tools.ts`/`group-digest-tools.ts` 那几个后台任务专属文件混淆）是否也需要中立化改造，留给 Step 2F 开工时现查现定，不在本 step 处理，避免范围蔓延。

## 计划改动

- [ ] `article-tools.ts`：新增 `createArticleToolDefs(workspacePath: string): ToolDef[]`，原 `createArticleTools` 改造成调用 `toSdkServer('dogear-article', '1.0.0', createArticleToolDefs(workspacePath))` 的薄壳，对外签名、返回类型、行为不变。
- [ ] `stock-tools.ts`：同上模式，新增 `createStockToolDefs(): ToolDef[]`，`createStockTools()` 改薄壳。
- [ ] `stock-analysis-tools.ts`：新增 `createStockAnalysisToolDefs(): ToolDef[]`，`createStockAnalysisTools()` 改薄壳。
- [ ] `stock-announcement-tools.ts`：新增 `createAnnouncementToolDefs(): ToolDef[]`，`createAnnouncementTools()` 改薄壳。
- [ ] `stock-picking-tools.ts`：新增 `createStockPickingToolDefs(): ToolDef[]`，`createStockPickingTools()` 改薄壳。
- [ ] 五个文件的原 handler 逻辑原样保留（含 `isError: true` 错误返回约定），只做"包装层"重构，不改工具的业务行为、参数 schema 或错误信息文案。
- [ ] 执行 `bun run build:electron`，确认现有 SDK 侧调用点（`conversation-runtime-service.ts` 里旧的 `buildConversationSessionConfig` 已在 Step 3 stash 里被删——如果验收时 Step 3 仍未 pop 回来，改为确认 `agent-worker.ts` 等其他仍在用这些工厂的调用点签名不受影响）零类型错误。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 五个 `createXxxToolDefs` 的最终导出签名：
- 是否有工具在中立化过程中发现原 SDK schema 用了 `toPiTools` 不支持的 zod 特性（如需要手动修正 schema 写法）：
- 下个 step 入口：Step 2F 直接 `import` 这些 `createXxxToolDefs`，在 `PiSession.start()` 里按 `enabledToolPacks` 挂载。
- 待办或已知限制：
