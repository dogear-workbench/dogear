---
step: 4
title: 任务编辑器完整化
status: pending
---

## 目标

TaskEditor 补全两块：内置任务的提示词编辑（读写磁盘模板 + 恢复默认 + 只读工具清单）、自定义任务的工具包开关（跟随工作区 / 任务级覆盖 / 重置）。完成标志：编辑器展示提示词与工具列表，开关改动经保存后生效于 `buildCustomToolSet` 组装。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-frontend-list-editor-base.md] TaskEditor 骨架已就位（builtin/custom 两分支），对话框已是 sm:max-w-4xl
- 当前关键文件状态：
  - IPC：`getBuiltinTaskDetail({builtinId}) → {prompt, tools}` / `saveBuiltinPrompt({builtinId, prompt})` / `resetBuiltinPrompt({builtinId}) → {ok, prompt}`
  - `types/scheduler.ts`：CustomScheduledTask 已有 `toolPacksOverride?: string[]`（undefined = 跟随工作区）
  - 工作区 enabledToolPacks 读取入口：实施时 grep 设置页 ToolPacksTab 的数据源 IPC（与 `custom-agent-tools.ts` 的 `readEnabledToolPacks` 同源 `<configDir>/workspaces/<id>/config.json`），复用现成路由；没有暴露给渲染层就加一个轻量路由（如 `getWorkspaceToolPacks`）
- 关键决策回顾：基础工具组只读恒装（文件 Read/Write/Edit、Glob/Grep、记忆 Recall/Save/Forget、复盘报告读写）；可选包 5 个开关；未拨动任何开关前 = 跟随工作区（显示工作区当前值 + 标识）；拨动后 override 生效；「重置为跟随工作区」清掉 override；内置提示词标注「全局模板，影响所有触发入口」

## 计划改动

### 1. `TaskEditor.tsx` — 内置任务分支补提示词与工具区

- [ ] 打开内置任务编辑时调 `getBuiltinTaskDetail` 加载 prompt + tools
- [ ] 提示词 Textarea（标注「全局模板」+ 影响范围说明）；「保存提示词」按钮独立于任务保存（调 `saveBuiltinPrompt`），或与任务保存合并——采用独立按钮，避免与触发器保存耦合
- [ ] 「恢复默认」按钮：confirm 后调 `resetBuiltinPrompt`，成功后用返回的 prompt 刷新编辑区
- [ ] 工具清单只读展示（tools 数组，Badge 列表）

### 2. `TaskEditor.tsx` — 自定义任务分支补工具区

- [ ] 基础工具组：只读 Badge/文本展示（静态文案，不必走 IPC）
- [ ] 可选工具包 5 个开关：状态来源 = `toolPacksOverride ?? 工作区enabledToolPacks`；工作区值在打开编辑器时按 task.workspaceId 拉取
- [ ] 「跟随工作区」标识：override === undefined 时显示；任一开关拨动 → 本地草稿记 override 数组；「重置为跟随工作区」→ 草稿 override 置 undefined
- [ ] 保存时 `toolPacksOverride` 随任务落库

### 3. 工作区工具包读取

- [ ] 复用或新增渲染层获取工作区 enabledToolPacks 的入口（见依赖上下文），TaskEditor 内部消费

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
