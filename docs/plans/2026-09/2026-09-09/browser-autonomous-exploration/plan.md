# 浏览器自主探索闭环 实施计划

**目标**：打通「agent 自主探索 + 用户接管/交还 + 完成后继续」的纵向闭环，SERP 解析不再决定任务生死；顺手把浏览器面板改成「页面为主体」。

**架构思路**：搜索快档诚实失败（有结果可探索时保留页面返回结构化信号而非降级导航走）；等待人工/接管互斥（显式锁）统一「解除即唤醒会话」链路（tipc 层 glue，PiSession.sendMessage 已内置 idle/running/paused 三态分支）；bounds 同步对齐 Proma（rAF+revision+lastBounds）。设计全文见 [../browser-autonomous-exploration-design.md](../browser-autonomous-exploration-design.md)。

**涉及模块**：`browser-search-service.ts` / `serp-parsers.ts` / `human-intervention.ts` / `embedded/embedded-browser-manager.ts` / `embedded/actions.ts` / `embedded/ax-observe.ts` / `embedded/proxy.ts` / `embedded/presentation.ts` / `agents/tools/browser-atom-tools.ts` / `agents/tools/browser-action-tools.ts` / `tipc/browser.ts` / `components/companion/BrowserPanel.tsx` / `BrowserPageView.tsx` / `BrowserInterventions.tsx` / `stores/browser-store.ts`

## 步骤索引

- [x] [Step 1: 搜索诚实失败与验证页冻结](./step1-search-honest-failure.md) — parse_empty 前探测页面可交互结果，有结果保留页面不降级；验证页呈现+等待人工+冻结不带走
- [x] [Step 2: 接回 Agent 与接管互斥锁](./step2-resume-and-takeover.md) — 「完成后继续」唤醒会话；tab 显式接管锁 + 写工具前置拒绝 + 交还唤醒
- [x] [Step 3: 观察与操作质量](./step3-observe-quality.md) — click 双触发修复、observe_page DOM 链接兜底、代理 PAC 修正
- [x] [Step 4: 浏览器面板主体化](./step4-panel-ui.md) — 地址栏+页面占满+接管按钮+日志折叠；bounds rAF+revision 同步

## 全局决策

- **错误约定**：工具层一律 `isError: true` 返回不抛异常；服务层不 throw，错误归类在返回值（沿用现状）
- **takeover 模型**：`takeover: { active: boolean; taskMeta?: BrowserTaskMeta } | null` 挂 TabRecord 上；写工具（navigate/click/fill/scroll/press/wait_for）前置检查，读工具（observe/read_text/read_state/screenshot）放行
- **唤醒链路唯一入口**：tipc/browser.ts 内私有函数 `resumeConversation(conversationId, message)`——`getSessionIdByConversation` → `getSession` → `sendMessage`；等待人工解除与接管交还都走它；services 层不 import agents（防反向依赖）
- **唤醒消息模板**：带 reason + tab 当前 URL + 「重新观察当前页面后继续，不要从头重跑」；不重放旧 ref
- **generation 语义**：交还时主动递增 generation（旧 ref 全失效）；用户接管期间的任何导航由现有 tab-events 自然递增，不额外处理
- **保守原则**：探测异常一律按「有结果可探索」保留页面；宁可误保留不可误杀
- **UI 数据流**：新广播事件 `tabTakeoverChanged`（全量 takeover 列表，对齐 humanInterventionChanged 全量刷新模式）；前端经 browser-store 消费
- **构建纪律**：主进程改动需 `bun run build:electron`；改完跑 `bun run lint`；内嵌链路自测 `DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 bunx electron .`（如自测脚本需扩展，随步骤补断言）

## 完成总结

四个 step 全部实施完毕（2026-09-09，commits ddda969 / a680b4c / 30ca7d9 / ee6f61d），构建 / lint / 前端 tsc / bun test（298 pass）全绿。

- **搜索诚实失败**：parse_empty 前探测页面可探索结果（容器/链接计数，异常保守视为有结果），有结果保留页面返回结构化失败信号（pageAvailable + hint）不降级引擎；验证页呈现后 raise 等待人工并释放 tab，下一引擎开新 tab 不带走验证页
- **接回 Agent 与接管互斥锁**：tipc 层 resumeConversation 唯一唤醒入口（running=steer / idle=prompt），「完成后继续」与接管交还共用；tab 显式接管锁，接管期间写类工具被拒（user_takeover），交还时 generation 递增旧 ref 失效并唤醒会话
- **观察与操作质量**：checkbox/radio 键盘激活后回读 checked 已翻转则跳过 synthetic 补点；observe_page 在 AX 可交互 <5 且正文 >500 时附 DOM 可见链接兜底（≤30 条）+ 前置屏外挂载；代理 PAC 区分 socks/http/裸地址三形态、清空显式回直连；新增 13 条 bun 单测
- **面板主体化**：地址栏（后退/前进/刷新/URL/接管/收起）+ 页面 flex-1 占满 + 等待人工置顶横幅 + 日志默认收起抽屉；bounds 同步 rAF 合帧 + 全局 revision 门控拒晚到 + lastBounds 恢复（排除屏外挂载污染）

### 遗留（需人工验收）

- 本机有运行中 Dogear 实例占用命名管道，`DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 bunx electron .` 全程未跑：honest_failure / takeoverSmoke / checkbox 双击 / observeFallbackSmoke / userNavSmoke 五个自测分期已就位，需无实例冲突环境补跑
- GUI 人工验收场景：Google parse_empty 诚实失败实测、会话 steer 插话实测、拖拽跟手观感、tab 切换无白屏、地址栏五场景、DropdownMenu 内嵌接管按钮 pointer 序列
- 已知限制：验证页 tab 被 TTL 回收后 intervention 卡片不自动清理（既有限制）；SerpPresenceResult 可扩展 topLinks 附标题列表（优化项）
