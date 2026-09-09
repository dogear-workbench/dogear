---
step: 3
title: 操作能力
status: done
---

## 目标

内嵌宿主上的完整操作原语：navigate/click/fill/press/scroll（含容器内滚动）/wait_for/screenshot，页面状态机完整化，site-policy 风控资产平移挂载。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] cdp-session + ax-observe 提供 ref 体系（backendNodeId+generation）与失效校验，签名从 step2 回填
- 参考实现：Proma `Input.dispatchMouseEvent`（点击坐标来自 `DOM.getBoxModel`）、`BrowserScroll`（selector 定位容器，返回 before/after/moved）、`BrowserWaitFor`（url/text/selector 条件等待）
- 关键决策回顾：风控规则不放松——site-policy 的 policyGate（域名授权、节奏预算、随机延迟、风控关键词、guard_password/guard_submit）挂到所有操作工具入口；点击用真实输入事件（CDP Input）而非 DOM click() 合成

## 计划改动

- [ ] 新建 `electron/main/services/browser/embedded/actions.ts`：click（getBoxModel 坐标 + Input.dispatchMouseEvent）、fill（focus + insertText，密码类字段被 guard 拦截）、press（Input.dispatchKeyEvent）、scroll（document 与容器内滚动，Input.dispatchMouseEvent wheel 或 `Input.synthesizeScrollGesture`，返回 before/after/moved）
- [ ] wait_for：url 包含 / 文本出现 / selector 存在三类条件 + 超时；加载态与就绪判定统一走状态机
- [ ] navigate：走 Step 1 宿主导航接口 + 等待加载就绪；返回 url/title/pageState
- [ ] screenshot：webContents.capturePage
- [ ] 页面状态机完整版：`embedded/page-state.ts` 集中判定（URL 模式如 Google `/sorry/`、页面特征关键词、加载事件、CDP 连接状态）→ loading/ready/login_required/verification_required/rate_limited/changed_layout/crashed；`awaiting_human` 为任务级状态（Step 6 产品化），本步先把 login_required/verification_required 判定就位
- [ ] site-policy 平移：`policyGate` 在内嵌操作入口挂载（域名授权、节奏预算、随机延迟、风控关键词、guard_password/guard_submit 全量保留，规则不放松）
- [ ] 工具层切换：`dogear__browser__navigate/click/fill/wait_for/screenshot` 底层切内嵌；新增 `dogear__browser__scroll`
- [ ] read_state 内嵌版：executeJavaScript 读 `__INITIAL_STATE__` 等框架状态，语义对齐扩展通道（探索回路：无 path 返回顶层概要、传错回显可用 key）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - policyGate/navigateGate/scanAndMarkRisk/riskSignalMessage 从 extension-tools.ts 上移至 site-policy.ts 统一实现，两通道共享（extension-tools.ts 改为 import，行为不变）。
  - 输入管线重大环境限制：Electron/Windows（后台实例）上 WebContentsView 的真实输入事件（CDP Input mouse/keyboard/touch、sendInputEvent mouse/key）均不投递；仅 DOM.focus、Input.insertText、Runtime/DOM 域、sendInputEvent mouseWheel 可达。应对：click = DOM.focus + 真实键盘激活（Enter/Space），无效果时降级合成点击（结果标注 method='synthetic'，与扩展通道 el.click() 同级）；fill = native setter 清空 + insertText（真实文本输入）；scroll = sendInputEvent wheel + JS scrollTo 兑底；新增 ensureInputReady 屏外挂载保证视口尺寸与挂载态。待真实桌面环境（Step 6）复查。
  - press 原语在协议层实现（press.ts）但工具层未暴露（按任务范围条目 4）；screenshot 移回 browser-tools.ts 以满足单文件 <300 行。
- 改动文件清单：
  - 新增：embedded/{action-utils,actions,press,scroll,read-state}.ts；agents/tools/{browser-tool-shared,browser-atom-tools,browser-action-tools}.ts
  - 重写：embedded/page-state.ts（完整状态机）；agents/tools/browser-tools.ts（精简为声明式入口 + 组合）；embedded/dev-selftest.ts（操作链路自测）
  - 修改：embedded/ax-observe.ts（AX 文本喂状态机、ReadTextResult 命名导出）；embedded/embedded-browser-manager.ts（ensureInputReady）；site-policy.ts（gate 上移）；extension-tools.ts（改 import）；browser-action-stream.ts（BrowserActionType 加 scroll）；tipc/browser.ts（import 路径）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `clickTab(tab, ref): {ref, urlBefore, urlAfter, navigated, elementGone, method: 'keyboard'|'synthetic', pageState}`；`fillTab(tab, ref, value): {ref, verified, pageState}`；`scrollTab(tab, {ref?, deltaY?, position?}): {target, before, after, moved, pageState}`；`pressTab(tab, key)`（协议层就绪未暴露）；`readTabState(tab, path?): ReadStateResult`
  - `ActionGuardError {code: 'guard_password'|'guard_submit'}`；`resolvePageState(tab, pageText?)` 判定唯一入口 + `pageStateHint(state)`；`ensureInputReady(tabId)` Input 前置屏外挂载兑底
  - site-policy.ts 两通道共享：`policyGate/navigateGate/scanAndMarkRisk/riskSignalMessage/PolicyGateContext`（从 extension-tools.ts 逐字上移，行为不变）
  - 工具层拆为 browser-tools.ts（296 行，readArticle/search/save_article/close/screenshot+组合）+ browser-atom-tools.ts（288，navigate/observe_page/find/read_text/wait_for）+ browser-action-tools.ts（278，click/fill/scroll/read_state）+ browser-tool-shared.ts（181，动作流事件+withAgentTab）；共 14 工具
  - dev-selftest 12 项断言含 guard 拦截/scroll 精度/click 导航/generation 递增
- 下个 step 该从哪里继续：Step 4（navigate/readArticle 服务内嵌迁移）+ Step 4 UI 面板接管 tab 挂载 bounds 后可移除 ensureInputReady 兑底
- 待办或已知限制：真实输入事件在本环境不投递（详见 step3-delivery.md）；CDP Input.dispatchMouseEvent 永久 hang（勿再引入）
