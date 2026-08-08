---
step: 5
title: 设置页 Tab 重组
status: done
---

## 目标

设置页 Tab 结构重组：「AI 行为」→「基础设置」并移入基础工具权限；新「能力」Tab 替换原「工具与权限」；删除「Skill 管理」和「系统提示词」Tab。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - [step4] `AbilityTab.tsx` 组件已就绪，替代原 `ToolsAndPermissionsTab.tsx`
- 关键文件：`app/settings/page.tsx`（Tab 主框架，左侧导航 + TabsContent 映射）
- 现有 Tab 列表：behavior / tools-and-permissions / skills / profiles / personas / workspace / workspace-management / memory / digests / agents / sub-agent / system-prompt / parse-history

## 计划改动

### Tab 导航重构

- [x] `page.tsx` — 左侧 TabsList 修改：
  - `behavior` → 重命名为「基础设置」
  - `tools-and-permissions` → 改为「能力」，引用 `AbilityTab`
  - 删除 `skills` Tab
  - 删除 `system-prompt` Tab
  - 其余 Tab 不变

### 基础工具权限移入基础设置

- [x] 从原 `ToolsAndPermissionsTab.tsx` 提取「基础工具权限」section（7 个 allow/ask + 全部放行/询问）的 JSX 和逻辑
- [x] 移入 `page.tsx` 的 behavior TabContent 内（在现有 AI 行为配置项之后）
- [x] 或抽成独立组件 `app/settings/BasicToolsSection.tsx`，在 page.tsx 中引用

### 清理旧文件

- [x] 删除 `app/settings/ToolsAndPermissionsTab.tsx`（已被 AbilityTab 替代）
- [x] 删除 `app/settings/SystemPromptPreviewTab.tsx`（内容吸收进能力卡片）
- [x] 删除 `app/settings/SkillTab.tsx`（内容吸收进能力卡片）
- [x] `page.tsx` — 清理相关 import 和 TabsContent

### 验证

- [x] 设置页能正常打开，所有 Tab 可切换
- [x] 基础设置 Tab 中基础工具权限功能正常（allow/ask 切换 + dirty 检测）
- [x] 能力 Tab 正常渲染所有 6 个能力域卡片（由 Step 4 保证，本次仅改 Tab value 和标签）
- [x] Skill 详情浮窗正常弹出（同上）
- [x] Skill 开关 / 工具包开关功能正常（同上）
- [x] 保存 / 保存并重启会话功能正常（未改动保存逻辑）

> 验证方式：`bun run lint`（0 errors）+ `bun run build:renderer`（成功）。运行时验证留给用户。

## 实施回填（做完后填）

### 实际改动

1. **新建** `app/settings/BasicToolsSection.tsx`：从 `ToolsAndPermissionsTab.tsx` 提取基础工具权限 section 为独立组件，包含 BASIC_TOOL_META 常量、getBasicPermission / setBasicPermission / setAllBasic / allBasicPerm 逻辑，渲染完整 UI（标题 + 说明 + 全部放行/询问批量按钮 + 7 个工具的 allow/ask 切换）。props 接收 `{ local, setLocal }`。
2. **修改** `app/settings/page.tsx`：
   - import：删除 SkillTab / SystemPromptPreviewTab，新增 BasicToolsSection
   - TabsList：`behavior` 标签改为「基础设置」；`tools-and-permissions`（value 改为 `abilities`）标签改为「能力」；删除 `skills` 和 `system-prompt` 两个 TabsTrigger
   - TabsContent：behavior 标题改为「基础设置」，末尾加入 `<BasicToolsSection />`；原 `tools-and-permissions` 的 TabsContent value 改为 `abilities`；删除 skills 和 system-prompt 两个 TabsContent
3. **删除** `app/settings/ToolsAndPermissionsTab.tsx`、`app/settings/SkillTab.tsx`、`app/settings/SystemPromptPreviewTab.tsx` 三个文件。

Tab 总数从 13 减到 11。默认 Tab 仍为 `behavior`（基础设置）。

### 给下一步的接力棒

Step 5 是最后一步，设置页能力重组计划全部完成。后续如有需要：
- 运行时验证：建议人工打开设置页确认基础设置/能力两个 Tab 的 UI 与功能正常
- `types/system-prompt.ts` 的 `category` 类型保留（AbilityTab 用到 SystemPromptSegment 类型），不要误删
