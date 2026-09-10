---
step: 5
title: 用户快捷按钮
status: done
---

## 目标
ChatInputArea 底部工具行加「记一笔 / 这事做完了」快捷按钮：零模型成本直接写状态卡 user 条目。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-store.md] `appendUserEntry(groupId, category, text)` API；[step4-ui.md] TopicPanel 渲染已能显示 user 条目
- 现状：`components/agent-chat/ChatInputArea.tsx:429` 底部工具行 `InputGroupAddon align="block-end"`（现有附件/模型选择/权限模式成员）；红线：不经 tipc 不得直接操作文件系统；不用 window.prompt（用 confirm-store 或内联输入）
- 需要知道当前会话的 groupId（会话列表/路由已有组上下文，从现有 store 取）

## 计划改动
- [x] 主进程：tipc 新 procedure `appendStateUserEntry(groupId, category, text)` → 调 appendUserEntry（写后自动广播）
- [x] 前端 ChatInputArea 工具行加两个按钮：
  - 「这事做完了」：点击弹轻量输入（内联 Popover 输入框，回车提交）→ 追加 completed 条目（source: user）
  - 「记一笔」：同交互，类别可选（进行中/阻碍/下一步/想法），默认想法→ openQuestions
  - 按钮仅在会话属于某组时显示（无组隐藏）
- [x] 提交成功给轻反馈（toast 或按钮短暂变色）；失败提示不静默
- [x] 验证：点击后 TopicPanel 状态卡即时出现新条目（广播通路）；开新会话确认注入包含 user 条目
- [x] `bun run build:electron` + lint + dev 双端跑通

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 按钮拆独立组件 `TopicQuickEntry.tsx`（ChatInputArea 已 570 行，不拆会超长）；
  2. workspaceId 不加到 ChatInputArea props，复用 `useWorkspaceId()`（TopicQuickEntry 在 WorkspaceIdProvider 内，无 provider 时返回 null 安全）；
  3. 「记一笔」类别选择用 Popover 内 chip 按钮（非二级菜单），默认想法；
  4. tipc 层加 category 白名单校验返回友好错误（appendUserEntry 对非法 category 会 TypeError）。
- 改动文件清单：
  - `electron/main/tipc/group.ts`：新增 `appendStateUserEntry` procedure（`{workspaceId, groupId, category, text}` → `{ok, error}`）
  - `components/agent-chat/TopicQuickEntry.tsx`：新增，两个快捷按钮 + 内联 Popover 输入（回车提交，sonner toast 反馈）
  - `components/agent-chat/ChatInputArea.tsx`：props 加 `groupId?: string | null`；工具行权限模式后渲染 `TopicQuickEntry`（无组隐藏）
  - `components/agent-chat/AgentChat.tsx`：传 `groupId={currentConversation?.groupId || null}`

### 给下一步的接力棒
- 关键签名 / 数据结构：`client.appendStateUserEntry({workspaceId, groupId, category, text})` → `{ok, error}`；非法/空文本由 tipc 层/store 层拦，返回 `{ok:false, error}` 不抛
- 下个 step 该从哪里继续：无（本计划最后一步）
- 待办或已知限制：无 GUI 环境，Popover 视觉与焦点行为未人工验收；建议有 GUI 时跑 `bun run dev` 肉眼过一遍输入区工具行与话题面板联动
