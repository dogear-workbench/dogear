---
step: 3
title: agent-worker 复盘任务接线
status: done
---

## 目标

`agent-worker.ts` 的 `handleReviewSessionTask` 里：
- `createMemoryTools(workspacePath)` 改为 `createMemoryTools(workspacePath, { autonomous: true })`
- `allowedTools` 数组追加 `mcp__dogear-memory__GetCoreProfile` 和 `mcp__dogear-memory__UpdateCoreProfile`

不动 digest / categorize / chat 场景的 `createMemoryTools` 调用（都保持默认参数，不是 autonomous）。

## 依赖上下文

- 调用点在 `electron/main/agents/agent-worker.ts:744`，当前是 `const memoryServer = createMemoryTools(workspacePath);`
- `allowedTools` 数组在 `agent-worker.ts:769-778`，当前已有 8 条（review 5 + memory 3）
- Step 2 的新工具走同一个 MCP server `dogear-memory`，`mcpServers` 注册字段不需要变
- 确认其他调用 `createMemoryTools` 的地方保持零参调用：

## 计划改动

- [ ] 先 `Grep` 全项目搜 `createMemoryTools\(` 确认所有调用点，确保只改复盘一处
- [ ] `agent-worker.ts:744` 单行改为 `const memoryServer = createMemoryTools(workspacePath, { autonomous: true });`
- [ ] `agent-worker.ts:775-777` 附近的 `allowedTools` 数组末尾追加两条：
  - `'mcp__dogear-memory__GetCoreProfile',`
  - `'mcp__dogear-memory__UpdateCoreProfile',`
- [ ] `bun run build:electron` 编译主进程
- [ ] `bun run lint` 通过

## 实施回填

### 实际改动
- 与计划差异：无。
- 全项目扫 `createMemoryTools\(` 只有两处生产调用：
  - `electron/main/services/conversation-runtime-service.ts:94`（交互式聊天）保持零参默认，不受本次影响 ✓
  - `electron/main/agents/agent-worker.ts:744`（复盘任务）已改为 `{ autonomous: true }` ✓
- 改动文件清单：
  - `electron/main/agents/agent-worker.ts:744`（createMemoryTools 传 autonomous:true）
  - `electron/main/agents/agent-worker.ts:778-779`（allowedTools 追加 GetCoreProfile / UpdateCoreProfile）
- 验证：`bun run build:electron` 通过；`bun run lint` 0 errors（83 warnings 全是历史 `any` 类型告警，与本次改动无关）。

### 给下一步的接力棒
（本 step 是最后一步，无接力棒）

### 手测提示（给用户）
- 打开设置 → 会话摘要 → 首页报告面板 → 点"恢复默认"，把磁盘上旧的 `review-prompt.md` 更新为新版
- 手动触发一次复盘，观察 `dashboard.md` 是否是新四段结构、`.dogear/memory/topics/` 是否有新增沉淀、`.dogear/memory/core-profile.md` 是否被谨慎更新（预期大概率不动）
