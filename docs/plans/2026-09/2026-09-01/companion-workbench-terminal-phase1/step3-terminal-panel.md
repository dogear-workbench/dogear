---
step: 3
title: 终端面板（跟随/固定 + 卡片流渲染）
status: done
---

## 目标
`components/companion/TerminalPanel.tsx`：拉历史 + 订阅增量，按命令分组卡片流渲染（ANSI 颜色），支持跟随活动会话 / 固定某会话，挂进 CompanionPanel 的终端 tab。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：RPC `getTerminalBuffer(conversationId)` → `TerminalEntry[]`；广播事件 `terminal-stream:append`，payload `{ conversationId, toolCallId, command, kind: 'start'|'append'|'replace'|'end', suffix?, text?, exitCode? }`（以 step1 实际签名为准，回填处已有）
- 前置 step2 产出：CompanionPanel 的 tab 内容分发点、`ui-store.rightPanelTab` 含 `'terminal'`（回填处有组件签名）
- 全局决策：面板可移植（store + tipc，不依赖主窗口上下文）；不做 xterm/联动/快捷键
- ANSI 渲染：优先引 `ansi-to-react`（轻量、React 友好）；若依赖评估不过关（体积/维护）则自写最小转换器（SGR 颜色/加粗/清除行 `\x1b[2K\r`、光标控制序列剥离）
- 跟随模式：主窗口内嵌 tab 订阅 `session-store.activeTabId` 对应会话；固定模式：顶部下拉列出会话（复用 `conversation-store` 会话列表，标题用 `getConversationTitle`），选中后不随 activeTab 变化；默认跟随，用户点锁定按钮转固定
- 滚动：面板滚到底部时新内容自动跟随滚（用户上滚则停止自动滚，回底恢复）——参考 AgentChat 现有滚动跟随实现模式

## 计划改动
- [x] 新建 `stores/terminal-store.ts`：`buffers: Map<conversationId, TerminalEntry[]>`、`ensureBuffer(conversationId)`（拉历史，去重防重复拉）、订阅 `terminal-stream:append` 按会话更新条目（append 定位 toolCallId 拼 suffix，replace 整体重设）；模块加载时建立订阅（参考 smart-category-store 的 dynamic import @/lib/events 模式）
- [x] 新建 `components/companion/TerminalPanel.tsx`：头部（跟随/固定切换 + 会话下拉 + 清屏按钮）+ 命令卡片流（卡片头：`$ command` + 状态徽章 running/exit code + 相对时间；卡片体：ANSI 渲染 text，等宽字体，max-h 折叠 + 展开全文）+ 空态 + 自动滚动跟随
- [x] CompanionPanel 终端 tab 挂 `<TerminalPanel />`
- [x] 渲染性能：卡片体 text 变化频繁，用 memo + 按 toolCallId 稳定 key；运行中卡片自动展开、完成态默认折叠（保留最近 N=5 条展开，可点击切换）

## 验证
- 主窗口右侧栏切终端 tab：让 agent 跑命令，实时看到卡片流增长（颜色/进度条类命令如 `bun run build`、`pip install` 观察滚动）
- 锁定到子会话 B 后，主窗口切到会话 A 聊天，B 的执行流持续更新不串
- 后开面板先见历史再无缝接增量（关面板再开、中途跑命令）
- 长输出命令（>256KB 触发截断）渲染不卡；空态/异常命令（exit code 非 0 红色徽章）正常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
	- 新增依赖 `ansi-to-react@6.2.6`（维护活跃、React 19 peerDep、12KB+anser 40KB），用默认 inline style 直出 rgb 真实色（truecolor/palette/16 色全覆盖，含 `\r` 回车行处理），未用 useClasses（需自写 CSS 且 palette/truecolor 类名无法穷举）
	- store 额外维护 `runningIds: Map<convId, Set<toolCallId>>`：TerminalEntry 无 running 字段，end 的 exitCode 对 abort/timeout 也是 undefined，不补这个集合无法区分「运行中」和「异常终止」两种徽章
	- 跟随/固定状态（followMode/pinnedConversationId）放 terminal-store 而非组件本地 useState：Step 4 工作台窗口要在窗口初始化时默认固定模式，跨组件/跨挂载也保留
	- 折叠卡片只渲染 text 尾部 3000 字符（终端关注最新输出），展开才全量渲染 + max-h-72 内部滚动；运行中卡片内部自动滚底（外部跟随逻辑不受长输出滋扰）
	- 「保留最近 5 条展开」实现为派生默认值 + 用户点击 override Map，非持久化展开集合
	- 滚动跟随为 TerminalPanel 内精简自写 hook（参考 useChatScroll 模式：wheel capture + programmaticRef + 回底 48px 恢复），不 import useChatScroll（它耦合 isLoading/minimap）
	- 额外写了 `stores/terminal-store.test.ts`（6 项：事件全流程/未知 id 忽略/多会话隔离/clearBuffer/ensureBuffer 拉历史与去重/并发去重）
- 改动文件清单：
	- `stores/terminal-store.ts`（新建）
	- `stores/terminal-store.test.ts`（新建，bun test 6 pass）
	- `components/companion/TerminalCard.tsx`（新建，memo 卡片）
	- `components/companion/TerminalPanel.tsx`（重写空态占位为完整面板）
	- `package.json`（ansi-to-react）
	- CompanionPanel 未动（终端分支已渲染 `<TerminalPanel />`）

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 step3-delivery.md（含 Step 4 窗口「默认固定模式」的实现方式：窗口初始化时调 `useTerminalStore.getState().pinConversation(conversationId)`，无需改 TerminalPanel props）
- 下个 step 该从哪里继续：Step 4 工作台窗口直接复用 `<TerminalPanel />`（无 props，可移植纪律已达标：只依赖 store + tipc client + ui 组件）；注意 ansi 颜色是 inline style 无需额外 CSS，但窗口入口若不共享主 bundle 需确认 Tailwind 类生成覆盖
- 待办或已知限制：
	- 真机运行时验证项未跑（需 `bun run dev` 人工）：实时卡片流增长/颜色、锁定跨会话不串、历史+增量无缝、>256KB 长输出性能、异常命令红色徽章
	- 清屏只清渲染端本地镜像，主进程缓冲未清（无对应 RPC）；面板重开不重拉（buffer 已存在），清屏效果保留
	- 会话重启（close→重建）后渲染端保留旧条目续写新命令（历史卡片+新卡片连成一流）；此时若渲染端 reload 则 RPC 只能拿到新会话缓冲
