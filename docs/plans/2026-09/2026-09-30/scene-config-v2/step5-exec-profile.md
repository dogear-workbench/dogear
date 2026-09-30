---
step: 5
title: 任务类型 execProfile 全链路
status: done
---

## 目标

协作任务支持 `execProfile: 'default' | 'code-impl'`：CreateTask 参数、存储、执行提示词分支、staged-execution skill 挂载（skillsOverride 接线）、任务面板徽章、ListTasks 透出。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-assembly-wiring.md] `PiSessionConfig.skillsOverride` 字段与 tool-assembly 消费已就位（本步从 task-queue 接线）
- 当前关键文件状态：
  - `electron/main/services/task-store.ts` — Task 八状态机存储（`.dogear/tasks.json`），类型定义处
  - `electron/main/agents/tools/task-tools.ts` — CreateTask/ListTasks/ExecuteTask/ReportTaskResult 四工具 + `registerTools()` 元数据（zod schema）
  - `electron/main/services/task-queue.ts` — `buildExecutionPrompt(task)` 现状固定 staged-execution 语境；`executeOne` 里 `conversationRuntimeService.attachConversation(execId, workspaceId, 'desktop', {})` 创建会话
  - `electron/main/services/conversation-runtime-service.ts` — attach 入口，PiSession 创建链路
  - 任务面板 UI：协作任务面板（见 `docs/codebase-map/articles.md` 任务面板条目）
- 关键决策回顾：不做手动改类型 UI；default = 场景设置啥就是啥（无扩展）；code-impl = skillsOverride `['staged-execution']`；存量任务无字段等价 default

## 计划改动

- [ ] Task 类型两侧同步（`task-store.ts` + 前端任务类型定义）：加 `execProfile?: 'default' | 'code-impl'`（读侧缺省 default）
- [ ] `task-tools.ts`：CreateTask schema 加可选 `execProfile` 枚举参数，description 写判断标准（「plan 为分步实施文档（stepN-*.md）且要动代码时填 code-impl；调研/整理类不填」）；ListTasks 返回条目带 execProfile；`registerTools()` 元数据同步
- [ ] `buildExecutionPrompt` 按类型分支：code-impl 保持现状 staged-execution 语境；default 去掉分步实施/派子会话语义，保留无人值守、读计划、申报纪律（ReportTaskResult + TrackUserActions）
- [ ] skillsOverride 接线：task-queue `executeOne` 按 `execProfile` 传参——路径选一（回填记录）：a) attachConversation 第四参透传到 PiSessionConfig；b) attach 后对 session 设置。倾向 a（配置走创建链路，不搞事后 mutation）
- [ ] 任务面板任务卡片：类型徽章（「代码实施」/「默认」）；任务详情/列表数据带字段
- [ ] 场景页 executor 行的扩展说明文案与本步语义对齐（若 Step 4 已留占位，此处补正）
- [ ] 验证：`build:electron` + `build:renderer`；手动链路——挂一个 code-impl 任务入队，日志/会话 available_skills 确认 staged-execution 已挂；default 任务提示词无 staged-execution 引用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - ListTasks 返回条目带类型：tipc 层直接透传 Task 对象（类型自动流转），额外在 taskLine 文本里加「类型: 默认/代码实施」行供 agent 读
  - CreateTask 三个成功文案（排队/更新/落计划栏）均加「- 类型: …」行
  - 徽章落在 TaskStatusBadge.tsx（新增 TaskExecProfileBadge 导出），TaskPanel 卡片行 + TaskDetail 标题行均挂；「默认」用 muted 灰、「代码实施」用 fuchsia，title 属性写语义说明
  - 无人值守手动链路验证改为：buildExecutionPrompt 双分支单测（新文件 task-execution-prompt.test.ts，4 项：code-impl 语境 / 缺省=code-impl / default 无 staged-execution / 共用占位实参）+ task-store execProfile 存取单测（1 项）+ attach 透传链路代码走查（见下），无法自动验证部分列入交付文档用户目验清单
- 改动文件清单：
  - `electron/main/services/task-store.ts`：import ExecProfile；Task/CreateTaskInput 加 `execProfile?`；createTask 非空才落盘（缺省不写 = 与存量一致）
  - `electron/main/services/task-tools.ts`：EXEC_PROFILE_LABEL；CreateTask zod 加 execProfile 枚举 + 工具描述加判断标准；taskLine 加类型行；三处成功文案加类型行
  - `electron/main/services/conversation-runtime-service.ts`：AttachConversationOptions 加 `skillsOverride?`；createSession config 透传（路径 a，配置走创建链路）
  - `electron/main/services/task-queue.ts`：CODE_IMPL_SKILLS 常量；executeOne attach 传 `skillsOverride: code-impl ? CODE_IMPL_SKILLS : undefined`；runExecutionTurn 显式 `execProfile: task.execProfile ?? 'default'`（存量任务无字段 → default，与模板函数缺省 code-impl 刻意不一致）
  - `types/task.ts`：ExecProfile + Task.execProfile 镜像
  - `components/notes/TaskStatusBadge.tsx`：TaskExecProfileBadge
  - `components/notes/TaskPanel.tsx` / `TaskDetail.tsx`：挂徽章
  - `electron/main/services/task-execution-prompt.test.ts`（新）+ `task-store.test.ts`（扩展）
- 验证：build:electron ✓ / build:renderer ✓ / lint 0 error（70 warning 均存量）/ bun test 383 pass 0 fail（+5）

### attach 透传路径选择（回填）
选 a) attachConversation options 透传：AttachConversationOptions 加 `skillsOverride?` → createSession config 字段 → PiSessionConfig.skillsOverride（Step 2 已就位）→ pi-session.ts start() `skillsOverrideSet`（非 sub 生效）。执行会话由 task-queue 先 attach（新建 session 时装配），用户后打开复用 retain 的同一 session，skill 不变，无事后 mutation。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `Task.execProfile?: ExecProfile`（两侧镜像 task-store.ts / types/task.ts）；缺省/读侧一律 `?? 'default'` 兜底
  - `attachConversation(id, wsId, holder, { skillsOverride?: string[] })`；undefined = 跟随工作区
  - `buildExecutionPrompt(input.execProfile?)`：模板缺省 code-impl（现状兼容），task-queue 调用点已显式传 `task.execProfile ?? 'default'`
  - 徽章组件 `TaskExecProfileBadge`（TaskStatusBadge.tsx 导出）
- 下个 step 该从哪里继续：Step 6（能力页瘦身 + doc-sync）；doc-sync 需覆盖本步的 execProfile 全链路与 skillsOverride attach 透传语义
- 待办或已知限制：
  - skillsOverride 仅在 session 新建时装配，attach 复用已有 session 时不重传（执行会话场景无影响）
  - CreateTask 的 execProfile 由 agent 判断，填错无 UI 改口（设计拍板：重挂成本低）
