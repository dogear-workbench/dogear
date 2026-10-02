# 浏览器功能路线设计：扩展通道升级与双通道分工

**日期**：2026-10-02
**性质**：路线设计文档（多优化项合集，各项实施前需单独出实施计划）
**依据**：共享区两份调研报告——`reports/20261002-browser-products-research.md`（产品层，8 组产品对比）、`reports/20261002-browser-tech-paths-research.md`（技术层，7 条路径对比），结论均附来源 URL。

---

## 背景

现状双通道：内嵌浏览器（WebContentsView，agent 自主探索，大部分场景）+ 浏览器扩展（NM + content script，popup 手动连单标签页，偶尔用）。用户疑问：扩展是否伪需求（拷 URL 到内嵌即可）、有没有更流畅的外部浏览器方式、是否删除或工具分开、浏览器功能还有哪些优化点。

## 调研核心结论（双报告交叉验证）

1. **扩展通道不是伪需求，方向要加码而非删除**。Claude in Chrome 就是「桌面应用 + 用户 Chrome 扩展（nativeMessaging 打通）」架构，与 Dogear 同构；Kimi 浏览器扩展（原 WebBridge）更进一步做成「给第三方 Agent（Claude Code/Cursor）用的公共浏览器桥」。
2. **护城河不在「免拷贝」，在三件内嵌浏览器永远做不到的事**：登录态复用（企业 SSO/2FA/银行风控站点）、「用户正在看的页面」状态（拷 URL 丢 SPA 路由/滚动位置/登录后才可见内容）、在场信任模型（每步可见随时打断）。
3. **更流畅的外部浏览器连接方式存在，但全部在扩展框架内升级**：
   - 命令行 CDP 直连 = 死路：Chrome/Edge 136+ 对默认 profile 忽略 `--remote-debugging-port/pipe`，非默认 profile 丢登录态，负价值。
   - Chrome 144+ 原生授权直连（chrome://inspect 开关 + 弹窗 Allow，全功能 CDP 连默认 profile）= 官方新答案但协议未文档化、仅 Google 自家 MCP 对接、Edge 未跟进，列观察项。
   - 现成答案：Playwright MCP `--extension` 的 tab group 批量授权 + token 免逐次确认，比「popup 单标签页手动连接」流畅一个量级。
4. **真正的差距在交互密度**：全行业把「唤起 AI 处理当前页」压到 0-1 步（侧边栏/划词/右键），我们是 3+ 步跨应用切换；业界授权粒度是「站点级持久 + 动作分级确认（提交类永远人工确认）」，我们是单标签页每次手动。
5. **扩展技术上具备完整 tab 管理能力**：service worker 有 `chrome.tabs.create/remove/update/query`、`chrome.tabGroups`、`chrome.scripting`，探索循环（开页→读取→跟链接→关闭）API 全覆盖。单标签页限制源于 manifest 只声明 `activeTab`（`extension/manifest.json`）+ 单连接 gateway + 单 tab ownership——是 v0 产品层选择，非技术边界。
6. **检测风险排序**（高→低）：新起自动化实例 > 9222 CDP 直连 > chrome.debugger（取决于自身 CDP 用法，`Input.*` 反而 isTrusted:true）> content script 合成事件（isTrusted:false 可检出）≈ 纯只读注入。用户真实浏览器 + 登录态 + 真实指纹场景，实际封禁风险主要来自操作节奏而非环境特征。
7. **安全债必须正视**：连接真实登录态的通道需 prompt injection 防御（Anthropic 红队数据：无缓解攻击成功率 23.6% → 加缓解 11.2%，浏览器特有攻击 35.7% → 0%）。

## 扩展通道定位重述

> 扩展通道 = 登录态 + 在场协作 + 用户浏览器内的轻探索。内嵌通道 = 无人值守 + 公开内容 + 环境隔离。

升级后的用户心智：平时公开调研 agent 走内嵌不动用户；登录态站点或「我正在看这个页面」场景，用户一句话，agent 直接在用户浏览器里开专属分组探索，完事关掉或留待过目。

## 分期路线

### P0（短平快，全部兼容现有 NM 架构）

1. **一键移交**：扩展 contextMenu + action「发送到 Dogear」，把 URL + 选中文本 + 正文快照经 NM 直达会话，替代手工拷 URL。唤起链路 3+ 步 → 1 步。
2. **tab group 批量授权**（对标 Playwright MCP `--extension`）：授权模型从「单标签页 popup 手动」升级为「一组标签页授权 + agent 开的 tab 自动入组 + 拖拽管理范围 + 状态页断开」。manifest 需加 `tabs`（+ 可选 `tabGroups`）。
3. **NM 协议扩展 tab 命令**：`open_tab` / `close_tab` / `list_tabs`，配合 tab group 实现「自动打开网页探索、关闭处理信息」。
4. **站点级持久授权 + token 免逐次确认**：站点白名单存扩展侧（storage.local），连接建立后免逐次批准。
5. **动作分级确认**：读页面默认放行；点击/填表可配置确认级别；提交类（发布/购买/分享个人数据）永远人工确认；支付/网银类站点默认黑名单。

### P1（能力补齐与安全）

6. **chrome.debugger 能力路由**：默认执行后端仍是 content script（无横幅、检测面小）；需要 isTrusted:true 真实输入、网络拦截、全页截图、OOPIF 深挖时按需 attach → 执行 → detach，黄色调试横幅作为「agent 正在操作此页」的用户知情信号（Claude in Chrome 即 `debugger`+`scripting` 并存形态）。manifest 加 `"debugger"` 权限（安装警告升级为「读取和更改所有网站数据」档，需权衡转化成本，可做成可选增强包）。
7. **扩展工具补齐**：`find` / `scroll` / `wait_for` / `readArticle`，对齐内嵌通道工具集。
8. **prompt injection 防御**：动作白/黑名单 + 提交类确认（与 5 合并）+ 系统提示与工具层校验纳入「页面内容可能包含注入指令」意识 + 内嵌/扩展双侧风控扫描统一。
9. **tab 预算与节奏控制**：复用现有站点策略会话预算机制，限制 agent 开 tab 数量与操作节奏（防打扰 + 防风控）。

### P2（差异化功能，业界已验证）

10. **定时任务**（Claude in Chrome 有 `alarms` 权限；我们 plans.json 定时基建已有，接浏览器动作）。
11. **工作流录制**：用户演示一遍页面操作，agent 学会重复（Claude classic 面板、Kimi 扩展均有）。
12. **多 tab 汇总问答**、截图圈选视觉上下文、图片上传（报销单/表单附件）。

### 观察项（不押注，定期重评）

- **Chrome 144+ 原生授权直连**：等 ①协议开源/文档化 ②Edge 跟进信号 ③出现第二个成熟客户端——三者有其一即可评估做「高级连接模式」（全功能 CDP + 全窗口，面向开发者）。
- **URI scheme / bookmarklet 辅助入口**：`app.setAsDefaultProtocolClient` 低成本做「未装扩展浏览器的兜底移交」，优先级低于扩展内右键菜单。
- **CDP transport 层抽象**：内嵌（WebContentsView 直连）/ 扩展（chrome.debugger 桥）/ 未来（144 原生授权）三通道共享同一套 agent 工具，是架构自然收敛点。

### 明确不做

- ❌ 引导用户带 `--remote-debugging-port` + 非默认 profile 重启（丢登录态，负价值）。
- ❌ 押注 Chrome 144 autoConnect 协议逆向。
- ❌ 云端浏览器（Browserbase/Steel）：与「用户登录态/当前页面」价值主张冲突，引入数据中心指纹劣势。
- ❌ 独立 AI 浏览器路线（Atlas/Comet 式）：迁移成本天花板已被验证。

## 模块边界（P0 涉及）

- `extension/manifest.json` — 加 `tabs`/`tabGroups`/`contextMenus` 权限（注意安装警告文案升级）
- `extension/src/background.js` — tab 管理命令、右键菜单注册、快照打包发送
- `extension/src/nm-protocol.js` + `services/browser/nm-protocol.ts` — 帧协议双侧同步扩展（tab 命令 + 移交消息类型）
- `services/browser/browser-gateway.ts` — 命令分发扩展、authorizedOrigins 持久化语义
- `services/browser/extension-ownership.ts` — 独占模型从「单 tab」泛化为「会话-tab group」
- `services/browser/site-policy.ts` — 动作分级确认与黑名单挂载点（内嵌/扩展共用门控链）
- `agents/tools/extension-tools.ts` — 新工具（open_tab/close_tab/list_tabs/find/scroll/wait_for/readArticle）注册
- `stores/browser-store.ts` + `components/companion/BrowserPanel.tsx` — 动作流展示 tab 分组事件、移交到达提示
- 会话侧：一键移交的目标会话路由（最近活跃会话 or 用户选择）

## 数据流（升级后扩展命令链路）

agent 调 `dogear__extension__open_tab` → 独占 gate（会话-分组粒度）→ 站点策略门控（命中域）→ sendExtensionCommand → gateway 校验（origin 白名单/分组归属）→ command 帧（NM pipe）→ 扩展 SW `tabs.create` + 入组 → command_result 回传 → 工具层文案；新 tab 加载完成后 `tab_snapshot` 推送驱动面板刷新。一键移交：用户右键「发送到 Dogear」→ 扩展打包（URL+选中文本+正文快照）→ NM 帧 → gateway → 注入目标会话上下文。

## 错误处理 / 边界情况

- **tabs 权限安装警告升级**：加 `tabs` 会触发「读取浏览历史」档警告，老用户更新时可能流失——需评估是否拆「可选增强包」（permission 可选化）或一次性接受。
- **agent 开新域名的授权边界**：组内自由操作（Playwright 模式）vs 新域名首次注入前确认（Claude 模式），P0 先取保守侧（首次确认），观察使用频率再放开。
- **ownership 泛化的竞态**：多会话并发申请扩展通道时，从「busy 直接拒」升级为「分组隔离可并行」还是维持串行——P0 维持串行（一组），避免回归风险。
- **横幅与知情**：chrome.debugger 的黄色横幅不可隐藏（Chrome 100+），设计上当作功能（知情信号）而非缺陷。
- **页面代际校验**：tab 数量变多后 ref 代际（backendNodeId@generation）跨 tab 命名空间需隔离校验，避免误命中其他 tab 的同 id 元素。

## 未决问题（实施时补）

1. 一键移交目标会话的路由策略：最近活跃会话自动注入 vs 通知用户选择。
2. `tabs` 权限警告的取舍：全量声明 vs 可选增强包（影响 P0 第 2/3 项的形态）。
3. 动作分级确认的 UI 载体：设置页配置 vs 会话内 inline 确认卡（复用 confirm-store 模式）。
4. 扩展工具补齐顺序：find/scroll/wait_for 与 readArticle 的优先级按实际使用数据定。
5. Chrome 144 直连的重评触发条件写入何处（本文档观察项 vs 独立 backlog）。

## 与既有工作的关系

- 2026-09-25 `ef3e1a2c`「双通道文案收尾——skill 重写为内嵌为主」：定位不冲突，本文档把扩展从「偶尔手动连」升格为「登录态 + 在场协作」，skill 文案需随 P0 落地同步更新。
- 2026-09-09 `3653c674` 扩展 observe 语义树对齐内嵌协议：tab 命令扩展沿用同一协议语义，双侧同步纪律（nm-protocol / page-state 双副本）继续有效。
