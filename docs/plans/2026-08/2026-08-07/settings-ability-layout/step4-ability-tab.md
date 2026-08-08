---
step: 4
title: 能力 Tab 前端
status: done
---

## 目标

重写「能力」Tab 组件，以能力域卡片展示所有能力。每个卡片左右分栏：左侧提示词全文 / Skill 索引 + 详情入口，右侧关联工具组列表。Skill 详情走浮窗。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - [step1] 工具描述已精简
  - [step2] 提示词段已补充（记忆段 + 协作段 + 股票 SKILL.md）
  - [step3] Skill 模板源已统一，`listSkillTemplates()` / `getTemplateContent(name)` / `restoreSkillTemplate()` IPC 可用
- 关键 IPC：
  - `client.getRegisteredTools()` → `ToolGroupInfo[]`（server + label + tools[]）
  - `client.getSystemPromptSegments()` → `SystemPromptSegment[]`（key + label + template + triggerDescription）
  - `client.listToolPacks()` → `ToolPack[]`（可选工具包开关）
  - `client.listSkills({ workspaceId })` → 已订阅/自建 Skill 列表
  - `client.getSkillContent(name)` → SKILL.md 全文（step3 新增）
  - `client.subscribeSkillTemplate({ workspacePath, name, overwrite })` → 订阅/恢复
  - `client.setSkillEnabled({ dir, enabled, workspaceId })` → 开关 Skill
- 现有组件参考：`app/settings/ToolsAndPermissionsTab.tsx`（现有工具列表渲染逻辑）、`app/settings/SkillTab.tsx`（现有 Skill 列表 + 开关逻辑）

## 计划改动

### 新建能力域卡片组件

- [ ] `app/settings/AbilityCard.tsx` — 通用能力域卡片：
  - props: `title` / `badge`（常驻/条件挂载/可选）/ `leftContent` / `rightContent` / `actions`
  - 左右分栏布局，窄屏降级为上下堆叠（flex-wrap 或 min-width media query）

### 新建 Skill 详情浮窗组件

- [ ] `app/settings/SkillDetailDialog.tsx` — Skill 全文浮窗：
  - 调 `client.getSkillContent(name)` 获取 SKILL.md 全文
  - 只读 markdown 渲染（或 `<pre>` + 等宽字体）
  - 可滚动，最大高度限制

### 重写能力 Tab

- [ ] `app/settings/AbilityTab.tsx` — 替代原 `ToolsAndPermissionsTab.tsx`：
  - 加载所有数据（getRegisteredTools + getSystemPromptSegments + listToolPacks + listSkills）
  - 按 6 个能力域分组渲染 `AbilityCard`
  - 每个卡片内部组装左右内容

### 能力域组装逻辑

| 能力域 | 左侧组装 | 右侧组装 | 操作 |
|--------|---------|---------|------|
| 记忆系统 | 提示词段 MEMORY_GUIDANCE | dogear-memory 工具组 | 无（常驻） |
| Agent 协作 | 6-7 段提示词（reference/group/group-context/notes/delegation/sub-contract/main-agent） | delegation + group + reference 工具组 | 无（条件挂载） |
| 股票分析 | Skill: stock-analysis（索引 + [详情→] + [恢复]） | stock + analysis + announcement + picking 工具组 | 工具包开关 + Skill 开关 |
| 代码工作流 | 6 个 Skill（各一行：name + desc + [详情→] + [恢复]） | 说明文字「复用基础工具」 | Skill 开关（逐个） |
| 文章 | 说明文字 | article + article-parse 工具组 | 工具包开关 |
| 自定义 Skill | 用户自建 Skill 列表（name + desc + [详情→]） | — | 开关 |

## 实施回填（做完后填）

### 实际改动

**新建 3 个组件**：
- `AbilityCard.tsx` — 左右分栏卡片（md 断点降级纵向），badge 系统（resident/conditional/optional）
- `SkillDetailDialog.tsx` — Radix Dialog 浮窗，调 getSkillContent 获取模板源全文
- `AbilityTab.tsx` — 6 个能力域分组渲染，含 ToolGroupList/PackToggle/SegmentList/SkillRow 子组件

**修改**：
- `page.tsx` — TabsContent tools-and-permissions 内容改为 AbilityTab
- `types/system-prompt.ts` — category 追加 'memory'
- `SystemPromptPreviewTab.tsx` — CATEGORY_META 补 memory 条目（镜像对齐）

验证：lint 0 errors、build:renderer 通过。

### 给下一步的接力棒

- Tab 标签仍叫「工具与权限」（value=tools-and-permissions），Step 5 改为「能力」并重组顺序
- ToolsAndPermissionsTab.tsx 已不被引用但未删，其中的「基础工具权限」section 需提取到 Step 5 的基础设置
- SkillTab.tsx 和 SystemPromptPreviewTab.tsx 仍被原 Tab 引用，Step 5 决定删除/合并
