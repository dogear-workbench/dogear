---
step: 4
title: 视图合并 + 归档浮窗
status: done
---

## 目标

去掉三 tab 合并为单一视图（手动文件夹 → 近期 → 智能分类）；ArchiveSection 改 Popover 浮窗。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - [step1] 后端 deriveGroupTitle 已简化
  - [step2] 前端 deriveGroupTitle 已简化，AppearanceBadge 已删除
  - [step3] 自动归档已接入，group-store.load 会触发归档扫描
- 当前代码状态：
  - `ConversationList.tsx` 有 `view` state + `<ViewTabs value={view} onChange={setView} />`，根据 view 切换 ManualSection / SmartSection / TimeSection
  - `SmartSection.tsx` 内部首行渲染 `<RecentVirtualGroup />`，然后渲染分类列表
  - `ArchiveSection.tsx` 在 ScrollArea 外部底部，用 collapsed state 控制展开/收起，展开时渲染 GroupCard 列表
  - 项目有 shadcn Popover 组件（`@/components/ui/popover`）

## 计划改动

- [ ] `components/ConversationList.tsx`：
  - 删除 `useState<ListView>` view state
  - 删除 ViewTabs import 和渲染
  - 删除 TimeSection import
  - 将条件渲染改为固定顺序：`<ManualSection>` → `<RecentVirtualGroup>` → `<SmartSection>`
  - 删除 `import type { ListView }`
- [ ] 删除 `components/conversation-list/ViewTabs.tsx`
- [ ] 删除 `components/conversation-list/TimeSection.tsx`
- [ ] `components/conversation-list/SmartSection.tsx`：删除 `<RecentVirtualGroup />` 的 import 和渲染（约第 33 行）
- [ ] `components/conversation-list/ArchiveSection.tsx`：改为 Popover 浮窗：
  - 底部保留「已归档话题」按钮（带图标 + 数量），用 Popover 触发
  - PopoverContent 内用 ScrollArea 限高（如 max-h-80），渲染归档 GroupCard 列表
  - 删除 collapsed state，改用 Popover 的 open/onOpenChange
  - 保持现有的 useEffect 加载归档列表逻辑

## 实施回填

### 实际改动

5 条计划改动全部实施 + 清理死代码 TIME_BUCKET_THRESHOLD_MS。`bun run build:electron` 编译通过。

1. **ConversationList.tsx** — 删除 view state / ViewTabs / TimeSection，改为固定顺序 ManualSection → RecentVirtualGroup → SmartSection
2. **删除 ViewTabs.tsx** 和 **TimeSection.tsx**
3. **SmartSection.tsx** — 删除 RecentVirtualGroup 的 import 和渲染（移至 ConversationList）
4. **ArchiveSection.tsx** — 改为 Popover 浮窗（side="top" 向上弹出，ScrollArea max-h-80 限高，删除 collapsed state）
5. **清理** — utils.ts 中 TIME_BUCKET_THRESHOLD_MS / TIME_BUCKET_DAYS 死常量及注释（删除 TimeSection 后无用）

### 给下一步的接力棒

全部 4 个 step 已完成。对话列表视图合并为单一滚动视图（手动文件夹 → 近期 → 智能分类），归档改为 Popover 浮窗。

后续可考虑：
- 更新 docs/codebase-map.md（utils.ts 索引中 TIME_BUCKET_THRESHOLD_MS 和 useAppearanceCount 已删除）
- 前端测试验证视图合并后的交互体验
