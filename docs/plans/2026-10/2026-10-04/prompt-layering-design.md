# 提示词四层架构 + skill 体系去重 设计

**背景**：以 execProfile 语义混淆为引子（'code-impl' 命名说任务性质、语义实为分步执行形态），全量盘点提示词载体后发现体系性重复：实施纪律三处复述、分步骤判断标准三处逐字重复、staged-execution 近半内容与系统协作段同源。根因是各层（agent.md / 系统段 / skill）之间没有「单一事实源」分层约定，每个新 skill 出于自含性复述已有纪律。

**目标**：建立四层提示词架构，每层单一职责；新建 code-discipline skill 承载此前缺失的「不分步代码实施工程纪律」；staged-execution 瘦身为纯分步编排；execProfile 语义修正为「动代码即 code-impl，分步与否由 plan 文档形态决定」；用户级 agent.md 复活为跨工作区纯人格层。

**架构**（四层，注入链路已确认：pi-session.ts:476 工作区级与用户级 agent.md 拼接注入）：

| 层 | 定位 | 注入 | 单一职责 |
|---|---|---|---|
| 用户级 agent.md | 跨工作区人格层 | 每会话（global-rules 包） | 交流/思考/工作方式偏好，零机制指向、零项目专项 |
| 工作区 agent.md | 本项目事实与约定 | 每会话（workspace-rules 包） | 技术栈、硬约束、红线、项目级硬决策；只写事实约定不写流程 |
| 系统 append 段 | 跨项目行为协议 | 按能力包挂载 | 协作、记忆、笔记、git、分流等流程性约定的唯一源 |
| skills | 场景流程编排 | 匹配 description 按需加载 | 只写场景特有步骤；通用约定引用不复述（skill description 的触发条件属场景定义，保留自含） |

**排除的选项**：不 rename 'code-impl' 枚举值（存量 tasks.json / UI 徽章 / 查表引用，破坏性变更收益低）；不合并 staged-execution 进新 skill（单 skill 双模式会臃肿，挂载成本高）。

**模块边界**（12 文件，详见实施计划 prompt-layering/plan.md）：

- 内容层：用户级 agent.md（重写）、resources/agent-templates/general.md（同步）、dogear 工作区 agent.md（去重）
- skill 层：resources/skill-templates/code-discipline/SKILL.md（新建）、staged-execution/SKILL.md（瘦身 200+→100 行内）、brainstorming/SKILL.md（衔接段引用化）
- 接线层：task-queue.ts（挂载查表）、task-tools.ts（CreateTask 文案）、ability-registry.ts（code-workflow skills 列表）、task-execution-prompt.ts（code-impl 分支提示词）、session-append-templates.ts（协作段吸收派遣成本判断）
- 文档：docs/codebase-map/agent-core.md（doc-sync）

**数据流**：code-impl 任务入队 → task-queue skillsOverride 挂 ['code-discipline','staged-execution'] → 执行会话读 planPath 形态 → 设计文档=单步走 code-discipline；stepN-*.md=分步叠加 staged-execution。

**错误处理 / 边界情况**：

- general.md 模板必须同步，否则设置页「恢复模板」会把重复写回
- staged-impl description 的分步判断标准保留（触发入口必须自含），消掉的是 brainstorming 内文逐字重复
- skill 模板改动影响所有工作区（随应用分发），code-discipline 中 lint/build 命令不写死，引用各工作区 agent.md 常用命令区
- 用户级 agent.md 与工作区级同时注入，内容冲突时工作区级在前（对话中越靠后越强势），故用户级只放全域通用条目

**未决问题**：无（用户已逐段确认：四层原则、用户级稿、code-discipline 薄版骨架、staged-execution 删留清单、四步拆分）。
