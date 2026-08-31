---
step: 4
title: 伴随工作台窗口
status: done
---

## 目标
新建「伴随工作台」独立窗口：单例、记住位置，内含与右侧栏同构的四 tab（文件/附加/话题/终端），header 图标直接打开（不经内嵌中转）。

## 依赖上下文（接力棒输入）
- 前置 step2/3 产出：`components/companion/CompanionPanel.tsx` 签名（props、tab 分发）与 `TerminalPanel` 可移植性已验证（回填处有记录）
- 窗口模式参考：`electron/main/index.ts:87-246` 数据中心单例（模块级变量 + 已开 focus + `closed` 置 null + `loadURL(getRendererPath() + '#/xxx')`）
- 位置记忆（新要求，数据中心未做，本窗口做成通用小工具）：窗口 `resized/moved` 防抖后把 `{x,y,width,height}` 存主进程 settings 或独立 JSON（倾向：`app-state.json` 或既有窗口状态存储，勘查后选既有机制；无则新建 `window-state-service`，key `workbench-window`）；创建时读取并校验在屏幕可视范围内（`screen.getDisplayMatching` 兜底居中）
- 路由：`app/workbench-window/page.tsx` 新页面（HashRouter 路由，参考 `app/data-center/page.tsx` 挂载方式）；页面内独立初始化 tipc client + 独立 store 实例（参考 session-window 独立初始化模式）
- 同构 tab：新窗口页面直接复用 `CompanionPanel`（或其 tab 内容子组件组合），tab 状态为窗口本地（不与主窗口共享，符合容器本地状态纪律）
- 主窗口会话独立窗口化的会话不在主窗口 tab——终端跟随模式在窗口内的语义：跟随主窗口活动会话不可得（跨窗），**窗口内默认固定模式**，下拉选会话

## 计划改动
- [x] `electron/main/index.ts`：`openWorkbenchWindow()` 单例创建 + 位置记忆读写；`closed` 置 null
- [x] 渲染端入口：`app/workbench-window/page.tsx` 组合四 tab（复用 companion 组件，TopicPanel/AdditionalFilesPanel 需要的 workspaceId/groupId props 在窗口内自行选择当前工作区，参考数据中心页加载 workspaces 的方式）；终端 tab 默认固定模式
- [x] tipc 路由：`open-workbench-window`（挂 windows.ts 既有窗口路由旁）
- [x] `app/page.tsx` header 加伴随工作台入口图标（与数据中心按钮同排同款样式）
- [x] doc-sync：`docs/codebase-map.md` 补 companion 模块、terminal 服务、workbench-window 路由

## 验证
- header 点开窗口：单例（重复点 focus）；拖动/缩放后关闭重开位置尺寸保持；屏幕断开重连不飞出可视区
- 窗口内四 tab 可用：文件树/附加/话题数据正常（独立 store 实例拉取）；终端固定会话流与主窗口内嵌同会话内容一致（同 store 数据源验证）
- 双屏实机：主窗口会话 A 聊天，工作台窗盯子会话 B 执行流，互不干扰
- 关闭工作台窗口再开，缓冲历史仍在（主进程缓冲不随窗口销毁）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
	- tab 状态复用 ui-store.rightPanelTab：Electron 每窗口独立渲染进程，ui-store 每进程独立实例，天然满足「窗口本地、不与主窗口共享」，无需给 CompanionPanel 加 tab/onTabChange 可控 props；主窗口行为零改动（只加了可选 `full` prop，默认 false）
	- CompanionPanel 新增可选 `full` prop：独立窗口模式下 aside 改 flex-1 占满容器、隐藏左缘拖拽把手、忽略折叠/宽度记忆（inline width 不清除会留白半窗，面板拖宽语义在窗口内也无意义）；默认 false 主窗口字节级不变
	- 窗口状态存储：勘查无既有窗口状态机制（全项目 grep 无 getBounds 持久化），新建 `window-state-service.ts` 通用小工具（`.dogear/window-state.json` 按 key 存 bounds，safe-json 原子写），当前 key `workbench-window`；moved/resized 500ms 防抖 + close 立即补写；最大化/最小化/全屏态不写；创建时 screen.getDisplayMatching 与 workArea 交叠 <60px 则 center() 兜底
	- 终端默认固定的会话取 conversations[0]（后端按 updatedAt 倒序）= 最近活跃会话；窗口无绑定会话 id（路由无参数），每次打开重新钉一次
	- 话题 tab 的 groupId 跟随终端钉住的会话（非 null 空态）：工作台窗口的「当前会话」锚点即终端固定目标，盯子会话时话题 tab 同步显示该会话话题背景/共享区
	- 窗口样式走数据中心模式（原生标题栏，title「伴随工作台」），非 session-window 的 hidden overlay 模式——页面无自定义 header，无需处理拖拽区
	- header 入口按钮 label「工作台」+ PictureInPicture2 图标，直接调 client.openWorkbenchWindow()（不经内嵌中转）
- 改动文件清单：
	- `electron/main/services/window-state-service.ts`（新建）
	- `electron/main/index.ts`（workbenchWindow 模块变量 + createWorkbenchWindow + closeAllChildWindows 纳入）
	- `electron/main/tipc/windows.ts`（openWorkbenchWindow 路由）
	- `app/workbench-window/page.tsx`（新建）
	- `src/App.tsx`（/workbench-window 路由）
	- `components/companion/CompanionPanel.tsx`（可选 full prop）
	- `app/page.tsx`（header 工作台按钮）
	- `docs/codebase-map.md`（补 companion/terminal-stream/terminal-store/window-state-service/workbench-window 条目，windows.ts 与 renderer-handlers 行更新）

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 step4-delivery.md
- 下个 step 该从哪里继续：一期四步全部完成；后续若做「主窗口活动会话跨窗跟随」需主进程新增活动会话广播机制（当前跨窗不可得是跟随模式在工作台窗口无语义的根因）
- 待办或已知限制：
	- 真机运行时验证项未跑（需 `bun run dev` 人工）：单例 focus、位置记忆关闭重开保持、屏幕断开重连不飞出、四 tab 数据正常、终端固定会话流与主窗口内嵌一致、双屏双会话互不干扰、关窗重开缓冲历史仍在
	- 应用退出时 close 事件的补写落盘是 fire-and-forget，极端情况下可能丢失最后一次移动的 bounds（下次打开回到更早位置）
	- 工作台窗口内「跟随模式」（用户手动取消固定）无语义（activeTabId 恒空），显示「打开会话后查看命令执行」空态，重新点固定按钮也无目标可钉（需重开窗口恢复默认固定）
