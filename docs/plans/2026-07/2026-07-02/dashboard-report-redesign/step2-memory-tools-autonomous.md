---
step: 2
title: memory-tools 加 autonomous 模式与 core-profile 工具
status: done
---

## 目标

给 `createMemoryTools` 加可选 `opts.autonomous` 参数：
- `autonomous=true` 时替换 `SaveMemory` 描述文案（去掉"仅用户明确要求"，改为"由复盘/自动化任务触发，判断标准以调用方提示词为准"）
- `autonomous=true` 时额外注册 `GetCoreProfile` / `UpdateCoreProfile` 两个工具（复用 `memory-service.getCoreProfile` / `updateCoreProfile`）
- `autonomous=false`（默认）行为完全不变，交互式聊天场景零影响

`registerTools()` 只加 `SaveMemory` autonomous 变体描述不合适（元数据只有一份），保持现有 3 条 `RecallMemory/SaveMemory/ForgetMemory` 元数据，**不**给 `GetCoreProfile/UpdateCoreProfile` 加元数据条目（这两个不进设置页工具选择器，只由 agent-worker 显式启用）。

## 依赖上下文

- 现有 `createMemoryTools(workspacePath)` 签名（`memory-tools.ts:44`）只有一个参数，改为 `createMemoryTools(workspacePath, opts?: { autonomous?: boolean })`。
- 已有 `memoryService.getCoreProfile(workspacePath)` 返回 `{ content, updated } | null`（`memory-service.ts:24-33`），`updateCoreProfile(workspacePath, content)` 全量覆盖（`memory-service.ts:35-41`）。可以直接调，不需要再写包装。
- `CoreProfile` 类型来自 `memory-types.ts`，正文是 `content` 字段。空文件时 `getCoreProfile` 返回 `null`，工具需要把 null 转成"（当前 core-profile 为空，是正常状态）"文本告诉 agent。
- Step 1 的提示词会说明 core-profile 门槛苛刻 + 写前先 Get、合并后 Update 全量覆盖，工具描述在此基础上加"UpdateCoreProfile 是全量覆盖，请确保 content 包含合并后的完整内容，不要只传新增部分"。
- 现有工具文件长度 186 行，加两个工具后大约 260+ 行，仍在 300 行内可以不拆分。

## 计划改动

- [ ] `electron/main/agents/tools/memory-tools.ts:44` 签名改为 `export function createMemoryTools(workspacePath: string, opts?: { autonomous?: boolean })`
- [ ] `memory-tools.ts` 顶部 import 加 `import type { CoreProfile } from '../../services/memory/memory-types.js'`（如需类型引用）
- [ ] `memory-tools.ts:103-108` `SaveMemory` 描述做条件替换：
  - `opts?.autonomous === true` 时描述改为："保存新的主题记忆或覆盖现有主题。由复盘/自动化任务触发时使用，判断标准以调用方提示词为准（不受"仅用户明确要求"限制，那句是给交互式聊天写的）。保真契约仍适用：拿不准根源就用 TraceSource 查证，宁可不写不可瞎造。slug 必须是 kebab-case……"
  - 默认（未传或 false）保持原文案不变
- [ ] `memory-tools.ts` 在 `tools: [...]` 数组末尾追加两个 `tool()` 定义，**仅当 `opts?.autonomous === true`** 时才 push：
  - `GetCoreProfile`：无参，返回 `{ content, updated }` 的 markdown 文本，空文件时返回"（当前 core-profile 为空，是正常状态，不代表没必要写，只是目前没有足够稳定的信号）"。
  - `UpdateCoreProfile`：参数 `content: z.string().min(1)`，描述强调"全量覆盖，调用前必须先 GetCoreProfile 拿现状并合并；触发门槛苛刻（真正稳定跨会话反复验证的身份/偏好/工作模式），大多数复盘不该调用"。成功后返回"已更新 core-profile"字样。
- [ ] `registerTools([...])` 数组**不动**（保持 3 条），因为两个新工具不进设置页选择器。若担心 lint 未使用报错则不改。

## 实施回填

### 实际改动
- 与计划差异：
  - 原计划用 `if (autonomous) tools.push(...)` 追加，TypeScript 把 `const tools = [...]` 推断为 union tuple 时 push 的 tool schema shape 不匹配已有元素，报 TS2345。改成条件 spread `...(autonomous ? [tool(...), tool(...)] : [])` 让 TS 正确推断为 union 数组，编译通过。
  - registerTools 数组按计划**保持不变**（3 条），两个新工具不进设置页选择器。
  - 文件顶部 doc block 顺带补了 autonomous 模式说明。
- 改动文件清单：
  - `electron/main/agents/tools/memory-tools.ts:1-16`（doc block）
  - `electron/main/agents/tools/memory-tools.ts:46-62`（签名 + saveMemoryDescription 变量）
  - `electron/main/agents/tools/memory-tools.ts:119-121`（SaveMemory 描述引用变量）
  - `electron/main/agents/tools/memory-tools.ts:201-291`（关闭 tools 数组前追加条件 spread 两个新工具）
- 验证：`bun run build:electron` 通过。

### 给下一步的接力棒
- `createMemoryTools` 新签名：`createMemoryTools(workspacePath: string, opts?: { autonomous?: boolean })`
- 新增工具的完整 MCP 名字（Step 3 allowedTools 精确使用）：
  - `mcp__dogear-memory__GetCoreProfile`
  - `mcp__dogear-memory__UpdateCoreProfile`
- 待办或已知限制：无。其他调用 `createMemoryTools` 的地方（chat/digest/categorize）都零参调用，行为不变，无需改动。
