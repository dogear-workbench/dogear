---
step: 1
title: 装配与数据链
status: done
---

## 目标
执行提示词合并为通用模板 + 挂载 skill 引用行；定时任务模型加 skillsOverride 并在装配时把 SKILL.md 全文拼进 systemPrompt。

## 依赖上下文（接力棒输入）
- 前置事实：`electron/main/services/task-execution-prompt.ts:18-49` buildExecutionPrompt 现有 default/code-impl 双 modeLines 分支（全文摘录见共享区事实报告 D 节）；`task-queue.ts:37` CODE_IMPL_SKILLS=['staged-execution']、:229 skillsOverride 传参、:301-303 调 buildExecutionPrompt
- 定时任务链路：`task-types.ts:185` 已有 toolPacksOverride 字段（undefined=跟随工作区）；`custom-agent-task.ts:55` → buildCustomToolSet；`plan-validate.ts:15-17` sanitize 白名单模式
- pi skill 索引：pi-session.ts 装配 skill 用的目录源（builtin + custom），定时任务拼接复用同一读取路径

## 计划改动
- [x] `task-execution-prompt.ts`：删 execProfile 分支，合并 modeLines 为通用段（派子会话分工/验收后申报）；函数签名改为接收 `mountedSkills?: string[]`，非空时追加一行「本任务已挂载专项 skill：{names.join('、')}，开工前先读该 skill 并按其纪律执行」
- [x] `task-queue.ts`：调用处传 `mountedSkills: task.execProfile === 'code-impl' ? CODE_IMPL_SKILLS : undefined`
- [x] `task-types.ts`：定时任务模型加 `skillsOverride?: string[]`（注释：undefined = 不挂载；空数组 sanitize 归一为 undefined）
- [x] `plan-validate.ts`：sanitize skillsOverride——过滤 skill 索引外的名字，空数组归一 undefined
- [x] `custom-agent-task.ts`：装配时读选中 skill 的 SKILL.md 全文，以 `<mounted-skill name="...">\n...\n</mounted-skill>` 分段拼在任务 systemPrompt 之后；单个文件读取失败跳过并 console.warn，不阻断
- [x] 验证：`bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 计划只列了 task-types.ts 加 skillsOverride，实际还需 CustomScheduledTask（scheduler/types.ts）加同名字段 + task-executor.ts 透传进 payload，否则持久层到装配层的数据链断裂；两处为计划隐含必需的补充
  2. skill 目录源（builtin+custom+user 三目录）抽成 skill-loader.ts 的 loadAllSkillEntries()，plan-validate 与 custom-agent-prompt 共用；pi-session.ts 未动（内联目录源保持原样，后续可切到同一入口）
  3. sanitizeSkillsOverride 为 async（skill 索引是 fs 扫描），tipc/scheduler.ts saveTask 相应 await；名字过滤含去重，空/全非法归一 undefined
  4. ability-scene.ts EXECUTOR_PROMPTS 两处调用做了最小编译适配（execProfile → mountedSkills，code-impl 段内联 ['staged-execution']）；两段预览仍存在，文案/合并留 step2
  5. task-execution-prompt.test.ts 按新语义重写（通用模板 / 挂载行 / 缺省无挂载 / 占位）
  6. ExecProfile 类型保留（task-store/task-tools 仍在用），仅模板函数不再分支
- 改动文件清单：
  - electron/main/services/task-execution-prompt.ts（通用模板 + mountedSkills 行）
  - electron/main/services/task-execution-prompt.test.ts（重写）
  - electron/main/services/task-queue.ts（传 mountedSkills）
  - electron/main/tipc/ability-scene.ts（EXECUTOR_PROMPTS 编译适配）
  - electron/main/agents/pi-session/skill-loader.ts（loadAllSkillEntries）
  - electron/main/agents/task-types.ts（payload.skillsOverride）
  - electron/main/services/scheduler/types.ts（CustomScheduledTask.skillsOverride）
  - electron/main/services/scheduler/plan-validate.ts（sanitizeSkillsOverride）
  - electron/main/tipc/scheduler.ts（saveTask 接入 sanitize）
  - electron/main/services/scheduler/runtime/task-executor.ts（透传）
  - electron/main/services/scheduler/custom-agent-prompt.ts（buildMountedSkillsSection）
  - electron/main/agents/tasks/custom-agent-task.ts（拼进 systemPrompt）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - buildExecutionPrompt(input: { title, id, planPath, mountedSkills?: string[] })；mountedSkills 非空时在执行模式段尾追加一行「本任务已挂载专项 skill：…，开工前先读该 skill 并按其纪律执行」
  - CustomScheduledTask.skillsOverride?: string[] / CustomAgentTaskPayload.skillsOverride?: string[]（undefined=不挂载；sanitize 后永不空数组）
  - sanitizeSkillsOverride(task): Promise<string[] | undefined>，在 tipc/scheduler.ts saveTask 中与 toolPacksOverride 并列调用
  - buildMountedSkillsSection(skills?: string[]): Promise<string>，返回 <mounted-skill name="…"> 段落（\n\n 分隔），空入参/全跳过返回空串
  - loadAllSkillEntries(): Promise<SkillEntry[]>（skill-loader.ts），三目录源 = getTemplatesDir() + configDir/skills + ~/.claude/skills
  - 数据链：编辑页 draft.skillsOverride → tipc saveTask sanitize → plans.json 持久化 → task-executor 透传 payload → custom-agent-task 拼 systemPrompt
- 下个 step 该从哪里继续：
  - 编辑页 UI（TaskEditorPage + skill 多选组件）尚未有入口写 draft.skillsOverride，后端链路已通，前端组件接入即生效；候选清单取数可用 loadAllSkillEntries 同源或 skill-service.listSkills（带 enabled 标注）
  - step2 场景页重构时 EXECUTOR_PROMPTS（ability-scene.ts:630）两段预览可合并/改文案：default 段 = buildExecutionPrompt(EXECUTION_PROMPT_PREVIEW)，code-impl 段只多一行挂载行
- 待办或已知限制：
  - 存量任务无 skillsOverride 字段 → 不挂载（符合设计）
  - skill 索引扫描（loadSkills 递归）在每次 saveTask 执行一次，任务保存低频，未做缓存
  - 定时任务无 Skill 懒加载工具，skill 全文直接进 systemPrompt（设计即如此，token 占用由选择者把控）
