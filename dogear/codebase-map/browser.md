# 浏览器域（browser）

浏览器能力收敛为用户真实浏览器的扩展通道与纯 HTTP 联网搜索：扩展负责登录态页面的观察和操作，搜索负责发现公开资料（网页 AI 配置面已下线，仅存扩展右键「发送到 Dogear」回流通道）。等待人工以会话消息流交互卡为主（InterventionCard），应用级模态（HumanInterventionDialog）兜底，另有提示音/焦点跳转/系统通知打扰三件套；站点档案和屏蔽名单仍由工具层消费，但不再提供数据中心管理面板。

## 扩展通道（services/browser/）

- `nm-bridge.ts` — NM host worker 入口：stdio ↔ 网关双向桥接（win32 named pipe / darwin unix socket，`--nm-gateway=` argv 寻址；打包产物 `resources/nm-host/nm-bridge-worker.cjs`）
- `nm-host-register.ts` — darwin 运行时 NM 注册：渲染 nm-host.sh 到 userData + 写 Chrome/Edge NativeMessagingHosts manifest（allowed_origins 单一来源读 build-nm-manifest 产物；设置页注册/注销按钮，win32 走 NSIS 安装器不经此链路）
- `nm-protocol.ts` — 帧协议（4B LE 长度+JSON、ProtocolVersion 协商、CommandKind/CommandErrorCode）
- `browser-gateway.ts` — NM pipe server 单例：单连接模型、pending map 命令生命周期、ExtensionStatus 广播、sendExtensionCommand 前置校验链（not_connected→stale_protocol→permission_denied→navigate 目标域）
- `gateway-tab-state.ts` — 扩展焦点标签页快照与 Dogear 分组标签页状态
- `human-intervention.ts` — 等待人工状态：raise/resolve/自动解除 + 全量广播；无人值守（ai.unattended）开启时 raise 即跳过（不挂卡，unattendedSkips 预置结果，等待方 wait 时取走，outcome='unattended'），开关打开瞬间 resolveAllPendingInterventionsUnattended 批量解除挂起卡，跳过事件直连推送飞书
- `browser-task-meta.ts` — 动作流任务元数据（kind: article|agent）
- `browser-action-stream.ts` — 浏览器动作事件环形缓冲（cap 500）：扩展工具 emitAction 写入；UI 消费已随浏览器伴随面板退役，保留写入作未来聚合呈现数据源
- `intervention-notify.ts` — 等待人工打扰三件套：提示音 + 焦点跳转（interventionFocusJump 开关）+ 后台系统通知
- `extension-ownership.ts` — 扩展通道会话独占（同 owner 续期、空闲 10min 自动释放、busy 不排队直接拒）；会话销毁时由 `session-tab-cleanup` 主动 releaseChannel
- `extension-wait-gate.ts` — 扩展断连时按任务浏览器配置拉起浏览器并等待连接
- `browser-launcher.ts` — 任务浏览器拉起服务（Chrome/Edge 探测、profile 解析、按配置启动；extension-wait-gate 与设置页 TaskBrowserSection 底层）
- `extension-handoff.ts` — 右键「发送到 Dogear」的焦点会话路由与输入草稿生成
- `session-tab-cleanup.ts` — 会话销毁收尾：仅通道归属者关闭 Dogear 组内未移交 tab（`close_group_tabs`，豁免移交 tab）并释放独占
- `site-policy.ts` — 站点策略（内置小红书随机延迟、会话预算、风控关键词与操作指引）+ navigateGate/policyGate 门控入口
- `site-knowledge-service.ts` — 站点档案存储（`.dogear/site-knowledge/{domain}.md` 两区：正式地图+探索发现）+ `normalizeDomain` / `registeredDomain` / `appendSiteFinding`
- `tipc/assets.ts` — 习得资产路由（listPlatformScripts/readPlatformScript/listSiteKnowledge/readSiteKnowledge；数据中心「习得资产」分区消费，原 browser-data 的站点档案读取职责移到这里）
- `browser-blocklist-service.ts` — 全局屏蔽站点名单，登录墙卡和搜索结果过滤共用
- `injection-scan.ts` — 页面文本指令注入模式扫描，读内容类工具共用

## 搜索与文章

- `browser-search-service.ts` — `searchWeb` 纯 HTTP 搜索编排：代理可达时 Google→DDG(html)→Bing，无代理时 Bing；site 参数先走站内搜索，失败自动降级为 `site:` 通用搜索；SERP 结构化类型在 `browser-search-types.ts`
- `serp-http.ts` — 独立 Electron session 的 HTTP SERP 抓取、按设置应用代理、超时与结构化 `SerpFetchError`
- `serp-parsers.ts` — Google/DDG/Bing DOM 解析器 + Reddit/知乎站内结果解析
- `site-search.ts` — Reddit、知乎站内搜索配置与纯 HTTP 解析
- 文章 URL 解析链在 `tipc/article.ts`：平台脚本 → Readability → AI 任务兜底；抓取失败直接返回结构化错误，不再有浏览器渲染兜底或登录墙 stub

## Agent 工具（agents/tools/）
- `extension-tools.ts` — `dogear__extension__*` 页面 11 工具聚合入口：构建 ToolContext 后分发三域 `extension-nav-tools.ts`（navigate/readArticle/screenshot）、`extension-read-tools.ts`（observe_page/find/read_text/read_state）、`extension-act-tools.ts`（click/fill/scroll/wait_for），组内顺序经解构展开保持稳定；闭包前置（meta/emit/独占闸/登录墙闸）在 `extension-tool-context.ts`；独占、站点策略、登录墙、内容预算与节奏控制由公共命令层接入
- `extension-tab-tools.ts` — `open_tab` / `close_tab` / `list_tabs`：Dogear 分组、16 页上限与焦点 tab 管理
- `extension-command-shared.ts` — 扩展命令调用、动作流写入、操作节奏与统一错误文案
- `extension-login-wall.ts` — 页面命中登录墙/验证墙时抛出等待人工卡；用户跳过或超时后返回换源指引
- `extension-observe-format.ts` — 扩展 payload 的类型收敛、观察格式化与 pageState 尾注
- `extension-site-tools.ts` — `site_knowledge` / `site_finding` / `site_policy`：档案与访问策略读写，不触碰页面也不过 policyGate
- `extension-web-tools.ts` — `dogear__extension__search`（纯 HTTP 搜索，不占扩展独占）与 `dogear__extension__save_article`（将扩展 readArticle 内容写入工作区文章库）；meta/emit 闭包经 `extension-tool-context.ts` 复用
- `web-mcp-tools.ts` — `bigmodel__webSearch` / `bigmodel__webReader` 快档；主会话在需要登录、交互或深读时引导派「浏览器解析」子会话

## UI 与状态

- `stores/browser-store.ts` — 等待人工 pending 列表（humanInterventionChanged 订阅 + 初始拉取），供 HumanInterventionDialog 消费
- `components/agent-chat/InterventionCard.tsx` — 会话消息流内等待人工交互卡（reason 图标/按钮组/解除态文案），前端本地块不落库
- `components/HumanInterventionDialog.tsx` — 应用级模态兑底（extension_wait 跳过，ESC/遮罩禁关防误触），挂 App 根
- `app/settings/ExtensionStatusLine.tsx` — 设置页扩展状态与安装引导（路径由 `getExtensionDirPath` IPC 提供，返回 `{ path, source, outdated }`：custom 副本优先生效）；安装引导卡与已连接态都提供自定义副本动作条 ExtensionCustomBar（builtin→「复制到自定义」/custom→「恢复默认」+ 落后时「用内置版覆盖副本」，确认框走 showConfirm）

## 浏览器扩展（extension/，随应用打包进 extraResources resources/extension，独立交付物不进 tsc/eslint 工程）

- 打包分发：electron-builder.yml 将 `extension/` 放入 `resources/extension`；设置页安装引导经 `tipc/browser.ts getExtensionDirPath` 定位（prod=process.resourcesPath/extension，dev=项目根源码目录），custom 副本（`.dogear/custom/browser-extensions/extension`）存在时优先生效；副本动线（复制/覆盖/恢复默认）实现在 `services/extension-custom-service.ts`（版本比对读两侧 manifest.json version，副本缺失/不可读视为落后），IPC 为 `getExtensionDirPath` / `copyExtensionToCustom` / `resetExtensionCustom`，恢复默认 = 删副本回内置；副本随 custom 同步，内置目录不同步
- `manifest.json` — MV3：无静态 host_permissions，optional_host_permissions + popup 手势按 origin 授权；key 固定扩展 ID
- `popup.{html,js}` — 连接/授权 UI（originFromUrl 白名单、授权/撤销在 click 手势内直调）
- `src/background.js` — SW 命令分发、页面移交（确保 tab 入 Dogear 组并设为操作焦点）、permission_state 推送
- `src/page-state.js` — 扩展侧 URL/页面文本判定登录墙、人机验证和限流状态
- `src/dom-actions.js` — DOM 注入：observe 打 ref、click guard_submit、fill guard_password、readText 截断
- `src/wait-actions.js` — visible/hidden/text_contains 条件轮询
- `src/find-actions.js` / `observe-actions.js` / `click-watch.js` / `connect-autoretry.js` / `intervention-watch.js` / `nav-tracker.js` — find 命令 / observe 实现 / 点击守卫 / SW 断线自动重连 / watch_intervention 自动解除 / 导航跟踪
- `src/content-extract.js` — readText 与文章 HTML 提取；Markdown 解析在主进程完成
- `src/tab-commands.js` — Dogear 分组 tab 管理与收尾清理
- `src/agent-window.js` — agent 专属窗口解析与生命周期维护

## 注意

- ExtensionStatus 类型唯一源是 `browser-gateway.ts`，渲染层 import type 自动流转
- `nm-protocol.ts` 与 `extension/src/nm-protocol.js` 是语义一致的独立副本，不共享文件
- 扩展通道 busy 直接拒绝不排队；site_knowledge/site_finding/site_policy 无页面交互不过策略门控
- 授权列表 gateway 重连即重置，依赖扩展从 storage.local 重推
- `read_state` 由扩展在页面主世界读取；登录态、人工操作与页面生命周期均属于用户真实浏览器

## 数据流

- 扩展命令：agent 调 `dogear__extension__*` → 独占 gate → 站点策略门控（命中域）→ sendExtensionCommand → gateway 前置校验 → command 帧（NM pipe）→ nm-bridge worker → 扩展 SW → command_result → 工具层中文结果；observe/read_text/read_state 成功后 SW 回推 tab_snapshot；断连 resetChannel 清零独占
- 登录墙：open_tab/navigate/observe/find/read_* 命中 pageState → `loginWallGate` → 等待人工卡 → 扩展 watch_intervention 自动解除或用户按钮处理 → 重新观察后继续
- 页面移交：扩展右键 → tab 入 Dogear 组并设焦点 → page_handoff 帧（URL+选中文字）→ 主进程路由目标会话 → 输入草稿 → agent 直接 observe_page
- 搜索：agent 调 `dogear__extension__search` → 主进程 HTTP 抓 SERP → linkedom 结构化解析 → 引擎降级与屏蔽域过滤 → 结果；失败时指引导航 Bing 页面由扩展工具继续读取
