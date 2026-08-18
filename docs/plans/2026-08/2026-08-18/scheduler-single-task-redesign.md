# 定时计划任务化改造设计

**背景**：现有模型是「计划 = 任务序列 + 触发器列表（8 种，含链式）」，任务条目只显示名字和工作区。用户反馈：链式没必要、一条就该是一个单纯的任务、任务要能看到提示词和工具、内置任务应做成可改不可删的预置条目。

**目标**：
1. 编辑对话框放大（672px → ~896px，加高；执行历史侧滑不动）
2. 模型简化：一行 = 一个任务（自带触发器/开关/下次运行），删除任务序列与链式触发器
3. 任务详情展示提示词 + 工具列表，内置任务同样展示
4. 内置任务 = 4 条常驻预置条目（方案 A）：提示词可改（写全局磁盘模板）、可恢复默认、不可删除
5. 自定义任务工具包开关（方案 a）：默认跟随工作区，可任务级覆盖

## 架构

### 数据模型（types/scheduler.ts）

`Plan` 重构为单任务结构（保留文件名 plans.json 与历史字段兼容）：

```ts
interface TaskBase {
  id: string;
  name: string;
  enabled: boolean;
  triggers: Trigger[];
  workspaceId?: string;   // builtin: undefined = 全部工作区；custom: 必填
  runState?: TaskRunState;
  createdAt: number;
  updatedAt: number;
}
interface BuiltinScheduledTask extends TaskBase { kind: 'builtin'; builtinId: BuiltinTaskId }
interface CustomScheduledTask extends TaskBase {
  kind: 'custom';
  prompt: string;
  modelSelection?: ModelSelection;
  toolPacksOverride?: string[];   // undefined = 跟随工作区 enabledToolPacks
}
type ScheduledTask = BuiltinScheduledTask | CustomScheduledTask;
```

- `Trigger` 删除 `on_plan_done` 变体（7 种剩余）
- `PlanRunState` → `TaskRunState`：去 `pendingTasks`，保留 `cursor`/`cursorStartedAt`（单任务中断续跑）

**排除的选项**：Plan 保留单 task 字段的半改方案（模型含糊）；内置任务模板+实例制方案 B（失去开箱即用预置条目，且「不能删除」约束落不到列表条目上）。

### 内置任务常驻（方案 A）

- `plan-store.ts` seed：启动时确保 4 条 builtin 任务存在，缺则补建：
  - `group_digest`、`review`：保持现状「夜间维护」行为（触发器 = 窗口 03:00-05:00 / 应用启动 / 关会话，enabled）
  - `categorize`、`categorize_organize`：预置但 disabled、无触发器
- 删除保护：tipc 层对 builtin 任务拒绝 delete；内置任务 name 不可改（展示标签固定）
- 同一内置任务全局唯一一条；不可派生副本

### 提示词编辑

- 内置任务条目**不存 prompt**，编辑直接读写各管线的全局磁盘模板：
  - `<configDir>/group-digest-prompt.md`、`categorize-prompt.md`（机制已存在，含播种兜底）
  - review / categorize_organize 的模板磁盘化在实施时检查补齐（目前 review-skill-service.ts / organize-prompt.ts）
- 「恢复默认」= 写回代码内 `DEFAULT_XXX_PROMPT`
- 新增 IPC：`getBuiltinTaskDetail`（prompt 当前值 + 默认值 + 只读工具清单）、`saveBuiltinPrompt`、`resetBuiltinPrompt`
- 管线读取逻辑不动（继续 `loadXxxPrompt`）；改提示词影响所有触发入口（组卡页手动触发等），这是有意行为

### 工具列表展示与开关

- 内置任务：只读工具清单（各管线专用工具，代码内静态定义展示文案，如组卡提炼的 ReadGroupDigest/CleanTranscript/SaveGroupDigest/SaveGroupBackground/ListGroupFiles）
- 自定义任务分两组：
  - 基础工具（只读恒装）：文件 Read/Write/Edit、Glob/Grep、记忆 Recall/Save/Forget、复盘报告读写
  - 可选工具包（开关）：article / stock-quote / stock-analysis / stock-announcement / stock-picking
  - 初始态 = 跟随工作区（开关显示工作区当前值 + 「跟随工作区」标识）；一旦拨动任一开关 → `toolPacksOverride` 生效，完全由任务决定；提供「重置为跟随工作区」清掉 override
- `custom-agent-tools.ts` 的 `buildCustomToolSet` 加 override 参数，有值时替代 `readEnabledToolPacks`

### UI

- `SchedulerPanel`：一行 = 一个任务（名称、触发器摘要、下次运行、开关、编辑/运行；内置无删除按钮）
- 编辑对话框（原 PlanEditor 改造为 TaskEditor）：`sm:max-w-4xl` 加高；内置区 = 提示词编辑（标注「全局模板」）+ 恢复默认 + 只读工具清单 + 工作区 + 触发器；自定义区 = 名称 + 提示词 + 模型 + 工具开关 + 工作区 + 触发器
- 新建入口只建自定义任务（TaskListEditor 的「添加内置任务」下拉删除）
- HistorySheet 不放大，「按计划筛选」文案改「按任务」

## 数据迁移（plan-store 读时一次性升级）

- plans.json 加 `version` 字段区分新旧
- 旧 plan（tasks 数组）→ 每任务一条新任务：
  - id 沿用原 `task.id`（历史记录 taskId 可对上）
  - name：单任务计划保留 plan.name；多任务计划取 `${plan.name}·${任务名}`
  - 触发器复制到每条；`on_plan_done` 触发器直接删除
  - 旧 `runState` 丢弃（中断中的计划不续跑，可手动运行）
- 旧空计划（无任务）丢弃
- 运行历史文件不动：旧条目靠冗余 `planName`/`taskName` 展示，筛选下拉只列现存任务

## 执行层

- `scheduler-service.ts`：删 `handlePlanDone` 链式逻辑与 `plan_done` 监听
- `runtime/plan-runner.ts`：单任务执行，去任务队列推进；保留 cursor 断点（中断后下次触发重跑该任务）与 stop 语义
- `runtime/task-executor.ts`：builtin 路径不动；custom 路径传 `toolPacksOverride`
- 历史条目 `planId` = 任务 id、`planName` = 任务名，`taskId`/`taskName` 字段冗余保留（旧历史兼容）

## 模块边界

| 文件 | 改动 |
|------|------|
| `types/scheduler.ts` | 模型重定义（ScheduledTask、Trigger 瘦身、TaskRunState） |
| `electron/main/services/scheduler/plan-store.ts` | seed 内置任务、版本迁移 |
| `electron/main/services/scheduler/plan-validate.ts` | 单任务校验 |
| `electron/main/services/scheduler/runtime/plan-runner.ts` | 单任务执行 + 断点 |
| `electron/main/services/scheduler/runtime/task-executor.ts` | custom 传 override |
| `electron/main/services/scheduler/custom-agent-tools.ts` | override 参数 |
| `electron/main/services/scheduler/scheduler-service.ts` | 去链式 |
| `electron/main/services/memory/*-prompt.ts` | review/organize 模板磁盘化（若缺） |
| `electron/main/tipc/scheduler.ts` | IPC 改造 + 内置 prompt 三件套 |
| `stores/scheduler-store.ts` | 对接新模型 |
| `app/settings/scheduler/SchedulerPanel.tsx` | 行 = 任务 |
| `app/settings/scheduler/TaskEditor.tsx`（新，替代 PlanEditor） | 大编辑器 + 工具/提示词区 |
| `app/settings/scheduler/TaskListEditor.tsx` | 删除 |
| `app/settings/scheduler/TriggerListEditor.tsx` | 去链式选项 |
| `app/settings/scheduler/utils.ts`、`app/settings/page.tsx` | 描述文案 |

## 错误处理 / 边界

- 模板文件被外部删除/改坏：`loadXxxPrompt` 播种逻辑兜底（已有机制，review/organize 补齐时同样带哨兵）
- 内置任务 delete 请求：tipc 返回错误，UI 不渲染删除按钮
- `toolPacksOverride` 中包含代码演进后已不存在的包名：组装时过滤未知包
- 迁移时 plans.json 损坏：safeJsonRead 兜底返回空，seed 重建内置任务

## 未决问题（实施时处理）

- review / categorize_organize 提示词模板的磁盘读写能力是否已齐（group-digest / categorize 已确认有）
- 4 条内置任务的展示用工具清单文案（从各管线的工具注册处整理静态清单）
- `agents/task-types.ts` 中 CATEGORIZE_SESSION 等对 category-trigger 队列的引用是否受 seed 语义变化影响（预计无关，走查确认）
