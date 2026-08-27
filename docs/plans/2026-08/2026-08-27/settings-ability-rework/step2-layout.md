---
step: 2
title: 设置页布局改造
status: done
---

## 目标

设置页导航从左侧竖排改为顶部下划线 tab（对齐数据中心），各 tab 内容整体居中。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] 主进程数据层已改，前端不受影响可独立进行。
- 当前关键文件状态：
  - `app/settings/page.tsx:240` 附近 — `Tabs defaultValue="behavior" orientation="vertical"`，`TabsList` 是 `flex flex-col ... w-36 border-r` 竖排导航
  - 参照物 `app/data-center/page.tsx` — `TabsList variant="underline" className="justify-start px-6 flex-shrink-0"`，每个 TabsContent `flex-1 mt-0 overflow-hidden data-[state=inactive]:hidden` 内包 `h-full overflow-y-auto` 再放 `mx-auto max-w-*` 内容
- 关键决策回顾：header（返回 + 保存/取消/保存并重启）与 dirty 机制不动；各 tab 宽度沿用现状值。

## 计划改动

- [x] `app/settings/page.tsx`
  - `Tabs` 去掉 `orientation="vertical"`；`TabsList` 改 `variant="underline" className="justify-start px-6 flex-shrink-0"`（照抄 data-center），六个 `TabsTrigger` 加 `variant="underline"`
  - 每个 `TabsContent` 保持 `flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden`，内容容器加 `mx-auto`：
    - behavior：`max-w-2xl` → `max-w-2xl mx-auto`（py-6 px-6 保留）
    - profiles：同上 `max-w-2xl mx-auto`
    - workspace-management：`WorkspaceManagementTab` 自身容器是 `max-w-3xl py-6 px-6`，加 `mx-auto`
    - sub-agent：`SubAgentTab` 自身容器 `max-w-2xl py-6 px-6` 加 `mx-auto`
    - about：`AboutTab` 自身 `max-w-2xl py-6 px-6` 加 `mx-auto`
    - abilities：`AbilityTab` 自身 `w-full py-6 px-6` 本步先改 `max-w-3xl mx-auto py-6 px-6`（内容重构在 Step 3）
  - 左侧导航删除后外层结构从「横排 TabsList + 内容」变为「竖排 TabsList 顶部 + 内容」，确认 flex 布局不塌

## 验证

- `bun run dev` 打开设置窗口：顶部下划线 tab 六项可切换，内容居中，滚动正常
- 各 tab（尤其模型方案的内层 profile Tabs、工作区管理的表格）无布局破损
- dirty 保存流程不受影响

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无。Tabs 容器 className 由 `flex-1 flex overflow-hidden` 改为 data-center 同款 `flex-1 flex flex-col overflow-hidden`（计划虽未逐字写明，但属「外层结构变为竖排」的必要部分）；另按计划改了 WorkspaceManagementTab / SubAgentTab / AboutTab / AbilityTab 四个组件的顶层容器（计划正文明确列出）。
- 改动文件清单：
  - `app/settings/page.tsx` — Tabs 去 orientation，TabsList/TabsTrigger 改 underline variant；behavior、profiles 内容容器加 mx-auto
  - `app/settings/WorkspaceManagementTab.tsx` — 容器 `max-w-3xl mx-auto py-6 px-6 space-y-8`
  - `app/settings/SubAgentTab.tsx` — 容器 `max-w-2xl mx-auto py-6 px-6 space-y-4`
  - `app/settings/AboutTab.tsx` — 容器 `max-w-2xl mx-auto py-6 px-6`
  - `app/settings/AbilityTab.tsx` — 容器 `w-full py-6 px-6 space-y-6` → `max-w-3xl mx-auto py-6 px-6 space-y-6`

### 给下一步的接力棒
- 关键签名 / 数据结构：AbilityTab 顶层容器现为 `max-w-3xl mx-auto py-6 px-6 space-y-6`（app/settings/AbilityTab.tsx:651），内部逻辑未动，Step 3 重构内容时可直接替换内部结构。
- 下个 step 该从哪里继续：Step 3 从 `app/settings/AbilityTab.tsx` 的主 return 开始重构能力域内容；布局壳（顶部 underline tab + 居中容器）已就绪。
- 待办或已知限制：无 GUI 环境，未做人工目视验证（lint 0 error、vite build 通过）；`bunx tsc --noEmit` 报的 AboutTab.tsx:54 等错误均为预存问题，与本 step 无关。
