---
step: 2
title: agent 独立窗口
status: done
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

## 实施回填（已填，2026-10-03）

### 实际改动
- 与计划差异：
  1. `DOGEAR_GROUP_TITLE` 常量从 tab-commands.js 挪到 agent-window.js 并导出（tab-commands 反向导入），形成单向依赖，避免两文件循环依赖（工作区硬决策：循环依赖需 `await import()` 延迟导入规避，直接单向化）
  2. openTab 对 `resolveAgentWindowId()` 单独 try/catch，失败报 `navigation_blocked`「agent 窗口创建失败」，而非落入 handleCommand 外层 catch 的 `timeout` 错误码
  3. 第 4 条目检查结论：handleFocusCurrent（background.js）的用户活动 tab 只走 setFocusedTab + sendTabSnapshot，确认未经过 ensureDogearGroup，无误加，未改
- 改动文件清单：
  - `extension/src/agent-window.js`（新，74 行）：`DOGEAR_GROUP_TITLE` 导出；`resolveAgentWindowId()` 三级解析（① storage.local.dogearWindowId 且 windows.get 存活 ② tabGroups.query({title:'Dogear'})[0].windowId → 回写 storage ③ windows.create({focused:false}) → 回写）；`forgetAgentWindowIfDead()`；顶层 `windows.onRemoved` 监听（关的窗口 id === 存的 id → 清 storage）
  - `extension/src/tab-commands.js`：导入 resolveAgentWindowId/DOGEAR_GROUP_TITLE；openTab 在 tabs.create 前 `const windowId = await resolveAgentWindowId()`，`chrome.tabs.create({ url, windowId, active: params.background !== true })`
  - lint：0 errors（70 warnings 均为既有 no-explicit-any）；manifest 0.3.0 未动，协议帧/错误码/安全层零改动

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `resolveAgentWindowId(): Promise<number>`：openTab create 前唯一入口；异常 = 窗口创建失败（调用方决定错误码回包）
  - `forgetAgentWindowIfDead(): Promise<number|null>`：存 id 存活返回 id，失效清 storage 返回 null；resolveAgentWindowId 第一步即调用
  - `chrome.storage.local.dogearWindowId: number`：agent 窗口 id 唯一持久标记；windows.onRemoved 兕底清理防 windows.get 假阳性
- 下个 step 该从哪里继续：按 plan.md step3 文档继续
- 待办或已知限制：
  - windows.create 自带一个初始 NTP tab：恰好为「组空后窗口保留复用」提供占位（无占位 tab 时组空 = 窗口自动关）；NTP 不入组、getDogearTabs 不返回，agent 不可见
  - ②分支若历史遗留的 Dogear 组在用户窗口（step 之前 open_tab 创建过），会复用该窗口；用户关闭该窗口后自愈（onRemoved 清 id → 组随之消失 → 下次走③新建后台窗口）
  - `active: params.background !== true` 只影响 agent 窗口内 tab 激活，窗口本身 focused:false 不在前台，不抢用户焦点
