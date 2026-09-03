---
step: 5
title: 伴随面板动作流
status: pending
---

## 目标

浏览器动作流可视化：action-stream 服务（环形缓冲 + 增量广播）+ 伴随工作台第五 tab。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] browser-article-service 已留 `onAction` 回调点；[step4] 原子工具是第二动作源
- 当前关键文件状态：terminal-stream 的实现模式（环形缓冲 + 快照前缀 diff 增量广播 + 后开窗口先 RPC 拉历史再订阅）；`TerminalPanel.tsx`（跟随/固定 + 底部实例 tab）与 `terminal-store.ts` 是面板结构模板
- 关键决策：动作流按「任务」组织（taskMeta 的 kind + conversationId/articleId 标记）；一期一条全局流即可不做实例 tab（单 tab 单队列决定了同时只有一个任务在跑）

## 计划改动

- [ ] 新建 `electron/main/services/browser/browser-action-stream.ts`：动作事件 `{ taskId, kind, ts, action(navigate/click/wait/parse/observe), url?, detail?, result? }`；环形缓冲（约 500 条）；增量广播；`getBuffer()` 历史 RPC
- [ ] 发源接线：browser-article-service 的 onAction 与 step4 原子工具的工具 handler 统一 emit
- [ ] `tipc/browser.ts`：`getBrowserActions` 历史 + 状态（空闲/运行中 + 当前任务标记）；`renderer-handlers.ts` 增 `browserActionAdded` 广播
- [ ] `stores/browser-store.ts`：订阅广播 + 按需拉历史（照 terminal-store 结构）
- [ ] `components/companion/BrowserPanel.tsx`：动作卡片流（动作图标 + URL/详情 + 结果摘要，时间分组），顶部运行状态行（当前任务、浏览器实例状态）；手动解析任务显示「手动解析 · 文章标题」标记，Agent 任务显示会话名
- [ ] `CompanionPanel.tsx` 增第五 tab（图标 Globe）；`ui-store` 无需改动（tab 状态已有机制）；宽度记忆沿用现有 per-tab 机制

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
