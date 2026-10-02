---
step: 4
title: 探索交互增强（click 检测 / 焦点跟随 / 事件序列 / find visible）
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
