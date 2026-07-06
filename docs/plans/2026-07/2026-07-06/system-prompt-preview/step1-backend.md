---
step: 1
title: 后端模板抽取 + IPC
status: done
---

## 目标
把散在 `query-based-session.ts` 里硬编码的 append 段抽到 `session-append-templates.ts` 统一维护，同时新增 tipc 路由 `getSystemPromptSegments()` 供前端拉结构化清单。**行为完全不变**——只是搬家 + 加一个只读 IPC。

## 依赖上下文（接力棒输入）

无前置 step。以下是当前关键文件状态：

- **散在各处的模板**（需要抽出统一放）：
  - `electron/main/agents/query-based-session.ts:1707-1712` — `_notes/` 引导（一整段字符串拼接）
  - `electron/main/agents/query-based-session.ts:1715-1725` — 子会话交付契约（含 `${task}` / `${outputPath}` 占位符）
  - `electron/main/agents/session-append-templates.ts` — 已经有 `REFERENCE_APPEND`（常量）和 `groupAppendFor(groupName)`（函数），保持原样
  - `electron/main/agents/tool-pack-guide.ts::buildToolPackGuide` — 已存在，不动它；只在 segments 收集时把它的"生成规则"用文字描述带出来
  - `electron/main/agents/group-context-builder.ts::buildGroupContextPrompt` — 已存在，不动；同上

- **拼装点**：`query-based-session.ts::buildSystemPrompt`（第 1650 行起），抽出后此方法内改为引用抽出的常量/函数

- **类型现状**：项目已有 `types/` 前端类型 + `electron/main/types.ts` 主进程镜像的约定（见 CLAUDE.md「TypeScript 配置」段）。新增 `SystemPromptSegment` 类型需两边同步。

- **tipc 现状**：`electron/main/tipc/index.ts` 是路由注册中枢，新增子路由要在此聚合。

## 计划改动

### 1a. 抽取硬编码模板到 session-append-templates.ts

- [ ] `electron/main/agents/session-append-templates.ts` 新增导出：
  - `NOTES_GUIDANCE_APPEND: string` — 从 `query-based-session.ts:1707-1712` 原样搬过来（含"## 共享区阶段总结（可选）"标题、'\n' 前缀等，保持字符串结构 100% 一致）
  - `subAgentContractFor(opts: { task: string; outputPath: string }): string` — 从 `query-based-session.ts:1715-1725` 抽成函数，参数化 task / outputPath
- [ ] `electron/main/agents/query-based-session.ts::buildSystemPrompt` 改：
  - 第 1707-1712 行 `parts.push(...)` 替换为 `parts.push(NOTES_GUIDANCE_APPEND)`
  - 第 1715-1725 行 `parts.push(...)` 替换为 `parts.push(subAgentContractFor({ task, outputPath }))`
  - 顶部 import 新增两项

**验证**：`bun run build:electron` 通过；启动 dev 跟原来行为一致（可在 log 里找 "系统提示词" 段确认拼装内容未变）。

### 1b. 新增 SystemPromptSegment 类型 + 收集函数

- [ ] 新建 `types/system-prompt.ts`，导出 `SystemPromptSegment` 接口（结构见 plan.md「数据结构」段）
- [ ] `electron/main/types.ts` 添加镜像 `export type { SystemPromptSegment } from '...'`——但因为主进程不能直接 import `types/`，实际做法是**在 `electron/main/types.ts` 里直接定义相同 interface**，前后端各维护一份（这是项目现有约定）
- [ ] `session-append-templates.ts` 末尾新增 `export function getSystemPromptSegments(): SystemPromptSegment[]` —— 返回 6 个 segment（清单见 plan.md「展示段清单」）：
  - `tool-pack-guide` — template 用一段"典型输出"示例（因为真实输出依赖 `enabledToolPacks` 参数），triggerDescription 说明"根据用户启用的工具包动态生成"
  - `group-context` — template 用 group-context-builder 输出的"典型格式"（可以从 group-context-builder.ts:53 的注释里那段示例复用），triggerDescription 说明"会话所属组 + 共享区文件清单"
  - `reference-append` — template = `REFERENCE_APPEND` 常量原文
  - `group-append` — template = `groupAppendFor('<组名>')` 的示例输出（把 `${safeName}` 换成 `<组名>` 占位），triggerDescription 说明"组内非首个主会话"
  - `notes-guidance` — template = `NOTES_GUIDANCE_APPEND`
  - `sub-agent-contract` — template = `subAgentContractFor({ task: '<任务描述>', outputPath: '<交付路径>' })` 的示例输出

### 1c. 新建 tipc 路由

- [ ] 新建 `electron/main/tipc/system-prompt.ts`：
  ```ts
  import { tipc } from '...'; // 参照项目现有 tipc handler 写法
  import { getSystemPromptSegments } from '../agents/session-append-templates.js';
  
  export const systemPromptRoutes = {
    getSystemPromptSegments: tipc.procedure.action(async () => {
      return getSystemPromptSegments();
    }),
  };
  ```
- [ ] `electron/main/tipc/index.ts` 聚合：加 `import { systemPromptRoutes } from './system-prompt.js'` + 在 router 合并处加 `...systemPromptRoutes`

**验证**：`bun run build:electron` 通过；启动 dev 后前端能通过 `client.getSystemPromptSegments()` 拿到 6 个 segment（前端没写完前可以用 devtools console 手工调）。

## 实施回填

### 实际改动
- **与计划差异**：
  1. `group-context` 段的 template 无法直接调 `buildGroupContextPrompt`（异步 + 依赖 workspaceId/groupId），改用私有静态常量 `GROUP_CONTEXT_EXAMPLE`（复现 `group-context-builder.ts` JSDoc 示例格式）。符合 plan「只模板不拉运行时」的思路。
  2. `tool-pack-guide` 段用 `buildToolPackGuide([], false)` 生成零启用工具包的基线示例（该函数是纯同步的，直接调用即可）。
  3. `tipc` handler 参照 `review.ts` 惯例返回 `{ segments } | { error }` 而非直接 `SystemPromptSegment[]`（异常场景走 error 分支），前端消费需判断分支。
- **改动文件清单**：
  - `electron/main/agents/session-append-templates.ts` — 新增 `NOTES_GUIDANCE_APPEND` 常量、`subAgentContractFor()` 函数、私有 `GROUP_CONTEXT_EXAMPLE` 常量、`getSystemPromptSegments()` 收集函数
  - `electron/main/agents/query-based-session.ts` — 引用新导出替换硬编码字符串（段 7 / 段 8）
  - `types/system-prompt.ts`（新建）— `SystemPromptSegment` interface
  - `electron/main/types.ts` — 追加同名 interface 镜像
  - `electron/main/tipc/system-prompt.ts`（新建）— `systemPromptRouter`
  - `electron/main/tipc/index.ts` — 聚合 `systemPromptRouter`

### 给下一步的接力棒
- **关键签名**：`client.getSystemPromptSegments(): Promise<{ segments: SystemPromptSegment[] } | { error: string }>` —— 前端要判断 `'segments' in result` 或 `'error' in result` 分支
- **`SystemPromptSegment` 字段最终定型**：与 plan.md 一致，无字段调整
- **前端 import 位置**：从 `types/system-prompt.ts` import `SystemPromptSegment`
- **6 个 segment 的 key 值**：`tool-pack-guide` / `group-context` / `reference-append` / `group-append` / `notes-guidance` / `sub-agent-contract`（顺序即数组顺序）
- **待办 / 已知限制**：
  - `group-context` template 是静态示例（模板样例）而非当前会话实际拼装结果；前端展示时应体现「样例」语义
  - `tool-pack-guide` template 是零启用基线；`isDynamic=true` 提示用户实际值随工具包启用变化
  - 5 个 category 值需要前端在 UI 上有类别徽章映射（categoryLabel + 颜色）
