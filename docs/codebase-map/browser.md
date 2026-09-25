# 浏览器域（browser）

内嵌浏览器（WebContentsView 后台 tab）+ 浏览器扩展（用户真实浏览器）双通道、site-knowledge 站点档案、联网搜索快档。UI 在伴随面板「浏览器」tab，工具分 dogear__browser__* 与 dogear__extension__* 两组。

## 内嵌宿主（services/browser/embedded/）

- `embedded-browser-manager.ts` — 内嵌 tab 单例：openTab/closeTab/retain/release（引用计数+TTL 兜底）、attachToWindow 呈现、agent tab 与用户呈现 tab 分离、PAC 代理+诚实 UA、白嫖框哨兵 workspace（WEBAI_WORKSPACE_ID，listTabs 对外隐藏）
- `types.ts` — Tab 模型 + 页面 8 态枚举（loading/ready/login_required/verification_required/awaiting_human/rate_limited/changed_layout/crashed）
- `tab-events.ts` — 导航事件 → generation 递增 + 基础状态流转
- `page-state.ts` — resolvePageState 状态机唯一入口（URL 正则+关键词判定登录墙/人机验证/限流）+ pageStateHint
- `cdp-session.ts` / `ax-tree.ts` / `ax-observe.ts` — 每 tab CDP 会话复用 / 无障碍语义树观察（ref = backendNodeId@generation）
- `actions.ts` — clickTab/fillTab + guard_password/guard_submit 语义拦截
- `navigate.ts` / `wait-for.ts` / `press.ts` / `scroll.ts` / `read-state.ts` — 导航/条件轮询等待/按键/滚动/`__INITIAL_STATE__` 读取
- `profile.ts` — 全局唯一分区常量 `GLOBAL_BROWSER_PARTITION`（persist:dogear-browser，agent 与白嫖框共用登录态）
- `migrate-legacy-partitions.ts` — 启动早期旧工作区分区 cookie 一次性合并进全局分区（marker 两段式删目录防 Windows 句柄占用，失败不阻塞启动）
- `webai.ts` — 网页 AI 白嫖框单例 tab：source 'user-connected' + holderId 'webai' 免 TTL 回收，bounds/overlay 上报驱动 attach/detach，close 只销毁 tab 保留分区登录态
- `ua.ts` / `proxy.ts` — 诚实 UA / 按域 PAC 代理（settings.browserProxyServer）
- `fetch-page.ts` — 抓取原语（loadFetchTab/evalInTab/promoteFetchTab 失败页切给 agent）+ 验证页呈现兜底
- `presentation.ts` — 呈现服务：companion 页面视图区 bounds 表、presentTab（工具与渲染层共用后端）、setOverlayHidden 弹层遮挡临时隐藏（只切可见性不动 retain）、followAgentNavigation 智能跟随（agent 开新 tab 时空呈现/旧 agent tab 窗口自动跟过去）
- `dev-selftest.ts` — `DOGEAR_EMBEDDED_BROWSER_SELFTEST=1` 门控运行时自测

## 扩展通道（services/browser/）

- `nm-bridge.ts` — NM host worker 入口：stdio ↔ named pipe 双向桥接（打包产物 `resources/nm-host/nm-bridge-worker.cjs`）
- `nm-protocol.ts` — 帧协议（4B LE 长度+JSON、ProtocolVersion 协商、CommandKind/CommandErrorCode）
- `browser-gateway.ts` — NM pipe server 单例：单连接模型、pending map 命令生命周期、ExtensionStatus 广播、sendExtensionCommand 前置校验链（not_connected→stale_protocol→permission_denied→navigate 目标域）
- `human-intervention.ts` — awaiting_human 产品化（内存态不持久化）：raise/resolve/自动解除 + 全量广播
- `browser-task-meta.ts` — 动作流任务元数据（kind: article|agent）
- `browser-action-stream.ts` — 浏览器动作事件汇总出口（供伴随面板动作流消费；launched 经 provider 注入保持 node 环境可 smoke）
- `extension-ownership.ts` — 扩展通道会话独占（纯逻辑零 IO：同 owner 续期、空闲 10min 自动释放、busy 不排队直接拒）
- `site-policy.ts` — 站点策略（内置小红书：随机延迟/单会话预算/风控关键词）+ controlledBrowserBlock 受控通道封禁扩展绑定站点
- `site-knowledge-service.ts` — 站点档案存储（`.dogear/site-knowledge/{domain}.md` 两区：正式地图+探索发现），normalizeDomain/appendSiteFinding

## 浏览器数据管理（services/browser/）

- `browser-data-service.ts` — 全局分区数据管理：cookie 按注册域聚合（多段后缀归一+登录态启发）+ 分区目录/缓存大小概览 + 按域登出/清数据 + 清缓存/全部清除（clearStorageData 逐 origin 循环）
- `tipc/browser-data.ts` — 数据中心浏览器数据五路由（list/logout/clear domain/cache/clear all）
- UI 面板 `app/data-center/browser-data-panel.tsx` → 见 data-center.md

## 搜索与阅读

- `browser-search-service.ts` — searchWeb 引擎编排：降级链 Google→DDG(html)→Bing；site 参数站内引擎失败自动降级 site: 通用链+域名过滤；不抛错误归类
- `serp-parsers.ts` — 三引擎 SERP 解析器 + reddit/zhihu 站内解析 + 知乎 __INITIAL_STATE__ 启发式提取
- `site-search.ts` — 站内搜索引擎配置与执行（reddit=old.reddit / zhihu 搜索页；CDP Runtime.evaluate 直连主世界）
- `browser-article-service.ts` — readArticleWithBrowser：渲染等待+展开全文+翻页拼接+DOM 登录墙检测（need_login 保留 tab 并呈现+登录态持久化）
- `bigmodel-mcp-service.ts` — GLM MCP 轻量 client（手写 JSON-RPC over HTTP，会话失效重置重试）

## Agent 工具（agents/tools/）

- `browser-tools.ts` — dogear__browser__* 组：readArticle/search（可选 site 站内）/present（页面即产物）/save_article/close/screenshot + 原子探索 9 工具（navigate/observe_page/find/click/fill/scroll/read_text/read_state/wait_for）
- `extension-tools.ts` — dogear__extension__* 组：navigate/observe_page/click/fill/read_text/read_state + 独占 gate + 站点策略门控链（独占→风控前置→预算→随机延迟→命令→风控扫描→计数）
- `extension-site-tools.ts` — site_knowledge/site_finding（只读写本地站点档案，不过 policyGate）+ siteKnowledgePointer 档案指针
- `web-mcp-tools.ts` — bigmodel__webSearch/webReader 快档（能力页「联网搜索」包；fallbackHint 按会话有无 browser 工具三态生成指引）

## UI 与状态

- `stores/browser-store.ts` — 动作流事件缓冲（cap 500 seq 竞态合并）+ 页面视图区状态 + 等待人工 pending 列表
- `components/companion/BrowserPanel.tsx` — 浏览器 tab 容器：状态行+等待人工卡片区+页面视图区+动作流分组卡片流
- `components/companion/BrowserPageView.tsx` — 页面视图区：地址栏常驻（无呈现时回车走 presentEmbeddedTab url 分支直开）+ 占位容器 bounds 上报（卸载上报 null 触发 detach）+ MutationObserver 检测 Radix 弹层遮挡上报隐藏
- `components/companion/BrowserInterventions.tsx` — 等待人工卡片（resolveHumanIntervention）
- `app/settings/ExtensionStatusLine.tsx` — 设置页扩展状态行（条目见 settings.md，ExtensionStatus 类型源在本域 gateway）

## 浏览器扩展（extension/，独立交付物，不进 tsc/eslint 工程）

- `manifest.json` — MV3：无静态 host_permissions，optional_host_permissions+popup 手势按 origin 授权；key 固定扩展 ID
- `popup.{html,js}` — 连接/授权 UI（originFromUrl 白名单、授权/撤销在 click 手势内直调）
- `src/background.js` — SW 命令分发中枢：handleCommand 分发、executeScriptWithTimeout 8s 竞赛兑底（点击导航销毁注入上下文永不 settle）、resolveLostClickResult URL 检测、permission_state 多触发源推送
- `src/dom-actions.js` — 四 DOM 注入纯函数（observe 打 ref/click guard_submit/fill guard_password+native setter/readText 8000 截断）
- `src/nm-protocol.js` — 帧编解码器
- 授权链路：popup 手势 request → SW getAll 归一化 → permission_state 帧 → gateway authorizedOrigins 纵深防御 → 设置页只读 chip

## 注意

- ExtensionStatus 类型唯一源是 `browser-gateway.ts`，渲染层 import type 自动流转
- `nm-protocol` 与 `extension/src/nm-protocol.js` 是语义一致的独立副本，不共享文件；`page-state` 判定规则与 `extension/src/page-state.js` 双侧同步，改一边必改另一边
- 受控浏览器通道封禁扩展绑定站点（controlledBrowserBlock），双出路文案按有无 extension 工具分流
- 扩展通道独占 busy 直接拒绝不排队；site_knowledge/site_finding 无页面交互不过策略门控
- 授权列表 gateway 重连即重置，依赖扩展重推（storage.local 兜底）
- read_state 用 CDP `Runtime.evaluate` 直连主世界（隔离世界读不到页面 window 全局）
- 网页 AI 白嫖框 tab 与 agent 内嵌 tab 共用全局分区（persist:dogear-browser）；数据中心清除浏览器数据会连带 agent 登录态（面板确认框含 agent 风险提示）

## 数据流

- 扩展命令链路：agent 调 dogear__extension__* → 独占 gate → 站点策略门控（命中域）→ sendExtensionCommand → gateway 前置校验 → command 帧（NM pipe）→ nm-bridge worker → 扩展 SW handleCommand（navigate 自动 bumpGeneration、ref 代际校验）→ command_result → pending map resolve → 工具层中文文案；observe/read_text/read_state 成功后 SW 回推 tab_snapshot 驱动设置页状态行刷新；断连 resetChannel 清零独占
- 内嵌阅读：readArticle → fetch/agent tab 加载 → 翻页拼接 → 登录墙则 raise 等待人工+呈现到页面视图 → 用户完成后继续
