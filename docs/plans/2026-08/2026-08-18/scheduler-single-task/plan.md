# 定时计划任务化改造 实施计划

**目标**：把「计划 = 任务序列 + 触发器」模型简化为「一行 = 一个任务」（内置任务常驻可改不可删、提示词/工具可视可配），删除链式触发器与任务队列。

**架构思路**：设计见 `../scheduler-single-task-redesign.md`。主进程与前端各有一份类型定义（现状双份手维护，保持现状不合并）；`plans.json` 读时一次性迁移 + version 标记；内置任务条目不存 prompt，编辑直接读写各管线已有的全局磁盘模板（group-digest / categorize 已有机制，review / organize 补齐）。排除了「Plan 保留单 task 字段」半改方案与「模板+实例」方案（理由见设计文档）。

**涉及模块**：`types/scheduler.ts`、`electron/main/services/scheduler/**`、`electron/main/tipc/scheduler.ts`、`electron/main/agents/task-types.ts`、`stores/scheduler-store.ts`、`app/settings/scheduler/**`、`app/settings/page.tsx`

## 步骤索引

- [x] [Step 1: 主进程模型迁移全链路](./step1-main-model-migration.md) — 类型重定义、plans.json 迁移与内置 seed、单任务执行、去链式、既有 IPC 适配
- [x] [Step 2: 内置任务提示词与工具清单 IPC](./step2-builtin-prompt-tools.md) — review/organize 模板磁盘化补齐、内置任务元数据、三个新 IPC 路由
- [x] [Step 3: 前端列表与基础编辑](./step3-frontend-list-editor-base.md) — 渲染层类型、store、列表行=任务、编辑器骨架、触发器去链式
- [x] [Step 4: 任务编辑器完整化](./step4-frontend-editor-full.md) — 内置提示词编辑/恢复默认/只读工具清单、自定义任务工具包开关
- [ ] [Step 5: 回归走查与文档同步](./step5-regression-docsync.md) — dev 走查迁移/常驻/工具 override 生效、doc-sync

## 全局决策

跨步骤约定，执行任何 step 前先读本节：

### 类型双份同步

`types/scheduler.ts`（渲染层）与 `electron/main/services/scheduler/types.ts`（主进程）结构保持一致，两边手改同步，不引入共享模块。新模型核心：

```ts
interface TaskBase {
  id: string; name: string; enabled: boolean;
  triggers: Trigger[];
  workspaceId?: string;   // builtin: undefined = 全部工作区；custom: 必填
  runState?: TaskRunState;
  createdAt: number; updatedAt: number;
}
interface BuiltinScheduledTask extends TaskBase { kind: 'builtin'; builtinId: BuiltinTaskId }
interface CustomScheduledTask extends TaskBase {
  kind: 'custom'; prompt: string;
  modelSelection?: ModelSelection;
  toolPacksOverride?: string[];   // undefined = 跟随工作区
}
type ScheduledTask = BuiltinScheduledTask | CustomScheduledTask;
type TaskRunState = { cursorStartedAt?: number };   // cursor 即任务自身，不再存队列
```

- `Trigger` 删除 `on_plan_done` 变体（剩余 7 种）
- `SchedulerRunningPlan` 改为 `{ taskId: string; taskName: string; startedAt: number }`
- `RunHistoryEntry` 字段名不动：新条目只填 `planId`（= 任务 id）、`planName`（= 任务名），不填 `taskId`/`taskName`

### 内置任务

- 固定 4 条：`group_digest` / `review` / `categorize` / `categorize_organize`，label 为 组卡提炼 / 复盘报告 / 智能分类 / 分类整理
- seed 固定 id：`builtin-${builtinId}`；补建判定按「kind=builtin 且 builtinId 相同的任务是否已存在」（迁移先跑，旧计划拆出的内置任务不会被重复补建）
- seed 默认配置：`group_digest`、`review` 带夜间维护触发器（窗口 03:00-05:00 / 应用启动 / 关会话）且 enabled；`categorize`、`categorize_organize` disabled 无触发器
- builtin 任务：name 不可改（validate 拒绝）、delete 被 tipc 拒绝；可改 workspaceId / triggers / enabled
- 提示词不存任务条目上，编辑读写 `<configDir>/<xxx>-prompt.md`，恢复默认写回代码内 `DEFAULT_XXX_PROMPT`

### plans.json 迁移（loadPlans 读时一次性完成并回写）

- 结构探测判旧（元素含 `tasks` 数组 = 旧格式），迁移后写入 `version: 2` 标记
- 旧 plan → 每任务一条新任务：id 沿用原 `task.id`；name 单任务计划保留 `plan.name`、多任务计划取 `${plan.name}·${任务显示名}`；triggers 深拷贝到每条；`on_plan_done` 触发器删除；`runState` 丢弃；无任务的空 plan 丢弃
- 迁移后跑 seed 幂等补建
- 历史文件 `run-history` 不迁移：旧条目靠冗余 `planName` 展示，筛选下拉只列现存任务

### IPC 路由改名映射

| 旧 | 新 |
|----|----|
| `listPlans` | `listTasks`（返回 `{ tasks: ScheduledTaskWithNextRun[] }`） |
| `savePlan` | `saveTask` |
| `deletePlan` | `deleteTask`（builtin 拒绝） |
| `setPlanEnabled` | `setTaskEnabled` |
| `runPlanNow` | `runTaskNow` |
| `listRunHistory` | 不改名（`planId` 参数语义 = 任务 id） |
| `getSchedulerActivity` | 不改名 |

新增（Step 2）：`getBuiltinTaskDetail` / `saveBuiltinPrompt` / `resetBuiltinPrompt`

### 工具包

- 可选包集合：`article` / `stock-quote` / `stock-analysis` / `stock-announcement` / `stock-picking`，组装时过滤未知包名
- `custom-agent-tools.ts` 的 `buildCustomToolSet` 加 override 参数：有值时完全替代 `readEnabledToolPacks` 的结果
- 传递链：任务 `toolPacksOverride` → `CustomAgentTaskPayload`（`agents/task-types.ts` 加字段）→ worker 侧调用 `buildCustomToolSet` 处

### 主进程改动需 `bun run build:electron` 后才对 Electron 生效；前端 Vite 热重载
