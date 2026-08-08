---
step: 2
title: 提示词补充
status: done
---

## 目标

为记忆系统、Agent 协作、股票分析三个能力域补充警告级提示词约束。这些约束从工具描述中删除后，需要在新家落位。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] 工具描述已精简，约束已删除
- 关键文件状态：
  - `electron/main/agents/session-append-templates.ts` — 现有 7 段注入提示词
  - `electron/main/agents/tool-pack-guide.ts` — 工具导览（常驻段）
  - `resources/skill-templates/stock-analysis/SKILL.md`（step3 创建，或先临时改 `.claude/skills/stock-analysis/SKILL.md`）

## 计划改动

### 记忆系统提示词（新增）

- [ ] `session-append-templates.ts` — 新增 `MEMORY_GUIDANCE_APPEND` 常量：
  ```
  ## 记忆系统
  - 只记录有长期价值的信息（稳定的偏好、重要决策、反复出现的模式），不要存一次性对话内容
  - UpdateCoreProfile 是全量覆盖——调用前必须先 GetCoreProfile 拿现有内容合并后再写入
  ```
- [ ] `pi-session.ts` — 在 promptParts 拼接中加入 `MEMORY_GUIDANCE_APPEND`（主会话注入）
- [ ] `session-append-templates.ts` — `getSystemPromptSegments()` 加入记忆段条目，供设置页展示

### Agent 协作提示词（补充现有段）

- [ ] `session-append-templates.ts` — `MAIN_AGENT_DELEGATION_APPEND` 末尾追加：
  ```
  - SendMessage 的 delivery 标记仅用于正式交付（任务完成通知），普通往来消息（提问、回复、追加信息）不要设 delivery。
  ```
- [ ] `session-append-templates.ts` — `subAgentContractFor()` 追加 reference 工具使用规范：
  ```
  - 使用 ReadReferenceSession 读历史会话时，原样交回给主 agent，不要臆断或省略。
  ```

### 股票分析 SKILL.md（补充）

- [ ] stock-analysis SKILL.md 的「不要做」段追加：
  ```
  - 用户说"银行股""医药股"等俗名时，先调 ListIndustries 查映射——分类名和俗名差异大（银行 = J66货币金融服务，医药 = C27医药制造业）
  ```

## 实施回填（做完后填）

### 实际改动

4 个文件改动（3 个业务 + 1 个 .claude/）：
- `session-append-templates.ts`：新增 MEMORY_GUIDANCE_APPEND 常量 + getSystemPromptSegments 加入 memory-guidance 条目 + MAIN_AGENT_DELEGATION_APPEND 追加 delivery 说明 + subAgentContractFor 追加 reference 规范
- `pi-session/pi-session.ts`：import MEMORY_GUIDANCE_APPEND + promptParts 注入（与 NOTES_GUIDANCE_APPEND 同条件）
- `types.ts`：SystemPromptSegment.category 联合类型追加 'memory'（配套必须改动）
- `.claude/skills/stock-analysis/SKILL.md.disabled`：「不要做」段追加俗名映射约束（主会话直接改）

验证：`bun run build:electron` 编译通过。

### 给下一步的接力棒

- 提示词补充已就位，记忆/协作/股票三处警告级约束均已在提示词中落位
- `getSystemPromptSegments()` 新增了 memory-guidance 条目，Step 4 的能力 Tab 前端可直接展示
- stock-analysis SKILL.md 当前是 .disabled 状态，Step 3 会处理 Skill 模板源统一
