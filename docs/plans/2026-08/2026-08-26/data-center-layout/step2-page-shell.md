---
step: 2
title: 页面骨架重构
status: pending
---

## 目标
数据中心页面改顶部下划线导航（6 tab）、删掉重复的页面内 header、工作区筛选下沉到四个 panel、执行历史 tab 先挂占位面板。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-ui-components.md] tabs 支持 `variant="underline"`；shadcn Select 可用
- 当前关键文件状态：`app/data-center/page.tsx` 现为 header（h1 + 工作区原生 select）+ 左侧 `w-36` 竖排 TabsList + 5 个 TabsContent；`workspaceId`/`workspaces` 以 props 下传各 panel
- 关键决策回顾：系统标题栏已显示「数据中心」（electron/main/index.ts:256 `title: '数据中心'`），页面内 h1 删除；workspaces 列表仍由 page.tsx 加载下传，只有筛选状态下沉；`'all'` 语义保留

## 计划改动
- [ ] `app/data-center/page.tsx`：
  - 删 header（h1 + 工作区 select），页面结构变为：顶部一行 `TabsList variant="underline"`（6 项：组卡 digests / 用量 usage / 定时计划 scheduler / 执行历史 history / 解析历史 parse-history / 记忆 memory），下接 TabsContent 占满剩余高度
  - `defaultValue="digests"` 保持；TabsContent 容器类名从整页滚动改为 `flex-1 overflow-hidden`，滚动交由各 panel 内部处理（现有 panel 外层多为 `max-w-*` + 内容流，需给各 TabsContent 内容套一层 `h-full overflow-y-auto`，编辑态满高度布局在 step4 处理）
  - 保留 `workspaces` 加载与下传；删除自身 `workspaceId` 状态
- [ ] `app/data-center/digests-panel.tsx` / `usage-panel.tsx` / `memory-section.tsx`：props 中 `workspaceId` 改为内部 `useState<string>('all')`，panel 标题行右侧放 shadcn Select 工作区筛选（「全部工作区」+ 各工作区），选项数据仍来自 `workspaces` props
- [ ] `app/data-center/scheduler/SchedulerPanel.tsx`：同样内置工作区 Select（列表态工具栏行，「新建任务」按钮同排或右侧）；`visibleTasks` 过滤逻辑照搬（`workspaceId === 'all'` 或匹配 `t.workspaceId`）
- [ ] 新建 `app/data-center/history-panel.tsx` 占位（step3 填充）：先渲染「执行历史」标题 + 空态文案，挂到 `history` tab
- [ ] `app/data-center/page.tsx` 各 TabsContent 里现存的 `h2` 标题 + 描述段落：组卡/定时计划/记忆的移入对应 panel 顶部（与工作区筛选同区），保持现有文案
- [ ] 验证：`bun run dev:renderer` 逐 tab 检查——筛选器工作、各 panel 滚动正常、设置页/股票页 tabs 无回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：各 panel 新 props 签名（如 `DigestsPanel({ workspaces }: { workspaces: Workspace[] })`）；page.tsx 的 TabsContent 高度模式约定
- 下个 step 该从哪里继续：`app/data-center/scheduler/HistorySheet.tsx` 迁移改造为 `history-panel.tsx`
- 待办或已知限制：
