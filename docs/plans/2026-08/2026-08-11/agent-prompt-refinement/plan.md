# Agent 协作提示词体系优化

**目标**：重新划分工具描述、系统提示词、skill 三层职责边界，消除跨层冲突，解决子会话交付文档写错位置的根因。

**架构思路**：三层各司其职——工具描述管"做什么+何时做"、系统提示词管"概念+行为引导"、skill 管"流程纪律"。当前问题是三层互相越界（skill 写工具名、工具描述写跨工具边界、系统提示词措辞与 skill 冲突），导致子会话推理链被打架的提示词带偏。

**涉及模块**：
- `electron/main/agents/tools/delegation-tools.ts`（6 个工具描述）
- `electron/main/agents/tools/group-tools.ts`（2 个工具描述）
- `electron/main/agents/tools/reference-tools.ts`（3 个工具描述 + 参数）
- `electron/main/agents/group-context-builder.ts`（组上下文段构建）
- `electron/main/agents/session-append-templates.ts`（系统提示词段模板）
- `resources/skill-templates/staged-execution/SKILL.md`（执行 skill）

## 步骤索引

- [x] [Step 1: 工具描述改动](./step1-tool-descriptions.md) — 11 个工具按"做什么+何时做"重写，去掉参数/实现/跨工具引用
- [x] [Step 2: 系统提示词段合并](./step2-system-prompt.md) — 合并会话组上下文+阶段总结，强化子会话交付路径措辞
- [ ] [Step 3: staged-execution skill 调整](./step3-skill.md) — 去掉冗余工具名引用，改为行为描述

## 全局决策

### 三层职责

| 层 | 管什么 | 不管什么 |
|----|--------|---------|
| 工具描述 | 能力（做什么）+ 场景（何时做） | 参数语法、实现细节、返回格式、跨工具引用 |
| 系统提示词 | 概念解释 + 主动行为引导 | 被动查询工具的使用、具体流程步骤 |
| skill | 流程纪律（步骤、分工、验收、提交） | 工具选择（除非需要严格锁死方式） |

### 工具描述标准格式

`<做什么>。仅用于<何时做>时。`

### skill 工具名引用规则

只在"选错有后果且其他层没覆盖"时保留工具名，否则改为行为描述。

### 参考文档

- `docs/standards/tool-description-guide.md` — 编写规范
- `docs/standards/tool-description-changes.md` — 工具改动清单
- `docs/standards/system-prompt-changes.md` — 提示词改动方案
- `docs/standards/skill-staged-execution-changes.md` — skill 改动清单
