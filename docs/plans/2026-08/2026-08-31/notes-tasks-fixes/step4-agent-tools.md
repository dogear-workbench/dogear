---
step: 4
title: agent 工具与提示词
status: done
---

## 目标
agent 侧适配三栏模型：CreateTask 支持 planPath 省略（占位）+ upsert 语义透传；ExecuteTask 允许 plan 态直入队列；重写存卡纪律——可实施工作只进任务不污染笔记。

## 依赖上下文（接力棒输入）
- 前置产出：[step2-task-data.md] `createTask` 已支持 upsert（plan 态同标题更新 planPath）与 planPath 省略；`executeTask` from=['plan','backlog']。
- 当前关键文件状态：
  - `electron/main/agents/tools/task-tools.ts` — `dogear__CreateTask` zod schema `planPath: z.string().min(1)` 必填 + 工具内 `fs.access` 前置校验；`dogear__ExecuteTask` 描述仅提 backlog；`dogear__ListTasks` 描述含六态
  - `electron/main/agents/session-append-templates.ts:19-24` — `NOTES_DISCIPLINE_APPEND`：动线为「落 plan → CreateNote 存卡 → CreateTask 落积压」，含「完成后 dogear__AppendNote 结果摘要」
  - 挂载点：`electron/main/agents/pi-session/pi-session.ts:437`（role='main' 且有工作区时注入 NOTES_DISCIPLINE_APPEND）
- 关键决策回顾：agent ExecuteTask 作用于 plan 等价于用户确认（UI 按钮仍严格分栏）；结果摘要由 task-queue `<task-result>` 自动写回，agent 不再 AppendNote。

## 计划改动
- [ ] `electron/main/agents/tools/task-tools.ts`：
  - `dogear__CreateTask` schema：`planPath` 改 `z.string().min(1).optional()`；工具内 `fs.access` 校验改为「传了才校验」；description 重写：「将实施任务挂到计划栏。默认落计划（plan）由用户决定何时推进执行；与用户聊透方案后挂载。planPath 可省略——方案未定型先占位，后续再次调用（同标题）会自动补上文档路径；传入时要求文件已落盘。autoExecute=true 仅当用户明确要求立即执行」
  - 成功返回文案：区分「已存入计划栏」/「已补文档并更新计划任务」/「已排队」三种
  - `dogear__ExecuteTask`：description 更新（plan/backlog 均可，planPath 缺失会报错）；工具内执行前校验——task.planPath 缺失时返回 isError 提示「任务尚无 plan 文档，请先落盘并 CreateTask 补路径」（队列侧 step2 已有防御，这里是给 agent 的即时反馈层）
  - `dogear__ListTasks`：description 术语更新为「plan 计划 / backlog 待办」七态
- [ ] `electron/main/agents/session-append-templates.ts` `NOTES_DISCIPLINE_APPEND` 重写，要点：
  - 笔记定位：用户的工作台——脑暴思路、用户明确要求记录的内容、琐事备忘（正文 `- [ ]` 勾选项）；**可实施工作一律走任务（dogear__CreateTask），不要为任务存笔记卡**
  - 与用户聊完方案后的动线：落盘 plan 文档（docs/plans/...）→ `dogear__CreateTask` 挂到计划栏 → 在回复中告知用户；方案未定型要先记时 CreateTask 可省略 planPath 占位
  - 执行动线：用户明确说做 → `dogear__ExecuteTask`（plan/待办均可）；结果摘要由系统自动写回任务详情，无需 AppendNote
  - `getSystemPromptSegments()` 的 notes-discipline 段 `triggerDescription` 同步改写
- [ ] `resources/skill-templates/staged-execution/SKILL.md` 与 `staged-impl/SKILL.md`：grep 其中提及「积压 / backlog / autoExecute」的措辞，与新「计划/待办」术语对齐（只改表述，不改机制；安装版实例副本若与模板漂移以模板为准改模板）
- [ ] `agent.md`（工作区根）：grep「积压 / CreateTask / autoExecute」相关段落同步术语（「任务通知深链」「积压是常态」等句）

## 验证
- `bun run build:electron` 编译通过
- 会话里让 agent「把这个想法记成任务，文档稍后再写」→ 占位任务落计划栏、无笔记卡产生
- 同标题再让 agent 挂载已写好的 plan → upsert 补路径不重复建
- 「执行那个任务」→ agent 调 ExecuteTask 从 plan 直入队列

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - **skill 模板零改动**：grep `resources/skill-templates/staged-execution/SKILL.md` 与 `staged-impl/SKILL.md`，均无「积压 / backlog / autoExecute」措辞，无需对齐；`resources/skills/`（安装实例副本）目录不存在
  - **agent.md 实际路径**不在 C:/dogear/agent.md，而是在 `.dogear/workspaces/15d3447b-aaa0-4e32-86ae-abc727c75835/agent.md`（Dogear 应用当前工作区），已改其「笔记存卡纪律」段
  - **补了一个计划未明说的关键点**：`task-store.createTask` 的 `input.status` 默认值是 `'queued'`（历史「挂载即排队」语义），工具层非 autoExecute 路径必须显式传 `status: 'plan'`，否则新建任务直接落队列且不 kick
  - **upsert 分支判定**：service 层 `createTask` 不返回「新建/更新」标记，工具层在传入 planPath 时先 `listTasks` 查 plan 态同标题（trim 后比对，与 `requireTitle` 一致）来区分「已存入计划栏 / 已补文档并更新」两种文案
  - **CreateTask autoExecute=true 且无 planPath** 时直接返回 isError 提示先落盘补路径（队列侧占位拦截的前置即时反馈）
  - **ListTasks 七态**：zod enum 补入 `'plan'`（原六态缺 plan，无法按计划过滤）；`taskLine` 对无 planPath 占位任务显示「（未挂文档，占位）」而非 `undefined`
  - 端到端验证（会话里让 agent 实操占位/upsert/执行）需运行中的应用，子会话无法跑 GUI；已用一次性脚本直接验证 service 层行为序列（占位创建→upsert 补路径同 ID→executeTask plan→queued→队列态同标题新建不撞 upsert），全部符合预期；agent 实操场景留给主会话在 dev 环境验证
- 改动文件清单：
  - `electron/main/agents/tools/task-tools.ts`（CreateTask schema/description/三分支文案 + autoExecute 两步模式；ExecuteTask description + planPath 前置校验；ListTasks 七态；taskLine 占位显示；文件头注释）
  - `electron/main/agents/session-append-templates.ts`（`NOTES_DISCIPLINE_APPEND` 重写为三动线：笔记定位/方案动线/执行动线；notes-discipline `triggerDescription` 同步）
  - `.dogear/workspaces/15d3447b-aaa0-4e32-86ae-abc727c75835/agent.md`（「笔记存卡纪律」段术语同步）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `dogear__CreateTask` 入参 `{ title, planPath?, autoExecute? }`；内部恒 `createTask(ws, { title, planPath?, originSessionId, status: 'plan' })`，autoExecute 再 `executeTask` + `kick`；三文案分支：已排队 / 已补文档并更新计划任务 / 已存入计划栏（占位时带补路径提示）
  - `dogear__ExecuteTask`：`getTask` → 无任务/无 planPath 即时 isError → `executeTask`（from=['plan','backlog']）→ `kick`
  - `dogear__ListTasks`：status enum 七态 `['plan','backlog','queued','running','review','done','rejected']`
  - `NOTES_DISCIPLINE_APPEND`（session-append-templates.ts）不再引导「存方案卡片」和「AppendNote 结果摘要」；结果摘要由 task-queue `<task-result>` 自动写回
- 下个 step 该从哪里继续：见 plan.md 步骤索引；UI 侧若还有遗留的「积压」措辞或 backlog 分组渲染，按同套术语（plan 计划 / backlog 待办）核对
- 待办或已知限制：
  - `NOTES_DISCIPLINE_APPEND` 是启动时注入的静态模板，已安装/已运行的旧会话不会自动拿到新文案，需新会话生效
  - 工作区 agent.md 是 per-workspace 数据文件，其他工作区（若有多份 agent.md）需各自同步「笔记存卡纪律」段
