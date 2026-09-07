---
step: 3
title: A3 read_state 通用命令
status: pending
---

## 目标

新增扩展命令 `read_state`：读页面 `window.__INITIAL_STATE__`（小红书/知乎类 SPA 数据源），双模式（顶层概要 / path 子树），风控待遇与 read_text 对齐。

## 依赖上下文（接力棒输入）

- 前置 step 产出：ownership gate 生效（本步骤新工具同样过 gate，handler 入口模式照抄 step1 的接线）；observe 已带 href
- 当前关键文件状态：协议命令 kind 联合类型在 `electron/main/services/browser/nm-protocol.ts`（`CommandKind`）与 `extension/src/nm-protocol.js` 双份；P2 加 navigate kind 有完整先例（背景路由 + gateway 校验 + 工具层）可对照
- `extension/src/dom-actions.js`：所有注入函数不得引用模块作用域（executeScript 序列化约束）；返回值走 NM 通道需可 JSON 化
- 关键决策回顾：风控硬约束——policyGate 随机延迟 + 返回内容风控关键词扫描 + 笔记预算**按页面 URL 计 1 次**（同页多 path 探索不重复计）；读内存 JSON 零网络请求但仍保守计数

## 计划改动

- [ ] 协议双端（`extension/src/nm-protocol.js` + `electron/main/services/browser/nm-protocol.ts`）：加 kind `'read_state'`，params `{ path?: string }`，协议版本号 +1；errorCode 沿用现有全集（无新增）
- [ ] `extension/src/dom-actions.js` 新增 `readStateFn(path)`：
  - `__INITIAL_STATE__` 缺失 → 返回 `{ missing: true }` 结构（工具层转文案）
  - 无 path → 顶层概要：每个 key 的类型/子项数（对象）/数组长度/字符串长度，拼成紧凑文本
  - 有 path（点分，纯数字段为数组下标）→ 逐段下钻；不存在 → 返回 `{ notFound: true, availableKeys: [...] }`（该层可用 key）
  - 命中子树 `JSON.stringify` 截断 8000 字符（超长加 `…（截断）` 标记）
- [ ] `extension/src/background.js`：read_state 命令路由（executeScript 注入 readStateFn，对齐 read_text 先例）
- [ ] `electron/main/services/browser/browser-gateway.ts`：read_state 命令通过（sendExtensionCommand 泛型路径 +1 case，对齐 navigate 先例）
- [ ] `electron/main/agents/tools/extension-tools.ts` 新增 `dogear__extension__read_state`：
  - 过 ownership gate（step1 模式）→ policyGate → 无 budget 直发；命中策略站点时按 URL 计 1 次笔记预算（模块级 `Map<conversationId, lastCountedUrl>`，URL 变化才计数——read_state 专用，不动 read_text 现有语义）
  - 返回文本过 `scanAndMarkRisk`；emitAction 动作类型沿用 `'read_text'`（动作流不扩枚举）或加 `'read_state'`（若 BrowserActionType 加值成本低则加，账本更可读——实施时看代价二选一，回填记录）
  - 工具描述写明双模式用法 + 小红书示例提示（「搜索页数据在 __INITIAL_STATE__，先无 path 看顶层再下钻」）
- [ ] `resources/browser-eval/nm-read-state-smoke.mjs`：NM 帧往返冒烟（对齐 `nm-navigate-smoke.mjs` 模式：kind 路由 / path 下钻 / missing 返回）
- [ ] `bun run build:electron` + node 冒烟全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：（小红书真实字段路径探查留 step5 真机验收）
