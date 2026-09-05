# 浏览器三期 P1（扩展只读工具链 + 域名授权）设计

**日期**：2026-09-05
**上游**：browser-phase3-kickoff.md 路线图 P1；P0 已于 0.1.101 发布验收（browser-extension-p0/plan.md）；现状摸底报告：会话组共享区 browser-p1-context-survey.md（关键结论已吸收进本文，行号引用以报告为准）
**范围拍板**：A（标准 P1：observe/click/fill/readText + 域名授权）+ B（浏览器子会话文章入库工具，验收暴露的断链）

## 背景

P0 打通了「扩展 → NM → 主进程」单向快照链路。P1 把它升级为双向命令通道：agent 能在**用户真实浏览器**（真人登录态、真人指纹）的已授权页面上观察和交互，这是 P2 小红书只读工作流的地基。同时补上 0.1.101 真机验收暴露的断链——浏览器子会话读到全文却无法入库。

## 目标

1. 帧协议 v2：请求-响应式命令通道（主进程 ↔ 扩展），带竞态校验与版本协商
2. 域名级持久授权：optional_host_permissions + popup 手势授权 + 设置页管理撤销
3. 扩展侧四个工具：observe / click / fill / read_text，与一期受控浏览器同构（同一套 ref 语义与结果格式）
4. 风险护栏：password 拒填、提交类 click 拦截、动作流全记录
5. B 项：`dogear__browser__save_article` 工具（复用 saveArticleFromScript），浏览器子会话闭环「读 → 存」

## 架构

### 1. 帧协议 v2（nm-protocol 两份实现同步扩）

现有 6 种帧不动，新增 2 种 + 1 字段：

| 方向 | type | 字段 |
|------|------|------|
| 扩展→主 | `hello`（改） | + `protocolVersion: 2` |
| 主→扩展 | `command` | `requestId, tabId, url, kind, params` |
| 扩展→主 | `command_result` | `requestId, ok, data?, error?, errorCode?` |

- `kind` 枚举：`'observe' | 'click' | 'fill' | 'read_text'`（P2 再扩）
- gateway 收到 `protocolVersion < 2` 的 hello：照常建连与快照，但 `sendExtensionCommand` 一律快速失败「扩展版本过旧，请重载扩展」——旧扩展静默失联优于静默丢命令
- 帧格式（4B LE 长度前缀 + UTF-8 JSON）与 64MB 上限不变

### 2. gateway 命令通道（browser-gateway.ts 增量扩展）

- 新增导出 `sendExtensionCommand(kind, params, timeoutMs=30000): Promise<CommandResult>`：
  - `activeSocket` 为空 → 立即 reject `{errorCode: 'not_connected'}`
  - 生成 `requestId`（自增 + 时间戳），写 command 帧，登记 pending map `{requestId → {resolve, reject, timer}}`
  - 超时 30s（对齐一期单步超时）自动 reject `{errorCode: 'timeout'}` 并清理
- `handleFrame` 加 `command_result` 分支：按 requestId 命中 pending → resolve/reject → 清 timer；未知 requestId 记日志忽略（迟到结果）
- 连接断开（handleDisconnect）：清空全部 pending 并 reject `{errorCode: 'disconnected'}`

### 3. 扩展侧执行模型（每命令 executeScript，无常驻 content script）

- SW 收 command → 校验 `tabId` 与连接 tabId 一致（不一致拒执行回 `stale_tab`，防旧连接幽灵命令）→ 校验当前 tab url 与命令 `url` 前缀一致（页面已导航 → `navigated_away`）→ `chrome.scripting.executeScript` 注入对应纯 DOM 函数 → 回推 command_result
- **ref 自持**：observe 时给元素打 `data-dogear-ref="eN"` 属性（页面 DOM 自持，SW 无状态、被杀不丢）；click/fill 按属性选择器定位；页面导航/DOM 重建后找不到 → `ref_expired`，错误文案引导重新 observe（一期 agent 已适应）
- 一期 observeFn/statsFn 等零依赖纯 DOM 函数平移进 `extension/src/`（不共享文件，语义一致，纪律同帧协议）
- tab 已关闭（executeScript 抛 no tab）→ `tab_closed`
- 域名未授权（scripting 注入失败/权限拒绝）→ `permission_denied`
- **fill 事件派发**：纯 executeScript 环境无 patchright 的事件派发，set value 后手工 `dispatchEvent(new Event('input', {bubbles: true}))`（React 受控组件必需）+ value 回读比对，不一致 → `value_mismatch`
- observe/read_text 成功后 SW 顺带回推一次 `tab_snapshot`（复用 P0 sendTabSnapshot），设置页状态行随命令链路自然刷新——不做导航自动监听（YAGNI，P2 需要再加）

### 4. 域名授权模型

- manifest：`optional_host_permissions: ["<all_urls>"]`（Chrome 商店审核友好的申请形态），保持无 `tabs`、无静态 host_permissions
- popup 新增「授权此域名」按钮（用户手势上下文中调 `chrome.permissions.request({origins: [...]})`，粒度 = 当前页 origin），已授权显示「已授权 ✓ / 撤销」
- 授权状态变化（grant/revoke）→ SW 推 `permission_changed` 帧或并入 tab_snapshot 扩展字段 → gateway 状态含 `authorizedOrigins: string[]`，设置页状态行展示
- 设置页「受控浏览器」小节加授权域名列表（chip 样式 + 撤销按钮）——数据只读展示，撤销动作引导去 popup（permissions API 必须用户手势，主进程无法代办）
- gateway 侧命令前置校验：命令 url 的 origin 不在 authorizedOrigins → 快速失败 `permission_denied`（纵深防御，扩展侧二次校验）

### 5. 风险护栏（硬编码，不可配置）

- fill：目标元素 `type === 'password'`（含祖先 form 内关联 password）→ `guard_password`，「密码类输入本阶段禁止」
- click：提交类启发式拦截 → `guard_submit`，「提交类操作属 L2+，本阶段未开放」：
  - `button[type=submit]`、`input[type=submit|image]`
  - form 内无 type 的 `<button>`（默认行为即 submit）
  - 误伤容忍：宁可拦错放行错——拦截文案引导用户手动完成提交
- 全量动作流：扩展命令记录进 browser-action-stream（`BrowserActionEvent.source` 新增 `'extension'` 值区分后端，kind 沿用 'agent'），伴随面板可见可审计

### 6. 工具层（同构契约 + 新能力域）

- observe 契约（两后端统一）：`{total, regionCounts, elements: [{ref, tag, role, text(80字), hint}]}`，上限 120 条，`region`（top/middle/bottom）+ `text_filter` 过滤；**不做 a11y 树**（后置 P3，扁平列表契约已验证）
- 新工具组 `registerToolGroup({server: 'dogear-extension', ...})`，四个工具 zod schema 对齐一期同名工具（ref/value/region/text_filter 同名同义）：
  - `dogear__extension__observe_page {region?, text_filter?}`
  - `dogear__extension__click {ref}`
  - `dogear__extension__fill {ref, value}`
  - `dogear__extension__read_text {ref?}`
- 工具描述明示：「作用于用户真实浏览器的已连接标签页，仅限已授权域名」；错误统一 isError 文案（中文，含 errorCode 语义）
- 能力域：`SubAgentEnabledAbilities` 新增 `extension?: boolean`（双份镜像 + normalize + SubAgentTab 计数）；「浏览器解析」Profile 模板 `enabledAbilities` 补 `extension: true`
- B 项：`dogear__browser__save_article {title, url, content, author?, siteName?, excerpt?}` 挂 dogear-browser 组（输入天然来自 browser 工具输出，浏览器解析 Profile 已开 browser，不动 article 能力域）；内部直调 `saveArticleFromScript`，返回入库 id 与字数

### 7. 排除项（本期不做）

自动重连（alarms 保活）、多 tab/多会话、独立 host exe、a11y 树、L2+ 写入、扩展商店上架、导航自动快照同步（用命令后回推代替）

## 模块边界

| 模块 | 文件 |
|------|------|
| 帧协议 | `extension/src/nm-protocol.js`、`electron/main/services/browser/nm-protocol.ts` |
| 扩展 | `extension/src/background.js`（命令分发/护栏/竞态校验）、`extension/src/dom-actions.js`（新，observe/click/fill/readText 纯函数）、`extension/popup.{html,js}`（授权 UI）、`extension/manifest.json` |
| gateway | `electron/main/services/browser/browser-gateway.ts`（pending map/命令/授权状态） |
| tipc | `electron/main/tipc/browser.ts`（命令桥接模式复制 registerExtensionCommandBridge）、`tipc/renderer-handlers.ts`（类型流转） |
| 工具层 | `electron/main/agents/tools/extension-tools.ts`（新）、`browser-tools.ts`（+save_article） |
| 设置/Profile | `types/settings.ts` + `electron/main/services/settings-types.ts`（extension 字段）、`settings-service.ts` normalize、`app/settings/page.tsx` + `ExtensionStatusLine.tsx`（授权列表）、SubAgentTab |
| 动作流 | `browser-action-stream.ts`（source 枚举） |

## 数据流（observe 为例）

agent 调 `dogear__extension__observe_page` → extension-tools（校验扩展已连接）→ `sendExtensionCommand('observe', {region, text_filter})` → gateway 写 command 帧 → NM pipe → bridge worker → SW 校验 tabId/url → executeScript 注入 observeFn（打 ref 属性）→ 结果回 command_result → gateway pending 命中 resolve → 工具层格式化返回 agent；SW 同时回推 tab_snapshot 更新状态行

## 错误处理（errorCode 全集）

`not_connected`（扩展未连接）/ `stale_protocol`（扩展版本旧）/ `timeout`（30s）/ `disconnected`（执行中断连）/ `stale_tab`（tabId 不符）/ `navigated_away`（url 前缀不符）/ `tab_closed` / `permission_denied`（域名未授权，含纵深防御）/ `ref_expired`（引导重新 observe）/ `value_mismatch`（fill 回读不符）/ `guard_password` / `guard_submit` —— 全部转 isError 中文文案，不抛异常

## 未决问题（实施时定，不阻塞计划）

1. guard_submit 启发式的具体选择器组（实施时按 4-5 个真实站点校准误伤率）
2. popup 授权按钮与「连接此标签页」的交互顺序（连接前/后均可授权，实施时按 UI 自然度定）
3. authorizedOrigins 持久化位置（SW chrome.storage vs gateway 内存态随连接重建，倾向前者——扩展侧重启不丢）
4. Edge/Chrome permissions.request 的 UI 差异验收点

## 验收标准

1. headful 真实链路（扩展 P0 同款 CDP 辅助 + 人工手势）：授权域名 → observe → click（导航类）→ 跳转后 navigate 检测 → read_text 全链路 PASS；未授权域名快速失败；password/submit 护栏触发
2. 断连/换 tab/关闭 tab/页面自行导航四类竞态各有一用例且错误分类正确
3. 「浏览器解析」子会话实测「搜索 → readText → save_article 入库」闭环（B 项验收）
4. 回归：lint 0 errors、build:electron 通过、tsc noEmit 通过、browser-eval 管线 20/20、P0 状态行行为不回归（旧快照链路无变化）
