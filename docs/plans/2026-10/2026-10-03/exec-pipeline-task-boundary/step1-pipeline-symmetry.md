---
step: 1
title: 执行管道对称化
status: done
---

## 目标
default 执行会话不再受工作区/场景 skill 配置影响，恒为基础版（零 skill）；code-impl 行为不变。管道完全由任务类型查表决定。

## 依赖上下文（接力棒输入）
- 前置 step 产出：无（首步）
- 当前关键文件状态：
  - `electron/main/services/task-queue.ts:35` 常量 `CODE_IMPL_SKILLS = ['staged-execution']`
  - `task-queue.ts:227` attach 传参 `skillsOverride: task.execProfile === 'code-impl' ? CODE_IMPL_SKILLS : undefined`
  - `task-queue.ts:299-305` 提示词 `mountedSkills: task.execProfile === 'code-impl' ? CODE_IMPL_SKILLS : undefined`（空数组经 `mountedSkills?.length` 判断自然无挂载行）
  - `electron/main/agents/pi-session/pi-session.ts:444-459` 装配：`skillsOverrideSet = this.config.skillsOverride && !isSubAgent ? new Set(...) : null`——**空数组是 truthy**，传 `[]` 得空 Set → filter 后零 skill，基础版成立
- 关键决策回顾：default 传空清单而非「结构性排除 code-workflow」或「出厂场景覆盖键」——不动三级回退、无存量迁移、未来加类型只改查表一行

## 计划改动
- [ ] `task-queue.ts`：`CODE_IMPL_SKILLS` 改为 `EXEC_PROFILE_SKILLS: Record<ExecProfile, readonly string[]>`（default 为空数组；ExecProfile 从 task-execution-prompt.ts import，已导入则复用）；:227 与 :305 两处调用点改为 `EXEC_PROFILE_SKILLS[task.execProfile ?? 'default']`
- [ ] `task-queue.ts:299` 附近注释「存量任务无 execProfile 字段等价 default，不挂载专项 skill」改为「default 基础版：空清单，与工作区/场景 skill 配置解耦」
- [ ] `pi-session.ts:444` 注释更新：skillsOverride 语义扩为「执行会话按任务类型恒传查表清单（default 空清单=基础版）；undefined=跟随工作区，保留给非执行场景」
- [ ] `electron/main/agents/pi-session/pi-session-config.ts:32` 与 `electron/main/services/conversation-runtime-service.ts:51` 的 skillsOverride JSDoc 同步
- [ ] `electron/main/tipc/ability-scene.ts:629` executor 行 description「固定层预设跟工作区走。代码实施任务自动挂分步实施 skill，其余任务用默认配置。」→ 改为反映新语义：default 任务基础版执行（不挂 skill，与固定层无关），代码实施任务自动挂分步实施 skill
- [ ] 核对 `ability-scene.ts` 内 EXECUTOR_PROMPTS 两段预览（default / code-impl）文案是否需同步（default 段不应再暗示「跟工作区走」）
- [ ] grep `CODE_IMPL_SKILLS` 全部引用清零（含 dist 无关，只管源码与测试）
- [ ] 验证：`build:electron` + `bun test`（关注 task-queue / pi-session 相关既有测试是否断言 undefined 传参）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：新增 1 处类型适配——三个 skillsOverride/mountedSkills 接收点类型从 `string[]` 放宽为 `readonly string[]`（task-execution-prompt.ts / pi-session-config.ts / conversation-runtime-service.ts），否则 readonly 查表常量无法赋给可变数组类型；行为不变，只让类型与查表常量签名对齐
- 改动文件清单：
  - `electron/main/services/task-queue.ts`：`CODE_IMPL_SKILLS` → `EXEC_PROFILE_SKILLS: Record<ExecProfile, readonly string[]>`（default 空）；attach 与 mountedSkills 两处恒传 `EXEC_PROFILE_SKILLS[task.execProfile ?? 'default']`；:299 注释改为「default 基础版：空清单，与工作区/场景 skill 配置解耦」；import 加 `type ExecProfile`
  - `electron/main/services/task-execution-prompt.ts`：`mountedSkills?: readonly string[]`
  - `electron/main/agents/pi-session/pi-session-config.ts`：skillsOverride JSDoc 同步新语义 + 类型 `readonly string[]`
  - `electron/main/services/conversation-runtime-service.ts`：AttachConversationOptions.skillsOverride JSDoc 同步 + 类型 `readonly string[]`
  - `electron/main/agents/pi-session/pi-session.ts:444`：注释改为「执行会话按任务类型恒传查表清单（default 空清单=基础版）；undefined=跟随工作区，保留给非执行场景」
  - `electron/main/tipc/ability-scene.ts`：executor 行 description + extensionNote 改为「扩展层 skill 与配置解耦：default 基础版零 skill，代码实施自动挂分步实施 skill」
- EXECUTOR_PROMPTS 核对结论：仅一段模板预览，note「代码实施任务会多一行 skill 挂载提示」仍准确，模板本身无「跟工作区走」暗示，无需改
- `CODE_IMPL_SKILLS` 全源码引用已清零（grep 确认）；无 task-queue/pi-session 测试断言 undefined 传参（核对无此负担）

### 给下一步的接力棒
- 关键签名 / 数据结构：`EXEC_PROFILE_SKILLS: Record<ExecProfile, readonly string[]>`（task-queue.ts:35，唯一真相源）；`task.execProfile ?? 'default'` 是两处调用点的统一取值式
- 下个 step 该从哪里继续：Step 2（CreateTask 完全体化，step2-no-placeholder.md）——动 task-tools.ts / task-store.ts / task-queue.ts 的 planPath 校验，注意 task-queue.ts 现有两处 `?? 'default'` 取值式与 Step 4 改口功能的兼容（改口后 execProfile 必有值，兜底仍成立）
- 待办或已知限制：场景页 executor 行的 skill 格子仍展示工作区开关状态，但对执行会话已完全不影响装配（skillsOverride 恒传）；是否要把 executor 行 skill 格子改为只读提示，属后续 UI 决策，本计划未涵盖
