---
step: 1
title: 搜索索引稳定性与口径对齐
status: done
---

## 目标
流式输出期间搜索不再跳回第一个；索引与渲染端计数口径对齐，消除 text 块内编号错位。

## 依赖上下文（接力棒输入）
- 无前置 step。关键文件：`components/agent-chat/hooks/useMessageSearch.ts`
- 现状：重扫 effect（`useMessageSearch.ts:63` 附近）结尾无条件 `setMatches(result); setActiveIndex(0)`，deps 为 `[query, stableHistory, getLiveTail]`；流式中 stableHistory 引用每次提升都变 → 重置跳顶
- 现状：text/thinking 块扫描 `block.content` 原文（`useMessageSearch.ts:74` 附近）；渲染端 `MarkdownRenderer` 的 code 覆盖只对非 hljs 结构的 string 子节点插 mark，块级代码内命中渲染不出 → 编号错位
- 设计依据：[design.md](./design.md)「数据流」一节的重扫保持位置策略

## 计划改动
- [x] `useMessageSearch.ts`：扫描 text 块前剥离 fenced 代码块与 html 注释（新增纯函数，如 `stripUnsearchable(text)`：去掉 ```` ``` ```` / `~~~` 围栏块与 `<!-- -->`；行内 code 保留）。thinking 块、用户消息、tool_use 三子域不剥离
- [x] `useMessageSearch.ts`：重扫后不再无条件 `setActiveIndex(0)`——用 ref 记上次 query；query 变化 → 重置 0；query 不变（仅 deps 变化重扫）→ 按上次 activeMatchId 在新 matches 中找同 id，找不到则找同 `messageId+blockIndex` 的首个，再找不到 clamp 到 `min(旧 index, 新长度-1)`
- [ ] 手动验收：流式回复进行中搜索关键词，观察不再自动跳顶；输入新词回到第 1 个；回答里代码块内的关键词不再计入计数（需 UI 环境，待用户验收）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无结构性差异。两处实现细节补充：① `stripUnsearchable` 剥离处替换为 `\n` 而非空串，避免前后文本拼接产生跨界假匹配；② 未闭合围栏/注释（流式中途）也剥到文本末尾，与 remark 渲染口径一致；③ 恢复逻辑的快照 ref 记录完整 `SearchMatch` 对象而非仅 id 字符串（id 含 `-` 不可靠解析出 messageId+blockIndex）
- 改动文件清单：`components/agent-chat/hooks/useMessageSearch.ts`（唯一改动文件）
- 验证：`bun run lint` 0 errors（83 个既有 warnings 均为 no-explicit-any，非本次引入）；`tsc --noEmit` 通过；`stripUnsearchable` 纯函数 10 场景单测全过（闭合/未闭合围栏、~~~、闭合/未闭合注释、行内 code 保留、闭合比开栏长、无拼接假匹配、普通文本不变）
- 待人工验收：流式中搜索不跳顶、输入新词回到第 1 个、代码块内关键词不计入计数（需 UI 环境）

### 给下一步的接力棒
- 关键签名 / 数据结构：新增模块内纯函数 `stripUnsearchable(text: string): string`（不导出）；hook 内新增 `lastQueryRef`（上次 query）与 `activeSnapshotRef`（`{ index, match }`，由同步 effect 维护）
- 下个 step 该从哪里继续：step2（工具块命中反馈）动 `AgentChat.tsx`，从 matches 按 `messageId+blockIndex` 分组算 `activeBlockMatchCount` 下传；`SearchMatch` 结构与 id 格式未变，块级域判定仍用 `isBlockActive()` 前缀匹配
- 待办或已知限制：① 缩进围栏（列表内缩进的 ```/~~~）与缩进代码块不剥离（design.md 已拍板覆盖主路径，残余由块级 fallback 兑底）；② AI 消息无 contentBlocks 时的降级路径（blockIndex=-2 搜 content 原文）未剥离，与计划范围一致；③ thinking 块按拍板不剥离，若 thinking 内有代码块其块内编号错位仍存在
