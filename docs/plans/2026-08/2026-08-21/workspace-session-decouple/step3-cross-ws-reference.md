---
step: 3
title: 跨工作区会话引用
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
