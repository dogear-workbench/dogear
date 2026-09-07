---
step: 2
title: 扩展侧 URL 自动跟踪 + ref 代际
status: done
---

## 目标

扩展侧实现「一导航不断线」：navigate 真实导航执行、URL 变化自动跟踪 + 快照自动重采 + 代际重置、observe_page 导航后可用、命令前校验自愈——P1 最大限制（调研流程跑不了三步就断）在本 step 消解。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-protocol-navigate.md] 协议已支持 navigate 命令与 tab_snapshot.generation
- 当前关键文件状态：`extension/src/background.js`（305 行）SW 命令分发，有 tabId/url 竞态校验与 guard；`dom-actions.js`（189 行）四纯函数（ref 用 `data-dogear-ref` 页面自持）；P1 现状：页面自行导航 → 命令 `navigated_away`，且 observe_page 同样被拦（agent 无法自行恢复，需 popup 重连）
- 关键决策回顾：
  - 代际原则「宁可误杀」：URL 变化 / 命令成功回推快照时 generation++，命令校验不符 → `ref_expired`
  - 快照重采要**节流**（SPA 连续路由变化不能每变一次采一次全量快照）；推送复用 tab_snapshot 帧，gateway 汇聚更新状态（UI 状态行自然跟随）
  - 导航用 `chrome.tabs.update(tabId, { url })` 真实导航（浏览器完整加载 + 自动签名 + Referer），不用 executeScript 合成跳转——调研报告「导航优先真实导航」结论
  - SPA pushState：MV3 的 `tabs.onUpdated` 会带 `changeInfo.url` 触发（含 pushState 改写的 URL）；实施时真机确认，若不覆盖再补 executeScript 注入 history 钩子（content script 无常驻是 P1 架构约束，钩子方案用一次性注入 + 断开时失效可接受）

## 计划改动

- [ ] `background.js`：
  - navigate 命令处理：校验 tabId 存活 → `chrome.tabs.update` → 等待加载完成（`tabs.onUpdated` status=complete 或超时）→ 回推新 tab_snapshot（含 generation）
  - URL 变化跟踪：连接期间监听 `tabs.onUpdated`（url 变化 + 本 tabId）→ 节流重采快照（建议 ≥800ms 防抖）→ 推送 gateway + generation++
  - observe_page 解除导航后拦截：观察命令不再因「URL 与连接时不一致」被拒（读命令天然安全，P1 拦它是为了防写操作打错页面——observe/read_text 放行，click/fill 保留 URL 校验但改为返回 `navigated_away` + 附带当前 URL 与新快照，agent 重 observe 后重试，不再需要重连）
  - 命令前校验自愈：所有命令的 url 竞态校验从「拒绝」改为「拒绝 + 回新快照」语义（错误码不变，payload 附 currentUrl）
  - 代际：background 内存 Map<tabId, generation>；observe 采集走当前代际；click/fill 命令校验命令携带的 ref 代际（ref 字符串格式扩展为 `eN@G` 或命令 payload 加 generation 字段——实施时选对 P1 兼容破坏最小的方案，旧格式无代际视作 generation 0）
- [ ] `dom-actions.js`：observe 采集函数返回带 generation；ref 属性写入逻辑不变（页面自持）
- [ ] `extension/src/nm-protocol.js`：若代际进命令 payload 则同步帧结构
- [ ] SW 冷启恢复：代际与跟踪监听器在 SW 重启后重建（generation 重置为 0 可接受——重连后 agent 必然重新 observe）
- [ ] 验证：node driver 真机（临时扩展拷贝 + 独立 gateway 模式，沿用 P1 step5 拓扑）：navigate 授权/未授权/坏协议、导航后 observe 可用、pushState 触发快照推送、节流生效、代际误杀路径（旧 ref 操作新页面被拒）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. ref 格式选 `eN@G`（嵌代际字符串）而非命令 payload 加 generation 字段——gateway 与工具层对 ref 是不透明字符串透传，对 P1 兼容破坏最小（两侧零改动，真机双向兼容已验）；旧格式无代际视作 gen 0（页面校验正则放宽为 `/^e\d+(@\d+)?$/`，代际比对在 background 层做，页面函数不感知代际）
  2. 计划外最小改动 `browser-gateway.ts`：CommandError 加可选 currentUrl + handleCommandResult 失败分支透传——全局决策「payload 附 currentUrl」的 gateway 侧落地，否则该字段发出即被丢弃；对齐 step1「协议字段 gateway 侧落地」先例，可选字段向后兼容
  3. pushState 无需补 history 钩子：Edge 152 的 tabs.onUpdated 带 changeInfo.url 触发（真机 TRACK-1 确认）
  4. 新增 `nav-tracker.js` 拆分代际/防抖/navigate 逻辑（background.js 保持命令分发职责内聚，354 行）；新增 `nav-tracker-smoke.mjs` 纯函数单测
- 改动文件清单：
  - `extension/src/nav-tracker.js`（新增）：代际 Map（lastGenUrl 去重幂等 bump）、800ms 防抖、waitForTabComplete（15s 超时 + abort）、navigateTab
  - `extension/src/background.js`：快照带 generation、navigate 分支、URL 校验读写分类（observe/read_text 放行；click/fill 拒绝+bump+回推快照+currentUrl）、click/fill 代际校验、connect 重置、顶层 onUpdated 监听
  - `extension/src/dom-actions.js`：observeFn 加 generation 参 + ref `eN@G` + 返回带 generation；三函数 ref 正则放宽
  - `electron/main/services/browser/browser-gateway.ts`：CommandError.currentUrl 可选字段 + 透传
  - `resources/browser-eval/nav-tracker-smoke.mjs`（新增）：15 项纯函数单测
  - `extension/src/nm-protocol.js` 零改动（纯字节编解码，帧 roundtrip 单测证明）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - ref 格式 `eN@G`（agent 从 observe 原样透传到 click/fill/read_text，代际对 agent 透明）；旧格式 `eN` = gen 0，gen>0 时被拒（误杀安全方向）
  - generation 唯一递增时机 = 受控 tab URL 变化（onUpdated.url 与 navigate 完成双路径 lastGenUrl 去重幂等）；observe/read_text 后快照刷新不递增；SW 冷启重置 0（已验）
  - navigate 成功约定不变：command_result data={url}；随后含递增 generation 的 tab_snapshot
  - 拒绝自愈契约：navigated_away 的 command_result 附 currentUrl + 同帧 tab_snapshot；gateway CommandError 已带 currentUrl，工具层文案消费留 step3
- 下个 step 该从哪里继续：step3 navigate 工具（extension-tools.ts）——① 工具签名 + zod 校验（URL 形态先行校验，缓解 navigation_blocked 文案不准的 step1 遗留）② commandErrorMessage 对 navigated_away/ref_expired 拼接 err.currentUrl ③ navigate 工具的动作流埋点（recordBrowserAction）
- 待办或已知限制：
  - navigate 等待 complete 上限 15s，慢站可能未加载完即返回（data.url 为当时值，agent 端 observe 可校准）
  - 800ms 防抖窗口内连续路由只推最终快照（中间态不可见，符合设计）
  - generation 单 tab 内存态；多 tab 绑定需重新设计
  - Edge NM host 验证基建的三个坑已沉淀在共享区 step2-delivery.md（bat 不可用/manifest 必须 description/C# NamedPipeClientStream 挂起用 TCP 绕开）
