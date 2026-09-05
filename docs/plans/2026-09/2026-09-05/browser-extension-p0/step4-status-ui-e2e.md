---
step: 4
title: 设置页状态行 + dev 端到端验收
status: done
---

## 目标

dev 环境全链路真实验收：Edge 加载扩展 → 点「连接此标签页」→ 设置页状态行 ✅ + 标签页信息；SW 30s 死 → 回「未连接」；Dogear 未运行反向用例通过；全部回归不破。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-gateway-tipc.md] tipc `browser.getExtensionStatus()` + 状态变更推送已就绪，gateway 状态结构与广播时机见其回填
- 当前关键文件状态：`app/settings/page.tsx` 已有「受控浏览器」小节（browserProxyServer 输入框 + browserSearchEngine 下拉，2026-09-05 WebSearch 三期落地）
- 关键决策回顾：状态行纯展示，不做操作面板；文案「浏览器扩展：未连接 / ✅ 已连接 · 当前标签页：×××」；popup 只显示 title/url，正文预览只进设置页与日志

## 计划改动

- [x] `app/settings/page.tsx` 「受控浏览器」小节加状态行：挂载查询一次 + 订阅变更事件；断线态文案「浏览器扩展：未连接（在浏览器扩展里点击「连接此标签页」）」
- [x] （按 step3 回填决定是否需要）渲染层订阅的 store 或 hook 落位——遵循项目 store 惯例，独立状态优先新建小 store 或组件内订阅，避免塞既有大 store
- [x] 端到端验收（headful 手动 + 截图/日志佐证，按设计文档验收清单 1/2 执行）：
  - `bun run dev` + `node scripts/register-nm-dev.mjs` → Edge `edge://extensions` 开发者模式加载 `extension/` → 任开一页 → 点「连接此标签页」→ 设置页状态行 ✅ + title/url/正文预览（CDP 自动化：popup 按钮路径 + 无手势边界场景；有手势的正常快照见人工遗留项）
  - 等 30s（SW 空闲被杀）→ 状态行回「未连接」（NM 保活致 SW 不死，改杀 worker 等价模拟；SW 自然死亡见人工遗留项）
  - 关闭 Dogear dev → 点连接 → popup 显示「Dogear 未运行」
- [x] 回归：`bun run lint` / `bun run build:electron` / `node resources/browser-eval/run-pipeline.mjs` 20/20

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 选型：**组件内 useState + useEffect（不新建 store/hook）**——状态只服务设置页一处，AboutTab 已有完全相同的「挂载查询 + 订阅」先例；组件独立成 `app/settings/ExtensionStatusLine.tsx`（对齐 BasicToolsSection / pi-model-row 拆分模式），page.tsx 只加 import + 一行 JSX
  - 扩展 background.js 加 `self.__dogearDebug` 调试钩子（connect/disconnect/getState）；实测 **Edge 152 的 MV3 module SW 中 DevTools evaluate 与模块代码全局属性不互通**（`self===globalThis` 为 true 但模块对 self 的赋值在 evaluate 里 undefined），钩子经 evaluate 不可用；验收改走 popup 真实按钮路径（CDP 打开 popup.html tab + 合成 click），观察靠 popup DOM / tipc 查询 / 主进程日志三路
  - MV3 SW 同上下文 sendMessage 不可达（SW→SW 自发自收不投递），CDP 不能经 sendMessage 触发 connect，popup 按钮路径绕开
  - 断连用例：NM 连接保活导致 SW 空闲 40s 不死（任务书预警命中），按预案改杀 worker 进程（PID 9160，命令行含 nm-bridge-worker.cjs）等价模拟；「SW 自然死亡」列为人工遗留项
- 改动文件清单：
  - `app/settings/ExtensionStatusLine.tsx`（新）：状态行组件，挂载 `client.getExtensionStatus()` 查询 + `rendererEvents.extensionStatusChanged.listen` 订阅，unmount 清理
  - `app/settings/page.tsx`：「受控浏览器」border 框内新增「浏览器扩展」小节（label + 说明文案 + `<ExtensionStatusLine />`）
  - `extension/src/background.js`：加调试钩子（其余零改动）

### 验收结果（headful Edge 152 + dev electron + CDP，全部通过）

| 用例 | 操作 | 结果 |
|------|------|------|
| 连接 | popup tab 真实按钮 click → connectNative → bat → worker → pipe → gateway | popup「已连接 · Dogear 0.1.100」；tipc `getExtensionStatus` = connected 全字段（extensionVersion 0.1.0 / tabId / connectedAt / extractError）|
| 设置页状态行 | CDP 点主窗口「设置」按钮开 overlay 读 DOM | `✅ 已连接` + 灰字「该页面内容无法读取」；textPreview 空时预览不渲染；「未连接」文案消失 |
| 无手势边界 | CDP 合成 click 无用户手势 | activeTab 未授予 → executeScript 失败 → extractError =「Cannot access contents of the page…」→ 状态仍 connected，UI 兑现设计文档边界场景 |
| 断连 | 杀 worker 进程（NM 保活致 SW 不死） | 3s 后 tipc disconnected + 状态行回「浏览器扩展：未连接（在浏览器扩展里点击「连接此标签页」）」（事件推送驱动，未手动刷新）|
| 反向 | 杀 dev electron（Edge 保留）→ 再点连接 | worker 拉起 → pipe 重试 3s 失败退出 → popup 红字「Dogear 未运行」（className=err）|
| SW 空闲被杀 | 关 popup tab 后观察 40s | NM 保活下 SW 不死（非 BUG，Chrome 116+ 行为）；SW 未连接时空闲正常被杀并自动唤醒验证过 |
| 回归 | lint / build:electron / tsc noEmit / 管线 | 0 errors / 0 错误 / 通过 / 20/20 PASS |

### 给下一步的接力棒
- 渲染层入口定稿：查询 `client.getExtensionStatus()` + 订阅 `rendererEvents.extensionStatusChanged.listen`（全量快照，事件即渲染无需回查），封装已在 `ExtensionStatusLine.tsx`，后续 step 直接复用或抽公共
- ExtensionStatus 类型唯一源：`electron/main/services/browser/browser-gateway.ts`（渲染层 `import type` 相对路径引入，events.ts 类型自动流转）
- 待办：见设计文档验收清单第 3/5 条（dist 安装包链路 / bridge 分流无 flag 零行为）属后续 step；人工遗留验收项见共享区 step4 交付文档
