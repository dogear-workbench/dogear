---
step: 3
title: 操作能力
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
