---
step: 2
title: 前端布局重构 + 详情浮窗
status: pending
---

## 目标

重构 AbilityTab + AbilityCard，外层精简展示（工具平铺 name + shortDescription，md 渲染），完整内容收进详情浮窗；去掉宽度限制；修复 Skill 分类。

## 依赖上下文（接力棒输入）

- Step 1 产出：`ToolInfo` 现有 `{ name, shortDescription, description }`，前端 `client.getRegisteredTools()` 已返回 shortDescription
- `defineTool` 签名是 `(name, shortDescription, description, schema, handler)`
- 前端 AbilityTab.tsx:17 的 `ToolInfo` 接口需同步加 `shortDescription: string`
- AbilityCard.tsx 是左右双栏容器（`leftContent` + `rightContent` props）
- 已有组件：`SkillDetailDialog.tsx`（看 SKILL.md 全文）、`MarkdownRenderer.tsx`
- 当前 Skill 分类常量在 AbilityTab.tsx:55-75

## 计划改动

### 1. 新建工具详情浮窗组件

- [ ] 新建 `app/settings/ToolDetailDialog.tsx`
  - Props: `{ tool: { name, description } | null, onClose: () => void }`
  - Dialog（shadcn）+ 标题显示工具名 + MarkdownRenderer 渲染完整 description
  - 复用 SkillDetailDialog 的交互模式（点击外部/ESC 关闭）

### 2. 新建提示词段详情浮窗组件

- [ ] 新建 `app/settings/SegmentDetailDialog.tsx`
  - Props: `{ segment: SystemPromptSegment | null, onClose: () => void }`
  - Dialog + 标题显示 label + triggerDescription + MarkdownRenderer 渲染 template 全文

### 3. 重构 AbilityTab.tsx

- [ ] :17 `ToolInfo` 接口加 `shortDescription: string`
- [ ] 去掉外层 `max-w-3xl`（:564），改为 `max-w-5xl` 或不限
- [ ] **右栏工具列表改造**：
  - 去掉现有 `ToolGroupList` 的手风琴折叠交互
  - 改为直接平铺：每个工具一行 `工具名（mono）+ shortDescription（md 渲染）`
  - 点击工具行 → 打开 `ToolDetailDialog` 看完整 description
  - 按 server 分组（server 名做小标题，不是可折叠的）
- [ ] **左栏提示词段精简**：
  - 每个 Segment 只显示 `label + triggerDescription`（不展开 template 全文）
  - 点击 → 打开 `SegmentDetailDialog` 看完整模板
- [ ] **左栏 Skill 精简**：
  - Skill 行保持现有 SkillRow 组件（已有精简展示 + 详情按钮）
  - SkillDetailDialog 已有，不动

### 4. Skill 分类修正

- [ ] :55 新增常量 `MEMORY_SKILL_NAMES = ['cross-session-review']`（或直接内联）
- [ ] 记忆系统卡片左栏：除了提示词段，加上 `cross-session-review` 的 SkillRow
- [ ] `customSkills` 过滤逻辑（:541）排除 `cross-session-review`（它会被记忆卡片消费）

### 5. 改造 AbilityCard.tsx

- [ ] 去掉 `max-w-3xl` 相关约束
- [ ] 左右栏比例从 `md:min-w-[40%] md:flex-[2]` / `md:flex-1` 调整为更均衡的比例（如 `flex-1` / `flex-1`，或 `flex-[3]` / `flex-[2]`）
- [ ] 确保窄屏纵向堆叠仍正常

### 6. 引入 MarkdownRenderer

- [ ] AbilityTab.tsx 顶部 import MarkdownRenderer
- [ ] 工具 shortDescription 渲染处用 `<MarkdownRenderer>` 包裹（inline 模式，避免块级渲染过大）
- [ ] 如果 MarkdownRenderer 不支持 inline 模式，shortDescription 用纯文本 + description 才用完整 md 渲染

## 实施回填（做完后填）

### 实际改动
（待填）

### 给下一步的接力棒
（待填）
