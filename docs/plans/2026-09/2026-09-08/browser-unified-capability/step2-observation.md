---
step: 2
title: 观察能力
status: done
---

## 目标

内嵌宿主接入 CDP，实现 AX Tree 语义观察：`observe`（全树/区域/过滤）、`find`（role+name 重查找）、`read_text`，ref 采用 backendNodeId+generation 绑定并在失效时返回明确恢复引导。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] embedded-browser-manager 提供 tab 注册表与 generation 递增，关键签名执行时从 step1 回填
- 参考实现：Proma `browser-cdp.ts`（CDP attach）、`browser-observation-policy.ts`（AX tree 精简规则）、`browser-controller.ts` 的 `RefEntry = { backendNodeId, generation, label, editable }` 与 `assertCurrentDocument`
- 关键决策回顾：ref 失效不做静默自动重试——返回 `ref_expired` + 引导重新 observe，显式重观察是探索循环的一部分；观察返回统一携带 `pageState`（判定规则本步先做基础版 loading/ready/crashed，完整状态机 Step 3）

## 计划改动

- [ ] 新建 `electron/main/services/browser/embedded/cdp-session.ts`：webContents.debugger attach CDP；会话与 tab 生命周期绑定（tab 销毁即 detach）；重连后 generation++
- [ ] 新建 `embedded/ax-observe.ts`：`Accessibility.getFullAXTree` → 精简语义树（role/name/ref/可交互标记/可见性），输出结构与扩展通道 observe 返回对齐（协议统一的关键）；大页面截断策略：全量返回按 role 分级摘要 + interactive 元素全列（不学现状硬截 120）
- [ ] find：按 role+name（含 exact 匹配）在 AX tree 中重查找，不依赖上次 observe 结果；返回可直接使用的 ref
- [ ] read_text：CDP `DOM.getOuterHTML` 或 executeJavaScript 取 body 文本，走现有压缩策略
- [ ] ref 校验：操作前 `DOM.getBoxModel`/`DOM.describeNode` 验证 backendNodeId 属当前 document + generation 匹配
- [ ] 观察工具落 agent 工具层：`dogear__browser__observe_page` 底层切内嵌（保留现有返回结构兼容，新增 refs 语义）、新增 `dogear__browser__find`、`dogear__browser__read_text` 切内嵌
- [ ] agent 工具注册表 `registerToolGroup` 同步（`agents/tools/browser-tools.ts`）

## 实施回填（做完后填）

### 实际改动
- 状态：完成。`bun run build:electron` 通过（tsc strict），`bun run lint` 0 errors（99 warnings 全为存量），`DOGEAR_EMBEDDED_BROWSER_SELFTEST=1` 运行时自测全链路通过（observe/find/read_text/navigate/wait_for/ref 失效校验）。
- 与计划差异：
  1. **ref 无状态化**：ref 直接编码 `{backendNodeId}@{generation}`，无需 Proma 式 RefEntry Map；校验 = generation 对比 + `DOM.describeNode` 探活。
  2. **navigate/wait_for/screenshot 提前切内嵌**（原计划 Step 3）：若仅切观察三工具，「navigate→observe」主探索流在本步合入后会断链（Patchright 页面对内嵌通道不可见）。navigate/wait_for/screenshot 内嵌实现很薄且不涉及风控（现状 Patchright 版也只有 controlledBrowserBlock，policyGate 本就是 Step 3 增量），提前切换后工具层 Patchright 依赖全部清除（仅剩 readArticle/search 服务内部使用，Step 4 迁移）。click/fill 涉及 policyGate/guard/真实输入事件，严格留给 Step 3，本步以诚实过渡指引替代（防止 agent 拿内嵌 ref 循环重试烧 token）。
  3. attach 后补发幂等 `Accessibility.enable`，确保 Electron 渲染进程开启 AX 模式（后台不可见 view 下 AX tree 实测正常生成）。
  4. observe AX depth 取 10（Proma 8/16），find 取 16；interactive 上限 250（不硬截 120），headings 全列上限 60，其余按 role 摘要（top12 按文本量）。
- 改动文件清单：
  - 新增 `embedded/cdp-session.ts`、`embedded/ax-tree.ts`、`embedded/ax-observe.ts`、`embedded/navigate.ts`、`embedded/wait-for.ts`、`embedded/page-state.ts`
  - 修改 `embedded/embedded-browser-manager.ts`（+getView/getTabRecord，closeTab/handleTabDestroyed 挂 disposeCdpSession）
  - 修改 `embedded/dev-selftest.ts`（自测覆盖观察全链路）
  - 修改 `agents/tools/browser-tools.ts`（六工具切内嵌 + find 新增 + click/fill 过渡指引 + 删光工具层 Patchright 依赖）
  - 修改 `agents/pi-session/pi-session.ts`（2 处）、`services/scheduler/custom-agent-tools.ts`（+workspaceId）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `getCdpSession(tab): EmbeddedCdpSession`（按 tabId 注册表，webContents destroyed 自动清理）；`send<T>(method, params?, timeoutMs=8s)` 超时→recover（detach+attach+generation++）；`disposeCdpSession(tabId)`
  - ref 无状态：`parseRef(ref) → {backendNodeId, generation}`；`assertRefUsable(tab, ref)` 校验失败抛 `RefExpiredError`（含恢复引导）；generation 每次跨文档导航 +1（302 = +2 正常）
  - `observeTab(tab, {region?, textFilter?}): ObservePayload`；`findInTab(tab, {role?, name?, exact?, maxResults?}): FindPayload`；`readTabText(tab, ref?): {text, totalLength}`（8000 截断）；`navigateTab(manager, workspaceId, url, holderId)`；`waitForTabCondition(record, {text?, urlContains?, timeoutSec})`；`resolvePageState(tab)`（page-state.ts，Step 3 扩展完整判定）
  - `ObservePayload = {tabId, url, title, generation, pageState, totalInteractive, shownInteractive, regionCounts, elements[], headings[], roleSummary[], truncated}`；`ObserveElement = {ref, role, text, hint, href?, level?, editable, interactive}`
  - 截断策略：interactive 全列（阀 250）+ headings 全列（阀 60）+ 其余 role 分级摘要（top12）；工具层 `manager.retain(tabId, conversationId)` 不 release（防探索中被 3min 回收）
- 下个 step 该从哪里继续：Step 3 操作原语（actions.ts）直接用 `getCdpSession(record).send()` + `assertRefUsable`；policyGate 挂 navigate/click/fill 入口；`page-state.ts` 扩展完整状态机判定
- 待办或已知限制：browser-tools.ts 633 行（存量超大，Step 3 重写 click/fill 时建议拆分工具文件）；conversation 级 retain 不 release（防探索中 tab 被回收，代价是 tab 常驻到 dispose）
