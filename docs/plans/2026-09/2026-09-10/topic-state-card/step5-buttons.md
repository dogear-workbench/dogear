---
step: 5
title: 用户快捷按钮
status: pending
---

## 目标
ChatInputArea 底部工具行加「记一笔 / 这事做完了」快捷按钮：零模型成本直接写状态卡 user 条目。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-store.md] `appendUserEntry(groupId, category, text)` API；[step4-ui.md] TopicPanel 渲染已能显示 user 条目
- 现状：`components/agent-chat/ChatInputArea.tsx:429` 底部工具行 `InputGroupAddon align="block-end"`（现有附件/模型选择/权限模式成员）；红线：不经 tipc 不得直接操作文件系统；不用 window.prompt（用 confirm-store 或内联输入）
- 需要知道当前会话的 groupId（会话列表/路由已有组上下文，从现有 store 取）

## 计划改动
- [ ] 主进程：tipc 新 procedure `appendStateUserEntry(groupId, category, text)` → 调 appendUserEntry（写后自动广播）
- [ ] 前端 ChatInputArea 工具行加两个按钮：
  - 「这事做完了」：点击弹轻量输入（内联 Popover 输入框，回车提交）→ 追加 completed 条目（source: user）
  - 「记一笔」：同交互，类别可选（进行中/阻碍/下一步/想法），默认想法→ openQuestions
  - 按钮仅在会话属于某组时显示（无组隐藏）
- [ ] 提交成功给轻反馈（toast 或按钮短暂变色）；失败提示不静默
- [ ] 验证：点击后 TopicPanel 状态卡即时出现新条目（广播通路）；开新会话确认注入包含 user 条目
- [ ] `bun run build:electron` + lint + dev 双端跑通

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
