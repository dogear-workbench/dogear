---
step: 3
title: A3 read_state 通用命令
status: done
---

## 目标

新增扩展命令 `read_state`：读页面 `window.__INITIAL_STATE__`（小红书/知乎类 SPA 数据源），双模式（顶层概要 / path 子树），风控待遇与 read_text 对齐。

## 依赖上下文（接力棒输入）

- 前置 step 产出：ownership gate 生效（本步骤新工具同样过 gate，handler 入口模式照抄 step1 的接线）；observe 已带 href
- 当前关键文件状态：协议命令 kind 联合类型在 `electron/main/services/browser/nm-protocol.ts`（`CommandKind`）与 `extension/src/nm-protocol.js` 双份；P2 加 navigate kind 有完整先例（背景路由 + gateway 校验 + 工具层）可对照
- `extension/src/dom-actions.js`：所有注入函数不得引用模块作用域（executeScript 序列化约束）；返回值走 NM 通道需可 JSON 化
- 关键决策回顾：风控硬约束——policyGate 随机延迟 + 返回内容风控关键词扫描 + 笔记预算**按页面 URL 计 1 次**（同页多 path 探索不重复计）；读内存 JSON 零网络请求但仍保守计数

## 计划改动

- [x] 协议双端（`extension/src/nm-protocol.js` + `electron/main/services/browser/nm-protocol.ts`）：加 kind `'read_state'`，params `{ path?: string }`，协议版本号 +1；errorCode 沿用现有全集（无新增）
- [x] `extension/src/dom-actions.js` 新增 `readStateFn(path)`：
  - `__INITIAL_STATE__` 缺失 → 返回 `{ missing: true }` 结构（工具层转文案）
  - 无 path → 顶层概要：每个 key 的类型/子项数（对象）/数组长度/字符串长度，拼成紧凑文本
  - 有 path（点分，纯数字段为数组下标）→ 逐段下钻；不存在 → 返回 `{ notFound: true, availableKeys: [...] }`（该层可用 key）
  - 命中子树 `JSON.stringify` 截断 8000 字符（超长加 `…（截断）` 标记）
- [x] `extension/src/background.js`：read_state 命令路由（executeScript 注入 readStateFn，对齐 read_text 先例）
- [x] `electron/main/services/browser/browser-gateway.ts`：read_state 命令通过（sendExtensionCommand 泛型路径 +1 case，对齐 navigate 先例）
- [x] `electron/main/agents/tools/extension-tools.ts` 新增 `dogear__extension__read_state`：
  - 过 ownership gate（step1 模式）→ policyGate → 无 budget 直发；命中策略站点时按 URL 计 1 次笔记预算（模块级 `Map<conversationId, lastCountedUrl>`，URL 变化才计数——read_state 专用，不动 read_text 现有语义）
  - 返回文本过 `scanAndMarkRisk`；emitAction 动作类型沿用 `'read_text'`（动作流不扩枚举）或加 `'read_state'`（若 BrowserActionType 加值成本低则加，账本更可读——实施时看代价二选一，回填记录）
  - 工具描述写明双模式用法 + 小红书示例提示（「搜索页数据在 __INITIAL_STATE__，先无 path 看顶层再下钻」）
- [x] `resources/browser-eval/nm-read-state-smoke.mjs`：NM 帧往返冒烟（对齐 `nm-navigate-smoke.mjs` 模式：kind 路由 / path 下钻 / missing 返回）
- [x] `bun run build:electron` + node 冒烟全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **browser-gateway.ts 零改动**：read_state 走 sendExtensionCommand 泛型路径即可，navigate 先例的 gateway 特有分支是目标 URL 校验（validateNavigateTarget），read_state 无需对应物；「+1 case」不存在
  2. **extension/src/nm-protocol.js 零改动**：该文件是纯帧编解码（无 kind 联合/版本号常量），协议版本号实际落在 background.js hello 帧（2→3）；TS 侧 nm-protocol.ts 加 kind + ProtocolVersion=3 + ReadStateCommandParams
  3. **注入需 `world: 'MAIN'`**（计划未预见的硬点）：`window.__INITIAL_STATE__` 是页面主世界全局，executeScript 默认 ISOLATED 世界读不到；background.js executeScriptWithTimeout 加可选 world 参数，read_state 传 `'MAIN'`
  4. **emitAction 加了 `'read_state'`**：代价仅 BrowserActionType 联合加值 + BrowserPanel.tsx 两个映射行（Database 图标/「读状态」标签），账本可读性更优
  5. **新增 readStateFn 返回形状 `{ notSerializable: true }`**：循环引用等 JSON.stringify 异常的设计文档边界情况，计划清单未列
  6. **site-policy-smoke.mjs 追加 R1-R9**：read_state 的 URL 计数预算/风控扫描/missing+notFound 文案/动作流标记用 mock gateway 半真链路验证（S3-6 证与 read_text 共用预算池）；计 45 PASS
  7. **stale-protocol-smoke.mjs 之外还有两个冒烟握手版本需适配**：extension-ownership / site-policy 的 hello protocolVersion 2→3（Briefing 只提了 stale-protocol）
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts`（ProtocolVersion=3、CommandKind+read_state、ReadStateCommandParams）
  - `extension/src/dom-actions.js`（readStateFn，含 MAIN world WHY 注释）
  - `extension/src/background.js`（import/COMMAND_FUNCS/readSafe/args/world/hello v3/成功后快照回推）
  - `electron/main/services/browser/browser-action-stream.ts`（BrowserActionType+read_state）
  - `electron/main/agents/tools/extension-tools.ts`（ReadStatePayload、readStateCountedUrlByConv Map、read_state 工具）
  - `components/companion/BrowserPanel.tsx`（ACTION_ICONS/ACTION_LABELS + Database）
  - `resources/browser-eval/nm-read-state-smoke.mjs`（新建，14 PASS）
  - `resources/browser-eval/site-policy-smoke.mjs`（R1-R9 + S3-6，握手 v3，授权域适配）
  - `resources/browser-eval/stale-protocol-smoke.mjs`（caseC v3 + 断言文案）
  - `resources/browser-eval/extension-ownership-smoke.mjs`（握手 v3）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - readStateFn 返回（全部可 JSON 化）：`{missing:true}` / `{summary:string}` / `{json,truncated,totalLength}` / `{notFound:true,availableKeys:string[]}` / `{notSerializable:true}`；json 截断 8000 + `…（截断）`，totalLength 含 stringify 引号
  - 协议 v3：旧扩展（hello protocolVersion<3）发任何命令收 stale_protocol，需真机重载 unpacked 扩展
  - read_state 预算：`readStateCountedUrlByConv`（extension-tools.ts 模块级），gate.ctx 命中且 URL 变化才 checkNoteBudget，命令成功+风控扫描通过后才 consumeNote 并记录 URL；与 read_text 共用同一 notes 池
  - 动作流 result 枚举新增：missing_state / path_not_found / not_serializable（read_state 专用）
- 下个 step 该从哪里继续：step4（B 段站内搜索引擎，不碰扩展通道）；step5 真机验收时重载扩展 + 探小红书 __INITIAL_STATE__ 实际字段路径回填工具描述示例
- 待办或已知限制：
  - MAIN world 注入真机行为（executeScript world:'MAIN'）未真机验证，留 step5
  - 顶层概要未截断（key 极多时文本会大，实测 SPA 顶层 key 数量级为几十，够用）
  - extension-tools.ts 已 ~660 行（本 step 前 570），持续超 300 行基准，P3 收口后可考虑按「工具组拆文件」重构
  - site-policy.ts controlledBrowserBlock 文案未加 read_state（不在本 step 范围，step5 doc-sync 可顺带）
