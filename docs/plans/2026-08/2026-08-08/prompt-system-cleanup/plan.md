# 提示词系统精简 实施计划

**目标**：砍掉无用的工具包导览，精简记忆和协作两块能力的提示词，让提示词只管"何时用"和"行为约束"，不重复工具 schema 已描述的内容。

**架构思路**：核心原则是"工具没注册就不要在提示词里提，工具 schema 已描述的用法不要在提示词里重复"。三块改动互相独立，按记忆 → 协作工具注册 → 协作提示词的顺序执行。

**涉及模块**：
- `electron/main/agents/tool-pack-guide.ts` — 待删除
- `electron/main/agents/session-append-templates.ts` — 4 段提示词重写
- `electron/main/agents/group-context-builder.ts` — 极简化
- `electron/main/agents/tools/memory-tools.ts` — dead code 清理
- `electron/main/agents/tools/reference-tools.ts` — 挂载条件调整
- `electron/main/agents/pi-session/pi-session.ts` — 工具注册 + prompt 拼接调整

## 步骤索引

- [x] [Step 1: 砍掉工具包导览 + 修正记忆提示词](./step1-toolpack-guide-and-memory.md) — 删 buildToolPackGuide，修正 MEMORY_GUIDANCE_APPEND，清 dead code
- [x] [Step 2: 主会话注册 reference 工具](./step2-reference-tools-to-main.md) — ReadReferenceSession 等工具放开给主会话
- [x] [Step 3: 精简协作提示词 + 极简组上下文](./step3-collaboration-prompts.md) — 重写 4 段 append，极简化 group-context-builder

## 全局决策

- **提示词原则**：只写"何时用"和"行为约束"，不写"有哪些工具"和"工具怎么调"
- **工具注册原则**：工具没注册就不要在任何提示词段里提它的名字
- **子会话防递归**：继续靠工具子集保证（子会话没有 CreateSession），不需要提示词强调
- **delivery 语义**：CreateSession 后必须 WaitForMessage 是唯一需要在提示词里强制的纪律，其余靠工具 description
- **不修改前端展示**：`getSystemPromptSegments` 的条目清理随各 step 自然完成，不单独处理
