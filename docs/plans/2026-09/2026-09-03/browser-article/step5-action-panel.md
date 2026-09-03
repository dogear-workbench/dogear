---
step: 5
title: 伴随面板动作流
status: done
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
  1. `ui-store.ts` 的 `rightPanelTab` 联合类型加 `'browser'` 成员（类型层面必需的最小扩展，tab 机制未动）
  2. 事件结构在规定字段外加 `seq`（缓冲内单调递增，渲染层拉取/订阅竞态合并用）与 `source`（可选，动作来源：parseArticle / readArticle / 工具短名）
  3. CompanionPanel 的第五 tab 用文字「浏览器」对齐现有 TABS 纯文字结构（现有 tab 无图标位），Globe 图标用在面板状态行与空状态
  4. 手动解析任务标记为「手动解析 · <hostname>」（从动作 url 取 hostname；文章标题在动作事件里不可靠，未用）
  5. Agent 会话名解析顺序：session-store.tabs（全局）→ conversation-store.conversations（当前工作区）→ 「会话 <8位短id>」兑底
  6. 接线方式：`tipc/browser.ts` 的 `registerBrowserActionBridge()`（对齐 registerPtyBroadcaster 注册制模式）统一注册广播桥 + Agent 工具 hook；手动路径在 `tipc/article.ts` 调 readArticleWithBrowser 时传 onAction（侵入最小，不动 service/tools 内部）
- 改动文件清单：
  - `electron/main/services/browser/browser-action-stream.ts` **新建**（环形缓冲 500 + 注册制广播 + taskId 归一化 + 状态快照）
  - `electron/main/services/browser/browser-manager.ts` 加 `getSnapshot()` 只读快照（running/launched/queued/holder，不碰队列）
  - `electron/main/tipc/browser.ts` **新建**（getBrowserActions RPC + registerBrowserActionBridge）
  - `electron/main/tipc/article.ts` onAction 接线 1 处
  - `electron/main/tipc/index.ts` router 展开 + registerTipcHandlers 调 bridge
  - `electron/main/tipc/renderer-handlers.ts` 加 `browserActionAdded` 事件
  - `stores/browser-store.ts` **新建**（ensureLoaded 拉历史 + 增量广播追加 + seq 竞态合并）
  - `components/companion/BrowserPanel.tsx` **新建**（状态行 + 按任务分组动作卡片流，运行中任务置顶）
  - `components/companion/CompanionPanel.tsx` 第五 tab
  - `stores/ui-store.ts` 类型加 `'browser'`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `BrowserActionEvent = { taskId, kind: 'article'|'agent', seq, ts, action, url?, detail?, result?, source? }`；taskId 归一化 `article:<articleId>` / `agent:<conversationId|adhoc>`
  - 主进程发源统一入口 `recordBrowserAction({ source, taskMeta, action, url?, detail?, result? })`；广播注册 `setBrowserActionBroadcaster(fn|null)`；历史 `getBrowserActionHistory()`；状态 `getBrowserStreamStatus()`（内部走 manager.getSnapshot）
  - RPC `getBrowserActions({ limit? })` → `{ events, status }`；广播事件 `browserActionAdded`
- 下个 step 该从哪里继续：step6 测试基建（resources/browser-eval/）；跑测试任务时可开伴随面板浏览器 tab 观察动作流
- 待办或已知限制：
  - 渲染层 UI 运行时未在真实 Electron 窗口验证（本会话环境限制），已用 tsc + 主进程链路脚本覆盖；建议主会话 dev 起来后人工看一眼
  - `status.queued`/`running` 仅在事件到达或面板打开时刷新（排队/释放无独立广播事件，任务间隙状态可能滞后，下一条事件到达即纠正）
  - 会话名匹配不到（非当前工作区/已归档）时显示「会话 <短id>」
