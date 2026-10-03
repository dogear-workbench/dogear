---
step: 4
title: 探索交互增强（click 检测 / 焦点跟随 / 事件序列 / find visible）
status: done
---

## 目标
click 后自动检测新开标签并如实回报 + 焦点跟随；点击派发完整指针事件序列；find 结果标注可见性，消除「有效点击被误报无效」与「点中隐藏副本」两类问题。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step2 后 agent tab 全在独立窗口的 Dogear 组；Chrome 原生行为「组内 tab 打开的 _blank 新 tab 自动入组」已实证（第五轮回归，tab 491413270），本 step 直接依赖该行为做检测
- 当前关键文件状态：
  - `extension/src/background.js` handleCommand 的 click 分支：executeScript clickFn 后 postResult，无新 tab 检测
  - `extension/src/dom-actions.js` clickFn（约 45-88 行）：定位元素后单次 `el.click()`
  - `extension/src/find-actions.js`：find 返回元素列表（ref/name/role），无可见性字段
- 关键决策回顾：检测轮询 ~1.5s 内 2 次（真机调优）；焦点跟随对齐 open_tab 语义（开新页即焦点）；visible 用 offsetParent/rect 判定，click 不可见目标只提示不拒绝

## 计划改动
- [ ] 新建 `extension/src/click-watch.js`：`snapshotGroupTabIds()`（getDogearTabs → id 集合）、`detectNewGroupTab(beforeIds, { pollTimes: 2, intervalMs: 750 })` 返回新增 tab 或 null；background.js 保持瘦身后把 click 分支的检测接进来
- [ ] `background.js` click 命令成功路径：点击前 snapshot → 点击后 detectNewGroupTab → 有新 tab：setFocusedTab + pushSnapshot + postResult 附 `openedTab: { tabId, url, title }` 与提示「已在新标签页打开 {title}，焦点已切至新标签页」；无新 tab：维持现有回报（措辞把「页面无明显变化」保留为兜底）
- [ ] `dom-actions.js` clickFn：单 click 改为完整序列 dispatchEvent——PointerEvent pointerdown → MouseEvent mousedown → PointerEvent pointerup → MouseEvent mouseup → MouseEvent click，均 bubbles+composed，坐标取元素中心；提交类 confirmed 判定逻辑不动
- [ ] `find-actions.js`：结果每项加 `visible`（offsetParent 非 null 或 getBoundingClientRect 宽高 > 0）；不可见元素 name 加「(隐藏)」后缀或独立字段——采用独立字段，避免破坏 name 匹配语义
- [ ] click 命中不可见元素：回包附提示「目标是隐藏元素，结果可能无效，建议改用可见元素（find 结果 visible 字段）」
- [ ] `electron/agents/tools/extension-tools.ts` click 工具结果文案透传 openedTab 提示（若回包 data 已带则拼接展示，参照 open_tab 的 grouped 透传模式）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 主进程类型定义落在 extension-observe-format.ts（ClickPayload 加 openedTab/targetHidden、ObserveElement 加 visible、formatObserveElement 加 [隐藏] 标注），extension-tools.ts 只改文案与 emitAction url——类型定义属于条目 6 的必要配套
  - find 工具描述补了一句 visible/[隐藏] 说明（agent 需感知该标注，与条目 5 提示文案呼应）；click 工具描述同步补「开新标签页自动跟随焦点并回报」
  - click 成功回包同时透传 targetHidden（条目 5），主进程 formatClick 在 openedTab 与普通验证两条路径都拼接隐藏提示
  - 焦点跟随对齐 open_tab：detect 到新 tab 后先 chrome.tabs.update(active: true)（尽力而为）再 setFocusedTab + sendTabSnapshot，对齐 open_tab 的创建即前台语义
- 改动文件清单：
  - 新建 extension/src/click-watch.js（snapshotGroupTabIds / detectNewGroupTab，pollTimes:2, intervalMs:750，多新增取最大 tabId）
  - extension/src/dom-actions.js：clickFn 改完整事件序列（pointerdown→mousedown→pointerup→mouseup→click，均 bubbles+composed，坐标取元素中心，button:0/buttons 按真实序列），返回值附 targetHidden；guard 判定零改动
  - extension/src/find-actions.js：visibleOf（offsetParent 非 null 或 rect 宽高>0），每项附 visible 字段
  - extension/src/background.js：click 分支三行接线（import / executeScript 前 snapshot / 成功路径 detect + 焦点跟随 + openedTab）
  - electron/main/agents/tools/extension-observe-format.ts：类型 + formatObserveElement [隐藏] 标注
  - electron/main/agents/tools/extension-tools.ts：formatClick openedTab/targetHidden 文案、emitAction url 优先 openedTab.url、find/click 工具描述

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - click 成功回包 data 新增：openedTab: { tabId, url, title }（检测到新 tab 时）；targetHidden: true（命中隐藏元素时）
  - find 结果每元素新增 visible: boolean；主进程 ObserveElement.visible?: boolean，formatObserveElement 对 visible===false 输出「[隐藏]」尾标
  - click-watch.js：snapshotGroupTabIds(): Promise<Set<number>|null>；detectNewGroupTab(beforeIds, {pollTimes=2, intervalMs=750}): Promise<Tab|null>
- 下个 step 该从哪里继续：无下个 step（P1 最后一步）；遗留真机验证清单见 step4-delivery.md
- 待办或已知限制：
  - 检测依赖「组内 tab 打开的 _blank 新 tab 自动入组」行为，非组内 tab（旧状态/入组失败）点击开新 tab 检测不到，走兜底回报
  - detectNewGroupTab 轮询最多延迟回包 ~1.5s，为设计取舍（真机可调优 pollTimes/intervalMs）
  - openedTab 与 targetHidden 同时出现时 hidden 提示追加在 openedTab 分支内，不丢失
