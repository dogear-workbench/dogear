# 「是否分步骤」判断闸口 设计

**背景**：Browser 一期收尾会话中，agent 与用户脑暴拍板后落了设计文档，直接 `CreateTask` + `ExecuteTask`，执行会话按 design.md 一次改 8 个文件——跳过了 staged-impl 的实施计划环节。该任务满足 staged-impl「跨 ≥3 文件且步骤有依赖」的拆分条件，但判断从未发生。根因：从「设计落盘」到「挂任务/执行」的动线上，没有任何提示词环节要求 agent 评估是否分步骤。用户认可 agent 主动判断执行的 behavior，要求的是：判断本身要成为显式闸口——结论（分/不分 + 理由）必须呈现，即使结论是「不分」。

**目标**：在动线三处断点各补一个闸口，使「评估是否分步骤」成为设计 → 挂任务/执行之间的强制环节，「不分步骤」也必须明说理由。

**架构**：三处联动，各管一层——系统动线（常驻注入，兜底「必须判断」+ 内联判断标准）、brainstorming「后续衔接」（设计→实施交界处的即时提醒，原弱二分「问用户要不要写计划 vs 结束」缺「直接执行」分支）、staged-impl description（让判断时机在 skill 索引层可发现，原「主动建议使用」无强制力无时机）。排除的选项：只改系统动线（brainstorming 交界处的弱二分以后还会误导别的会话）；改 dogear__CreateTask 工具描述（动线已在挂任务上游拦截，重复）。

**模块边界 / 改动明细**：

1. `electron/main/agents/session-append-templates.ts` — `NOTES_DISCIPLINE_APPEND` 第 2 行动线改为「落盘设计文档 → 过『是否分步骤』判断 → CreateTask」，并新增第 3 行内联判断标准：
   - 满足任一（跨 ≥3 文件且步骤有依赖 / 需跨会话续做 / 架构层变更）→ 先用 staged-impl 写实施计划（plan.md + stepN-*.md），CreateTask 的 planPath 指向 plan.md
   - 都不满足 → 回复里明说「不分步骤，理由」——「不分」也是决策，不能默默跳过
   - 术语统一：原「落盘 plan 文档」改为「落盘设计文档」，消除与 staged-impl 产物 plan.md 的撞名

2. `resources/skill-templates/brainstorming/SKILL.md` — 「后续衔接」节从弱二分改为强制判断闸口：设计文档落盘后、挂任务或执行前，必须显式过一遍判断（标准引 staged-impl「何时用」）；满足 → staged-impl 写实施计划；都不满足 → 明说不分步骤的理由；判断完再确认执行时机（挂计划栏 / 立即执行）

3. `resources/skill-templates/staged-impl/SKILL.md` — 两处：
   - frontmatter `description` 触发场景增加时机：「设计文档落盘后、挂任务或转入执行前（必须先过『何时用』判断——满足条件就写实施计划，不满足也要明说不分步骤的理由）」
   - 正文「何时用 / 何时不用」节的「不用」清单后补一行：判定不用时把理由说给用户听（一行即可），「不分步骤」也是决策，不能默默跳过

**数据流**：不变。唯一行为变化是 agent 在 CreateTask 前多一步显式判断，判断结果以一行文字呈现给用户；planPath 语义扩展为「可指向 design.md（不分步骤）或 plan.md（分步骤）」，执行会话按所指向文档实施。

**错误处理 / 边界情况**：
- 判断标准在系统动线（改动 1）和 staged-impl「何时用」（改动 3）两处出现，将来调整标准需同步两处——接受此成本，换取判断不依赖 skill 加载即可发生
- `NOTES_DISCIPLINE_APPEND` 仅 role='main' 且有工作区时注入，brainstorming/staged-impl 也是主会话场景，覆盖面一致
- 改 ts 后需 `bun run build:electron` 重编译生效；skill 模板改动在下次会话启动时读取生效（生产安装目录以发版为准）

**本任务自身的分步骤判断**：不分步骤——3 个文件均为一两处文字修改，三处相互独立、无依赖，单会话可完成+验收（staged-impl「何时用」的三个条件中「步骤间有依赖关系」不满足）。

**未决问题**：无。
