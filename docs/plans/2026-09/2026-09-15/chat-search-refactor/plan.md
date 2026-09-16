# 会话内搜索修缮（第二轮）实施计划

**目标**：修复搜索的流式重置跳变、编号错位跳错、特殊卡无反馈三个缺陷，搜索框挪到输入框上方，命中每一跳都可见。

**架构思路**：两层搜索域（详见 [design.md](./design.md)）——精确域词级 mark，块级域跳转+描边+「命中 n 处」徽标；索引端与渲染端口径对齐（剥离代码块/注释），不碰渲染链路。

**涉及模块**：`useMessageSearch.ts` / `AgentChat.tsx` / `MessageItem.tsx` / `ContentBlockItem.tsx` / 四张特殊卡 / `ToolBlock.tsx` / `SearchBar.tsx`

## 步骤索引

- [x] [Step 1: 搜索索引稳定性与口径对齐](./step1-index-stability.md) — 重扫保持激活位置 + 剥离代码块/html 注释
- [ ] [Step 2: 工具块统一块级命中反馈](./step2-tool-block-feedback.md) — 特殊卡补描边 + 全部工具卡「命中 n 处」徽标
- [ ] [Step 3: 搜索框挪位与 Minimap 常驻](./step3-searchbar-position.md) — 悬浮输入框正上方

## 全局决策

- 搜索域准入原则：用户能到达的内容才可搜。text 块索引剥离 fenced 代码块（``` 围栏，含 ~~~）与 html 注释；行内 code 保留（渲染端有高亮）；tool_use 三子域（toolName/input/output）全量扫描不剥离
- `SearchMatch` 的 id 结构 `${messageId}-${blockIndex}-${hit}` 不变；mark 激活匹配机制不变
- 块级反馈视觉统一用 `outline-1 outline-offset-2 outline-sky-400/70 bg-sky-50/60 dark:bg-sky-950/30`（与 `CollapsibleBlock.tsx:72` 现有 highlighted 同款）
- 徽标数字 `activeBlockMatchCount` 只在块为当前激活块时显示，由 AgentChat 从 matches 按 `messageId+blockIndex` 分组算出
- 三步串行执行（step2/step3 都动 AgentChat.tsx，避免并行冲突）；每步完成即 `bun run lint` + 手动验收后回填
