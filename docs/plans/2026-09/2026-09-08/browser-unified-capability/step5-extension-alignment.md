---
step: 5
title: 扩展通道对齐 + NM 四件套
status: pending
---

## 目标

扩展通道 observe 从 CSS 选择器枚举升级为 DOM+ARIA 语义树（与内嵌协议返回结构对齐），补 find/scroll 语义；修复 NM 生命周期四件套（断开按钮、gateway 退出收尾、安装器时序、心跳兜底）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] ax-observe 的输出结构（协议统一的目标形态），从 step2 回填写明字段
- 现状代码：`extension/src/dom-actions.js`（observeFn：选择器白名单 + data-dogear-ref 属性标记 + 120 截断）、`extension/src/background.js`（358 行，命令分发 + 单 tab 绑定）、popup（仅连接按钮）、`electron/main/services/browser/browser-gateway.ts`、`nm-bridge.ts`、`update-service.ts:153-156`（spawn 安装器紧跟 app.quit，无 NM 收尾）
- 关键决策回顾：扩展侧拿不到 CDP AX tree（chrome.debugger 权限过重，排除），用 DOM+ARIA 构造近似语义树——信息量允许少于内嵌但结构必须一致；ref 在扩展侧仍用 DOM 属性标记（无 backendNodeId 可用），但失效校验语义（generation）与内嵌对齐
- NM 四件套方案（前会话拍板）：popup 加断开按钮（`dogear_disconnect` → `disconnectPort()`）；before-quit 时 `closeBrowserGateway()`（goodbye + end + destroy + server.close）；`runInstaller` 改时序（先收尾 → 等 bridge 退出带超时强杀 → 再 spawn 安装器）；bridge 心跳超时自杀兜底半开管道

## 计划改动

- [ ] `extension/src/dom-actions.js`：observeFn 重写为 DOM 遍历 + ARIA/语义角色构造（覆盖 role 属性、原生语义映射、aria-label），主动穿透 open shadowRoot；返回结构与内嵌 ax-observe 对齐（同字段名）；截断策略对齐（interactive 全列 + 摘要分级）
- [ ] 扩展侧新增 find（DOM 遍历按 role+name 重查找）与 scroll（容器内滚动 + before/after 确认）命令，`background.js` 命令表注册
- [ ] popup：加断开按钮（当前 tab 连接态显示），`dogear_disconnect` 消息 → `disconnectPort()`
- [ ] `browser-gateway.ts`：新增 `closeBrowserGateway()`；主进程 `before-quit` 挂接（goodbye 广播 → 管道 end/destroy → server.close）
- [ ] `update-service.ts`：`runInstaller` 先调 `closeBrowserGateway()` → 等待 nm-bridge 进程退出（超时 3s 强杀）→ 再 spawn 安装器 + app.quit
- [ ] `nm-bridge.ts`：worker 心跳（如 30s 无消息且管道无数据 → `app.exit(0)`），兜底半开管道
- [ ] 扩展工具返回结构对齐：`extension-tools.ts` 各工具返回加 `pageState` 字段（复用协议状态机的判定关键词，扩展侧简化实现）
- [ ] 站点档案工具（`extension-site-tools.ts`）不动，验证与新返回结构共存无冲突

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
