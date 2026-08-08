# 能力 Tab 布局优化：精简外层 + 工具 shortDescription + 详情浮窗

**目标**：设置页能力 Tab 的外层卡片只展示精简信息（工具名 + 一句话功能描述），完整内容（工具完整描述、提示词模板全文）收进详情浮窗；修复工具列表挤压、Skill 分类错位、宽度不自适应三个问题。

**架构思路**：
- `ToolDef` 新增 `shortDescription` 字段（面向用户的一句话描述），与现有 `description`（给 agent 的完整说明）分离。前端外层平铺用 shortDescription，浮窗用 description
- AbilityCard 保持左右双栏，但去掉 `max-w-3xl` 宽度限制，让内容自然撑满
- 右栏工具从「折叠的手风琴」改为直接平铺，每个工具一行：`工具名 + shortDescription`，点击弹浮窗看完整 description
- 左栏提示词段也精简展示（名称 + triggerDescription），点击弹浮窗看模板全文
- 所有描述用 MarkdownRenderer 渲染
- `cross-session-review` Skill 归入记忆系统卡片，不再掉进自定义

**排除的选项**：
- 不做纵向单栏（用户明确要左右双栏）
- 不走前端截取 description 第一行（用户明确要维护独立字段）
- 不用 Sheet 右滑出面板（用 Dialog 够了）

**涉及模块**：
- 数据层：`electron/main/agents/pi/tool-adapter.ts`（ToolDef + defineTool）、`electron/main/agents/tools/tool-registry.ts`（ToolInfo + getAllToolGroups）
- 工具文件（53 个 defineTool 调用，13 个文件）：
  - `tools/article-tools.ts`（2）、`tools/category-tools.ts`（5）、`tools/delegation-tools.ts`（6）
  - `tools/digest-tools.ts`（1）、`tools/group-digest-tools.ts`（3）、`tools/group-tools.ts`（3）
  - `tools/memory-tools.ts`（5）、`tools/reference-tools.ts`（3）、`tools/review-tools.ts`（5）
  - `tools/stock-tools.ts`（6）、`tools/stock-analysis-tools.ts`（10）、`tools/stock-announcement-tools.ts`（2）、`tools/stock-picking-tools.ts`（2）
  - `pi-session/search-tools.ts`（2）、`pi-session/skill-loader.ts`（1）
- 前端：`app/settings/AbilityTab.tsx`、`app/settings/AbilityCard.tsx`、新增详情浮窗组件

## 步骤索引

- [x] [Step 1: ToolDef 加 shortDescription 字段](./step1-tooldef-short-description.md) — 数据层改造 + 56 个 defineTool 调用补字段
- [ ] [Step 2: 前端布局重构 + 详情浮窗](./step2-frontend-layout.md) — AbilityTab/AbilityCard 重构 + 新增 ToolDetailDialog + Skill 分类修正
- [ ] [Step 3: 验证与收尾](./step3-verify.md) — lint/build 通过，运行时检查

## 全局决策

- **defineTool 签名**：`defineTool(name, shortDescription, description, schema, handler)`——短描述紧跟 name，使用时一眼看到两个描述字段便于对照
- **shortDescription 原则**：一句话说「这个工具做什么」，面向用户（非 agent），≤20 字中文，不带参数说明/返回值/使用场景
- **description 保持原样**：给 agent 的完整说明不动，只是在前端从外层移到浮窗
- **Markdown 渲染**：外层 shortDescription 和浮窗 description 都用 MarkdownRenderer 渲染（部分 description 含换行/列表）
- **浮窗组件**：新建 `ToolDetailDialog.tsx`（Dialog + 工具名标题 + 完整 description md 渲染）；提示词段详情复用 Dialog 风格但单独建组件或内联
- **Skill 分类修正**：`cross-session-review` 归入记忆系统（它配合 RecallMemory/SaveMemory/ReadReport/WriteReport 使用）
- **宽度**：去掉 `max-w-3xl`，改用 `max-w-5xl` 或不限制，让双栏有足够空间
