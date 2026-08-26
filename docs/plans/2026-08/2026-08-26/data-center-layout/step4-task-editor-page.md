---
step: 4
title: 任务编辑二级页
status: done
---

## 目标
任务编辑从 Dialog 改为 SchedulerPanel 页面内二级页：面包屑工具栏 + 左列大提示词编辑区 + 右列参数栏；新建/编辑同一入口。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step3-history-panel.md] SchedulerPanel 已无历史入口；shadcn Select 可用
- 当前关键文件状态：`app/data-center/scheduler/TaskEditor.tsx` 是 Dialog（`sm:max-w-4xl max-h-[85vh]` 纵向滚动），内部逻辑：`draft` state + `patch` + `validateDraft` + `handleSave`（重叠确认 showConfirm → saveTask → 关闭）全部保留复用；`BuiltinTaskDetailSection` 内含 模型选择 + 全局提示词编辑（保存独立）+ 工具清单展示三块
- 关键决策回顾：左列 `flex-1`（名称 + 提示词 textarea 占满高度，内置任务为 BuiltinTaskDetailSection 提示词块）；右列约 `w-80` 独立滚动（模型 / 工作区 / 工具包或工具清单 / 触发器）；返回/取消直接丢草稿不弹确认；编辑态轮询照常；内置任务「保存提示词/恢复默认」按钮独立于页面级「保存」的语义不变；工作区选择换 shadcn Select

## 计划改动
- [x] `app/data-center/scheduler/SchedulerPanel.tsx`：编辑态切换——`const [editing, setEditing] = useState<'new' | ScheduledTaskWithNextRun | null>(null)`；非 null 时整个 panel 渲染 `TaskEditorPage`（标题/说明区也不显示），「新建任务」和行内「编辑」按钮改为 setEditing；列表态结构不变
- [x] 新建 `app/data-center/scheduler/TaskEditorPage.tsx`：迁移 TaskEditor.tsx 全部状态与保存逻辑，Dialog 外壳换成满高布局：
  - 工具栏：左「← 返回」+「定时计划 / 编辑任务|新建任务」面包屑，右「取消（=返回）+ 保存」
  - 主体 `flex-1 flex min-h-0`：左列（名称输入 + 提示词 textarea `flex-1 min-h-0` 占满）｜右列 `w-80 shrink-0 border-l overflow-y-auto` 参数卡片组
  - 自定义任务右列：模型（ModelSelector）、工作区（shadcn Select）、CustomToolPacksSection、触发器（TriggerListEditor，step5 重构前先原样放入）
  - 内置任务：左列放 BuiltinTaskDetailSection 的提示词块；右列放工作区 Select、模型、工具清单
- [x] `BuiltinTaskDetailSection.tsx` 拆分：导出两个子组件（如 `BuiltinPromptSection` 提示词块 + `BuiltinParamsSection` 模型/工具清单块），加载/保存逻辑原样分配，不改 IPC 调用
- [x] 删除 `TaskEditor.tsx`（Dialog 版）；page.tsx 中 scheduler TabsContent 若残留 h2/描述已在 step2 移入 panel，编辑态由 SchedulerPanel 条件渲染
- [x] 高度模式：SchedulerPanel 列表态整页滚动、编辑态满高度不滚（textarea 自身滚动）——用条件 class 处理 TabsContent 容器或 panel 根元素
- [ ] 验证：新建/编辑自定义与内置任务各一遍（提示词大编辑区手感、右列滚动、校验错误提示、重叠确认、保存后返回列表）；tab 切走再切回草稿仍在；刷新后回到列表——代码级 walkthrough 已做，dev 肉眼验证待主会话

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. page.tsx scheduler TabsContent 加 `forceMount`：radix TabsContent 默认 inactive 卸载，无法兑现设计「切 tab 再切回草稿不丢」；forceMount + 既有 `data-[state=inactive]:hidden` 保活（副作用：其他 tab 时 scheduler 轮询照跑、窗口打开即 loadTasks，轻量可接受）
  2. 高度模式实现方式：把 page.tsx 该 TabsContent 内层滚动层 + max-w-4xl 容器下沉进 SchedulerPanel（列表态 `h-full overflow-y-auto` > `max-w-4xl px-6 py-6`；编辑态 h-full 满高），page.tsx 只留 TabsContent 外壳；其他 tab 容器未动
  3. 内置任务右列在计划三项之外补了触发器卡片：原 Dialog 触发器区 builtin/custom 共用，不补则内置任务无法改触发时间（功能回退）
  4. 两个提示词 textarea 加 `field-sizing-fixed`：shadcn textarea 默认 `field-sizing-content`（高度随内容增长），满高布局需固定 sizing 让 flex 控高度、内容自身滚动
  5. BuiltinPromptSection 说明文案「下方『保存』按钮」改「页面级『保存』按钮」（按钮已移至右上工具栏）
- 改动文件清单：
  - `app/data-center/scheduler/TaskEditorPage.tsx`（新建，245 行）：draft/patch/validateDraft/handleSave（重叠确认）原样迁移；draft 用 useState 初始化函数（挂载即定稿，无需 open effect）
  - `app/data-center/scheduler/BuiltinTaskDetailSection.tsx`（重写，207 行）：导出 `BuiltinPromptSection`（prompt 加载 + 保存/恢复默认，根 `flex-1 min-h-0 flex flex-col` 占满左列）+ `BuiltinParamsSection`（模型 MODEL_IO 即写盘 + 工具清单，输出两个参数卡片）；IPC 调用未改，`getBuiltinTaskDetail` 由两组件各调一次（各自取 prompt / tools）
  - `app/data-center/scheduler/SchedulerPanel.tsx`（223 行）：editing 状态切换 + 列表态滚动容器移入 + 编辑/新建按钮改 setEditing；hooks 全在编辑态分支之前，轮询/分钟 tick 编辑态照常
  - `app/data-center/page.tsx`：scheduler TabsContent 改 `forceMount` + 删内层滚动层与 max-w 容器
  - 删除 `app/data-center/scheduler/TaskEditor.tsx`
- 验证：`bun run lint` 0 errors（72 warnings 为 types/ 存量 any，与 step3 基线一致）；`bunx tsc --noEmit` 全仓 20 个存量错误不变、无 data-center 相关；`bunx vite build` 构建通过；dev 肉眼验证未做（需主会话过一遍验证清单）

### 给下一步的接力棒
- 关键签名 / 数据结构：`TaskEditorPage` props：`{ task: 'new' | ScheduledTaskWithNextRun; workspaces: WorkspaceOption[]; defaultWorkspaceId?: string; onExit: () => void }`；SchedulerPanel `editing: 'new' | ScheduledTaskWithNextRun | null`；`BuiltinPromptSection` / `BuiltinParamsSection` props 均为 `{ builtinId: BuiltinTaskId }`
- 下个 step 该从哪里继续：`app/data-center/scheduler/TriggerListEditor.tsx` 摘要行 + 展开重构（它此刻正被 TaskEditorPage 右列 w-80 卡片内使用，含 4 处原生 select 与 month 网格 `w-48 grid-cols-7`，窄栏下需自适应）
- 待办或已知限制：dev 肉眼验证未做（新建/编辑内置与自定义、错误提示条、重叠确认、tab 切走切回草稿仍在、刷新回列表）；TriggerListEditor 4 处原生 select 归 step5；forceMount 后 scheduler 轮询在其他 tab 也运行（每 10s 一次 refreshActivity IPC）
