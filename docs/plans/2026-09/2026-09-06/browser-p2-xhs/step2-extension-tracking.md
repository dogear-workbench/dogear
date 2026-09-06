---
step: 2
title: 扩展侧 URL 自动跟踪 + ref 代际
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
