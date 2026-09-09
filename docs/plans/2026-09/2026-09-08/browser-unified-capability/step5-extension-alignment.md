---
step: 5
title: 扩展通道对齐 + NM 四件套
status: done
---

## 目标

扩展通道 observe 从 CSS 选择器枚举升级为 DOM+ARIA 语义树（与内嵌协议返回结构对齐），补 find/scroll 语义；修复 NM 生命周期四件套（断开按钮、gateway 退出收尾、安装器时序、心跳兜底）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] ax-observe 的输出结构（协议统一的目标形态），从 step2 回填写明字段
- 现状代码：`extension/src/dom-actions.js`（observeFn：选择器白名单 + data-dogear-ref 属性标记 + 120 截断）、`extension/src/background.js`（358 行，命令分发 + 单 tab 绑定）、popup（仅连接按钮）、`electron/main/services/browser/browser-gateway.ts`、`nm-bridge.ts`、`update-service.ts:153-156`（spawn 安装器紧跟 app.quit，无 NM 收尾）
- 关键决策回顾：扩展侧拿不到 CDP AX tree（chrome.debugger 权限过重，排除），用 DOM+ARIA 构造近似语义树——信息量允许少于内嵌但结构必须一致；ref 在扩展侧仍用 DOM 属性标记（无 backendNodeId 可用），但失效校验语义（generation）与内嵌对齐
- NM 四件套方案（前会话拍板）：popup 加断开按钮（`dogear_disconnect` → `disconnectPort()`）；before-quit 时 `closeBrowserGateway()`（goodbye + end + destroy + server.close）；`runInstaller` 改时序（先收尾 → 等 bridge 退出带超时强杀 → 再 spawn 安装器）；bridge 心跳超时自杀兜底半开管道

## 计划改动

- [x] `extension/src/dom-actions.js`：observeFn 重写为 DOM 遍历 + ARIA/语义角色构造（覆盖 role 属性、原生语义映射、aria-label），主动穿透 open shadowRoot；返回结构与内嵌 ax-observe 对齐（同字段名）；截断策略对齐（interactive 全列 + 摘要分级）
- [x] 扩展侧新增 find（DOM 遍历按 role+name 重查找）与 scroll（容器内滚动 + before/after 确认）命令，`background.js` 命令表注册
- [x] popup：加断开按钮（当前 tab 连接态显示），`dogear_disconnect` 消息 → `disconnectPort()`
- [x] `browser-gateway.ts`：新增 `closeBrowserGateway()`；主进程 `before-quit` 挂接（goodbye 广播 → 管道 end/destroy → server.close）
- [x] `update-service.ts`：`runInstaller` 先调 `closeBrowserGateway()` → 等待 nm-bridge 进程退出（超时 3s 强杀）→ 再 spawn 安装器 + app.quit
- [x] `nm-bridge.ts`：worker 心跳（如 30s 无消息且管道无数据 → `app.exit(0)`），兜底半开管道
- [x] 扩展工具返回结构对齐：`extension-tools.ts` 各工具返回加 `pageState` 字段（复用协议状态机的判定关键词，扩展侧简化实现）
- [x] 站点档案工具（`extension-site-tools.ts`）不动，验证与新返回结构共存无冲突

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. pageState 常量同步选「扩展侧独立文件 + 头注标记双侧同步」（扩展无构建链）；判定收敛 background 侧（content 只回传 textSample，background 算完 pageState 后 delete）
  2. 「等 bridge 退出强杀」落地为等管道 close 事件 3s 超时 destroy（bridge 由浏览器启动无进程句柄）+ 心跳自杀兑底
  3. ProtocolVersion 保持 3（旧扩展收新命令走 stale_protocol 优雅降级）
  4. extension-tools.ts 拆出 extension-observe-format.ts（182 行 payload/格式化层），主文件剩 727 行存量工具定义
- 改动文件清单：
  - 扩展：+page-state.js、+observe-actions.js（DOM+ARIA 语义树，穿透 shadowRoot，298 行）、+find-actions.js、dom-actions.js 重写（删旧 observeFn +scrollFn）、background.js（find/scroll 注册 + pageState 注入 + generation 校验扩展 + dogear_disconnect）、popup.html/js（断开按钮）
  - 主进程：nm-protocol.ts（+find/scroll 命令）、browser-gateway.ts（+closeBrowserGateway 幂等 + 10s ping 心跳）、nm-bridge.ts（帧重组 + 30s 心跳自退）、update-service.ts + tipc/updater.ts（runInstaller 先收尾）、main-app.ts（before-quit 收尾）、extension-tools.ts + extension-observe-format.ts（四段式输出对齐 + 新工具）
  - 验证：lint 0 errors / build:electron 通过 / 扩展 6 JS node --check 全过；运行时验证需 Chrome 加载扩展（5 项验证步骤在共享区 step5-delivery.md）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 扩展 observe 返回同构内嵌 ObservePayload（tabId 为 number）；find/scroll/navigate 返回结构见共享区 step5-delivery.md
  - ref 形态扩展 `e{n}@{gen}` vs 内嵌 `{backendNodeId}@{gen}`（各自 observe 产生不互通，generation 语义对齐）
  - `closeBrowserGateway(): Promise<void>` 幂等（before-quit 与 runInstaller 双挂）；NM 心跳主进程 10s ping / bridge 30s 无活动自退
  - `parseObservePayload/parseFindPayload/formatObserve/pageStateSuffix`（extension-observe-format.ts）
- 下个 step 该从哪里继续：Step 6 删 browser-manager.ts（embedded/proxy.ts 已无依赖）；呈现层用 manager.attachToWindow；awaiting_human 用 pageState=login_required/verification_required 或 guard_submit 触发
- 待办或已知限制：
  - page-state 判定规则双侧同步约束（embedded/page-state.ts ↔ extension/src/page-state.js）
  - 扩展 observe 不含 iframe 内部；accname 近似；超大页面 8s 超时竞赛兑底
  - 旧 bridge 透传 ping 帧被扩展静默忽略（无害）；新 bridge 与主进程同步发布
  - extension-tools.ts 727 行（可按 site-tools deps 注入模式继续拆）
