---
step: 2
title: 观察能力
status: pending
---

## 目标

内嵌宿主接入 CDP，实现 AX Tree 语义观察：`observe`（全树/区域/过滤）、`find`（role+name 重查找）、`read_text`，ref 采用 backendNodeId+generation 绑定并在失效时返回明确恢复引导。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] embedded-browser-manager 提供 tab 注册表与 generation 递增，关键签名执行时从 step1 回填
- 参考实现：Proma `browser-cdp.ts`（CDP attach）、`browser-observation-policy.ts`（AX tree 精简规则）、`browser-controller.ts` 的 `RefEntry = { backendNodeId, generation, label, editable }` 与 `assertCurrentDocument`
- 关键决策回顾：ref 失效不做静默自动重试——返回 `ref_expired` + 引导重新 observe，显式重观察是探索循环的一部分；观察返回统一携带 `pageState`（判定规则本步先做基础版 loading/ready/crashed，完整状态机 Step 3）

## 计划改动

- [ ] 新建 `electron/main/services/browser/embedded/cdp-session.ts`：webContents.debugger attach CDP；会话与 tab 生命周期绑定（tab 销毁即 detach）；重连后 generation++
- [ ] 新建 `embedded/ax-observe.ts`：`Accessibility.getFullAXTree` → 精简语义树（role/name/ref/可交互标记/可见性），输出结构与扩展通道 observe 返回对齐（协议统一的关键）；大页面截断策略：全量返回按 role 分级摘要 + interactive 元素全列（不学现状硬截 120）
- [ ] find：按 role+name（含 exact 匹配）在 AX tree 中重查找，不依赖上次 observe 结果；返回可直接使用的 ref
- [ ] read_text：CDP `DOM.getOuterHTML` 或 executeJavaScript 取 body 文本，走现有压缩策略
- [ ] ref 校验：操作前 `DOM.getBoxModel`/`DOM.describeNode` 验证 backendNodeId 属当前 document + generation 匹配
- [ ] 观察工具落 agent 工具层：`dogear__browser__observe_page` 底层切内嵌（保留现有返回结构兼容，新增 refs 语义）、新增 `dogear__browser__find`、`dogear__browser__read_text` 切内嵌
- [ ] agent 工具注册表 `registerToolGroup` 同步（`agents/tools/browser-tools.ts`）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
