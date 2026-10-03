---
step: 2
title: CreateTask 完全体化
status: done
---

## 目标
CreateTask 只收完全体：planPath 必传、占位任务机制（upsert 补路径 + 全部占位文案）删除，同标题重复挂载改为拒绝。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-pipeline-symmetry.md] 执行管道已按类型查表，与 本步无代码交叠，仅语义接力
- 当前关键文件状态：
  - `electron/main/agents/tools/task-tools.ts:48-53` CreateTask 描述：含「planPath 可省略——方案未定型先占位，后续再次调用（同标题）会自动补上文档路径」「占位任务要提醒补 plan 文档」
  - `task-tools.ts:56-66` zod：planPath `.optional()`，describe 含「方案未定型可省略先占位……」
  - `task-tools.ts:80-90` isUpdate 计算（查同标题 plan 任务）+ createTask 调用；`taskLine`（:38-40）有「（未挂文档，占位）」分支
  - `electron/main/services/task-store.ts:164-184` createTask：`existing = tasks.find(t => t.status === 'plan' && !t.deletedAt && t.title === title)`，存在则补 planPath 返回（upsert）；`CreateTaskInput` 的 planPath 当前可选
  - ExecuteTask 工具描述（task-tools.ts 内）有「任务尚无 plan 文档（planPath 缺失）会报错——先落盘 plan 文档并用 dogear__CreateTask 传入 planPath（同标题）补路径」——「（同标题）补路径」语义失效需简化
- 关键决策回顾：任务=完全体（有完整计划才挂），未定型方案归笔记（Step 3 改提示词）；同标题拒绝而非静默 upsert，避免误重复挂载

## 计划改动
- [ ] `task-tools.ts` CreateTask 描述重写：删占位相关三处；明确「planPath 必传（文件须已落盘）」「同标题计划任务已存在时拒绝创建，标题勿重复」
- [ ] `task-tools.ts` zod：planPath 去 `.optional()`，describe 改必传表述；handler 里 `args.planPath ? path.resolve(...) : undefined` 简化为恒有值
- [ ] `task-tools.ts` isUpdate 分支删除；成功回执里「已补文档并更新计划任务」分支删除（若存在独立文案）
- [ ] `task-tools.ts` taskLine：planPath 恒有，「（未挂文档，占位）」分支删除
- [ ] `task-tools.ts` ExecuteTask 描述：「（同标题）补路径」改为「先落盘 plan 文档再挂载新任务」
- [ ] `task-tools.ts` 文件末尾 `registerTools()` 元数据若含占位描述同步
- [ ] `task-store.ts`：`CreateTaskInput.planPath` 收紧为必填；createTask 的 existing upsert 分支改为**抛错**（`任务《title》已存在，勿重复挂载`，或返回错误由 task-tools 转 errorResult——按现有错误流约定选）；`skipPlanCheck`/`status` 内部字段保留
- [ ] `task-store.test.ts`：占位相关用例改写（「缺省不落字段」用例的 createTask 调用需补 planPath；新增同标题拒绝用例）
- [ ] 全局 grep「占位」「同标题」清理残留文案（electron 源码内）
- [ ] 验证：`build:electron` + `bun test`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - taskLine 未完全删分支：保留 `planPath ?? '（缺失）'` 最小兜底——Task.planPath 类型仍 optional（存量任务缺省），直接删分支会让存量任务在 ListTasks 输出显示 `plan: undefined`；文案已去占位语义
  - createTask 增加一行运行时校验 `if (!input.planPath) throw new Error('planPath 必传：…')`（TS 已收紧，防御换明确错误消息）
  - ExecuteTask handler 内错误消息（不止描述）的「（同标题）补路径」一并清理，被全局 grep 清理条款覆盖
- 改动文件清单：
  - `electron/main/agents/tools/task-tools.ts`：文件头注释改写；CreateTask 描述重写（完全体/同标题拒绝/未定型记笔记）；zod planPath 去 optional；handler 删 isUpdate 预检查与「已补文档」回执，planPath 恒 resolve；ExecuteTask 描述与错误消息改「重新挂载」；taskLine 兜底改「（缺失）」
  - `electron/main/services/task-store.ts`：`CreateTaskInput.planPath` 收紧必填；createTask 删 upsert 改抛错「任务《title》已存在（ID: xxx），勿重复挂载」；Task.planPath 注释更新（新建必填/存量可缺省）
  - `electron/main/services/task-store.test.ts`：upsert 用例改写为同标题拒绝；占位用例改写为存量 legacy 直写 tasks.json（保留 getTaskDetail 无 planPath 分支覆盖）
- 验证：`build:electron` 通过；`bun test` 491 pass / 0 fail（含改写后两个用例）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `CreateTaskInput.planPath: string`（必填）；`Task.planPath?: string`（仍 optional，仅存量缺省）
  - 同标题拒绝在 store 层：`tasks.find(t => t.status === 'plan' && !t.deletedAt && t.title === title)` 命中即 throw，task-tools catch 转 errorResult（现有错误流，无专用返回通道）
  - `skipPlanCheck` / `status` 内部字段保留不动
- 下个 step 该从哪里继续：step3 笔记生命周期——`session-append-templates.ts:33` 与 `:173` 仍残留「可省略 planPath 占位 / 同标题自动补路径」文案，与本步新语义矛盾，是 step3 的主体改动
- 待办或已知限制：
  - 存量占位任务 2 个（mfdelhd2、hvszlply）无 planPath，新机制下无法入队执行，待用户处置（补 plan 文档或转笔记），代码未迁移
  - ListTasks 对存量无 planPath 任务显示「plan: （缺失）」
