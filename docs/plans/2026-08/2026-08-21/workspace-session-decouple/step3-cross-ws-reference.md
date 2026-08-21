---
step: 3
title: 跨工作区会话引用
status: done
---

## 目标

临时态（浏览 B、焦点 A 会话）下右键 B 列表会话引用进 A 会话：引用数据带 workspaceId、注入标签带 workspaceId、后端 `dogear__ReadReferenceSession` 支持按指定工作区定位 session 文件。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-focus-linkage.md] 焦点联动已就位——「浏览工作区 ≠ 焦点会话工作区」的临时态可通过顶部切换器制造出来（验证本步的前置条件）
- 关键现状签名：
  - `stores/reference-store.ts`：`ConversationReference { conversationId, title, sessionId: string | null }`；`addReferencedConversation(conv)` 按 conversationId 去重
  - 引用入口：`components/conversation-list/ConversationRow.tsx` 的 hover「引用」按钮（调 addReferencedConversation，传入列表行数据；列表行的 Conversation 对象自带 `workspace_id` 字段——蛇形命名，注意与驼峰区分）
  - 注入点：`components/agent-chat/hooks/useSendMessage.ts:366-371`：
    ```ts
    const convLines = referencedConversations.map(c =>
      `  <conversation title="${sanitize(c.title)}" conversationId="${c.conversationId}" sessionId="${c.sessionId || ''}" />`)
    ```
  - 后端工具：`electron/main/agents/tools/reference-tools.ts` 的 `dogear__ReadReferenceSession`，zod schema 目前只有 `sessionId / tail / range`；handler 调 `readCleanTranscript(workspaceId, args.sessionId, {...})`（workspaceId 来自 opts closure = 子会话所属工作区）
  - 该工具**只装到子会话**（主 agent 靠派子会话消化引用），主会话提示词里硬列了工具名
- 关键决策回顾：workspaceId 参数可选（不传按 closure 当前值，完全兼容现状）；跨工作区引导文案放注入 text（动态）而非系统提示词（静态）

## 计划改动

- [ ] `stores/reference-store.ts`：`ConversationReference` 加 `workspaceId: string`
- [ ] `components/conversation-list/ConversationRow.tsx`：引用时传入 `workspaceId: conversation.workspace_id`
- [ ] `components/agent-chat/hooks/useSendMessage.ts:366-371`：标签行加 `workspaceId="${c.workspaceId}"`；若存在 `c.workspaceId ≠ 当前焦点会话工作区` 的引用，在 `</referenced_conversations>` 后追加一行说明：`（注：引用的会话可能属于其他工作区，读取其原文时请把 workspaceId 参数一并传给 ReadReferenceSession）`。焦点会话工作区从 `useSessionStore.getTab/useConversationStore` 现有数据取，实现从简
- [ ] `electron/main/agents/tools/reference-tools.ts`：`dogear__ReadReferenceSession` schema 加 `workspaceId: z.string().optional().describe('目标会话所属工作区 id；引用跨工作区会话时从 <conversation> 标签取')`；handler 用 `args.workspaceId ?? opts.workspaceId` 传给 readCleanTranscript
- [ ] **`bun run build:electron`（后端改动，Vite 热重载不生效）**
- [ ] `bun run lint` + 重启应用手动验证

## 验收清单

- [ ] 同工作区引用（回归）：引用当前工作区会话 → 发送 → agent 派子会话能读到原文（不传 workspaceId 走 closure）
- [ ] 跨工作区引用：焦点 A 会话 → 顶部切浏览 B → 右键 B 列表会话「引用」→ 芯片出现 → 切回 A tab（或直接发送）→ 发送 → 标签含 workspaceId → agent 派子会话带参调用能读到 B 会话原文
- [ ] 引用芯片移除/清空逻辑不受影响（回归）
- [ ] 子会话派出的场景：主会话在 task 文本里传达 sessionId + workspaceId，子会话工具调用成功

## 实施回填（做完后填）

### 实际改动
- 与计划差异（三点，零实质偏离）：
  1. **焦点工作区取法弃用 selectedConversation**，只用 `getTab(conversationId)?.workspaceId ?? 全局 workspace.id` 双重回落——Step 2 后临时态下 conversation-store 顶层分片已切到浏览工作区，selectedConversation 语义错误；tab.workspaceId 是唯一权威（全局决策 2）
  2. 未改 session-append-templates.ts：按本 step 关键决策「引导文案放注入 text 动态生成」执行，静态模板会污染所有会话，覆盖了设计文档的静态方案
  3. 跨工作区注记拼在 `</referenced_conversations>` 同一 text block 尾部，不新增 block
- 改动文件清单：`stores/reference-store.ts`（+workspaceId 必填）、`components/conversation-list/ConversationRow.tsx`（蛇形 workspace_id 转驼峰）、`components/agent-chat/hooks/useSendMessage.ts`（标签带 workspaceId + 动态注记）、`electron/main/agents/tools/reference-tools.ts`（schema 可选参数 + handler `args.workspaceId ?? closure`）
- 边界记录：focusWorkspaceId 全空（极早期）不加注记但标签仍带 workspaceId，保守降级；传无效 workspaceId → readCleanTranscript 返回 ok:false → isError: true，容错安全；引用芯片 UI 未显示工作区徽标（未来扩展）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  ```ts
  ConversationReference { conversationId, title, sessionId: string | null, workspaceId: string }
  // 注入标签：
  <conversation title="..." conversationId="..." sessionId="..." workspaceId="..." />
  // 后端：ReadReferenceSession({ sessionId, workspaceId?, tail?, rangeStart?, rangeEnd? })
  ```
- 下个 step 该从哪里继续：Step 4 拦另一条链路——临时态（浏览 B、焦点 A）右栏文件/文件夹引用进 A 会话会路径错乱，在 `WorkspaceExplorer.tsx` / `AdditionalFilesPanel.tsx` 引用入口（addReferencedFile 调用处前置）校验「被引用项工作区 ≠ 焦点 tab.workspaceId → toast 拒绝」；焦点 tab 用 `getTab(activeTabId)?.workspaceId`，HOME_TAB_ID 时 undefined 不拦；拒绝文案统一全局决策 6；后端不改文件则无需 build:electron
- 待办或已知限制：手动验收 4 项（同工作区回归 / 跨工作区全链路 / 芯片移除回归 / 子会话带参调用）需重启应用后人工验证；lint 0 errors + build:electron 已过
