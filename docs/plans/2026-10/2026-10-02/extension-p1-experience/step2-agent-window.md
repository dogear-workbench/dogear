---
step: 2
title: agent 独立窗口
status: pending
---

## 目标
open_tab 打开的页面全部进 Dogear 专属后台窗口（focused: false 不抢用户前台），组锚定该窗口；窗口关闭后自动重建。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 已完成自动连接与去页面绑定；connect()/popup 的「把当前页交给 Dogear」可设用户窗口的 tab 为焦点（该 tab 不入组，跨窗口 executeScript 按 tabId 无障碍）
- 当前关键文件状态：`extension/src/tab-commands.js` 的 `openTab()` 中 `chrome.tabs.create({ url, active: ... })` 未指定 windowId；`ensureDogearGroup(tabId)` 两步入组逻辑正常
- 关键决策回顾：窗口 id 双源解析（storage.local.dogearWindowId → Dogear 组所在窗口 → 新建）；组空后窗口保留复用；用户关整窗 = 组消失 = 下次 open_tab 自动重建，不报错

## 计划改动
- [ ] 新建 `extension/src/agent-window.js`：`resolveAgentWindowId()` 按序解析——① storage.local.dogearWindowId 且 windows.get 存活 ② tabGroups.query({title:'Dogear'}) 有组 → 组.windowId（同时回写 storage）③ chrome.windows.create({ focused: false }) → 回写 storage 并返回新 id；`forgetAgentWindowIfDead()` 供重建路径清理失效 id
- [ ] `tab-commands.js` openTab：create 前 `const windowId = await resolveAgentWindowId()`，`chrome.tabs.create({ url, windowId, active: params.background !== true })`（active 保留 background 参数语义：agent 窗口内部的前台切换，不影响用户窗口）
- [ ] windows.onRemoved 监听（agent-window.js 内）：关闭的窗口 id === 存的 id → 清 storage 标记（与③重建配合，避免 windows.get 假阳性——onRemoved 兜底更稳）
- [ ] 手动焦点（step1 的 dogear_focus_current）指定的用户 tab 确认不经过 ensureDogearGroup（计划本就不入组，检查实施时没有误加）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
