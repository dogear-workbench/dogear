---
step: 2
title: 前端会话域收敛
status: pending
---

## 目标

删掉前端散落的手动 `loadConversations()` 调用，统一走 conversationListChanged 事件回环；订阅按 workspaceId 过滤；清理 group-store 死链。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 已让 service 层全部写点广播（结构 immediate / 元数据 debounced），前端现有手动刷新此刻是冗余双保险
- 现状触发点清单（盘点报告 A2，执行时逐一核对）：
  1. workspace-store.setWorkspace（**保留**——切工作区必须主动拉，事件负载可能来自别的 workspaceId）
  2. conversation-store 写操作后：newConversation、deleteConversation、handleTopicStateChange、forkConversation、createFolder、renameFolder、deleteFolder、moveItem、addGroupToFolder、removeGroupFromFolder、moveGroupBetweenFolders
  3. app/session-window/page.tsx:59（**保留**——窗口初始化显式拉）
  4. components/group-list/GroupCard.tsx:80（组内新建对话后）
  5. conversationListChanged 事件订阅（保留，成为主通道）

## 计划改动

- [ ] conversation-store 订阅处按事件负载 `{ workspaceId }` 过滤：匹配当前工作区才 loadConversations（Step 1 定的负载结构，见其接力棒）
- [ ] 删清单第 2、4 类的手动 loadConversations 调用。**重点风险**：部分 action 是「loadConversations() 之后从新列表里找刚建的会话再选中」的顺序依赖——删掉后找不到。这类改成用 create 的返回值（id）直接走选中/开 tab 逻辑，不依赖列表刷新。逐处核对，宁慢勿漏
- [ ] `stores/group-store.ts`：删 load 函数里的 autoArchiveStale 触发；若确认 load 整体无调用方（盘点结论：无人调用），整个 load 函数删除
- [ ] Tab/列表选中态回归验证（见验证清单）
- [ ] `bun run lint`

## 验证

逐操作点验「操作生效 + 列表正确更新 + 选中态/展开态不丢」：
- 新建对话（点击后新会话立即出现并选中，无 0.5s 迟滞——immediate 档）
- 删除对话（列表移除、活动 tab 正确回退）
- 分叉、改标题、移动到文件夹、组内新建对话、归档/恢复话题
- agent 跑活期间（touch 高频）列表无风暴刷新，但「近期」排序会更新

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 保留的手动 loadConversations 清单（哪些场景仍主动拉）：
- 列表事件回环最终形态（订阅过滤逻辑位置）：
- 下个 step 该从哪里继续：
- 待办或已知限制：
