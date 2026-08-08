---
step: 3
title: 精简协作提示词 + 极简组上下文
status: done
---

## 目标

重写 session-append-templates.ts 中的 4 段协作提示词，极简化 group-context-builder.ts，让提示词只保留必要的行为约束。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2 已让主会话注册了 reference 工具，主会话可以自己读历史会话
- 4 段待改提示词在 `session-append-templates.ts`：REFERENCE_APPEND / groupAppendFor / MAIN_AGENT_DELEGATION_APPEND / subAgentContractFor
- 组上下文在 `group-context-builder.ts:buildGroupContextPrompt`，注入点 `pi-session.ts:247`
- 注入逻辑在 `pi-session.ts:288-296`

## 计划改动

### 1. 极简化 group-context-builder.ts

砍掉文件清单注入，只保留组名 + 一句引导：

```
## 当前会话组上下文

**组**：XXX

遇到不清楚的背景，可以先看看共享区有没有相关文件（ListGroupFiles）。
```

- [ ] 删掉 `listNativeFiles` 调用和文件列表格式化逻辑
- [ ] 删掉 token budget 截断逻辑（内容已足够短）
- [ ] 保留组名 + 创建时间

### 2. 删掉 REFERENCE_APPEND

主会话现在可以直接 ReadReferenceSession，不需要"派子会话中转"的引导。整个 `REFERENCE_APPEND` 常量删除。

- [ ] 删 `session-append-templates.ts` 中 `REFERENCE_APPEND` 定义
- [ ] 删 `pi-session.ts` 中 `if (!isSubAgent) promptParts.push(REFERENCE_APPEND)`
- [ ] 删 getSystemPromptSegments 中 key='reference-append' 条目

### 3. 删掉 groupAppendFor

组上下文已经告诉 agent 在哪个组、有共享区可查。不需要单独的"组内非首个"提示段和工具名列表。

- [ ] 删 `session-append-templates.ts` 中 `groupAppendFor` 函数
- [ ] 删 `pi-session.ts` 中 groupNameForAppend 计算逻辑和注入（约 line 249-264, 290）
- [ ] 删 getSystemPromptSegments 中 key='group-append' 条目

### 4. 精简 MAIN_AGENT_DELEGATION_APPEND

从 5 条纪律精简到核心 1 条：

```
## 主会话与子会话协作规范

用 CreateSession 派遣子会话后，必须紧接着调用 WaitForMessage 挂起等待，不要在创建后直接结束本轮——否则子会话的交付无人接收。
```

- [ ] 重写 `MAIN_AGENT_DELEGATION_APPEND` 内容
- [ ] 注入条件不变（主会话 + 有 groupId）

### 5. 精简 subAgentContractFor

保留任务 + 交付路径 + 流程强调，删掉教工具用法的步骤：

```
## 你是一个被派遣的子会话

**任务**：<task>

**建议交付路径**：<outputPath>（内容较长时先用 WriteGroupFile 写进去，SendMessage 里只放摘要）

**交付流程**：完成后用 SendMessage 向派出你的会话交付结果（delivery: true）；有歧义时先反问，不要瞎猜。你不能派遣孙子会话。
```

- [ ] 重写 `subAgentContractFor` 函数
- [ ] 删掉 ListLinkedSessions 步骤说明（工具自己描述了）
- [ ] 删掉 ReadReferenceSession 相关提示（工具自己描述了）

### 6. 清理 getSystemPromptSegments

- [ ] 删掉已移除的条目（tool-pack-guide / reference-append / group-append）
- [ ] 更新保留条目的 template 和 triggerDescription

### 7. 验证

- `bun run build:electron` 编译通过
- `bun run lint` 通过
- 手动确认主会话系统提示词不含已删除的段
- 确认 getSystemPromptSegments 不返回已删除的条目（设置页展示依赖）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无。全部按计划执行
- 改动文件清单：
  1. `electron/main/agents/group-context-builder.ts`：砍掉文件清单和 token budget，精简到组名 + 一句 ListGroupFiles 引导（100→38 行）
  2. `electron/main/agents/session-append-templates.ts`：删 REFERENCE_APPEND 和 groupAppendFor 两段，精简 MAIN_AGENT_DELEGATION_APPEND（5 条→1 句）和 subAgentContractFor（4 步→1 段），getSystemPromptSegments 从 7 条减到 5 条
  3. `electron/main/agents/pi-session/pi-session.ts`：删掉两段对应的 import 和注入逻辑，清理未使用的 conversationService / getGroup import

### 给下一步的接力棒
- 全部 3 个 step 已完成
- 最终状态：
  - 工具包导览已删除
  - 记忆提示词已修正（去 UpdateCoreProfile、加 RecallMemory 引导）
  - 主会话可直接读历史会话（不再强制派子会话中转）
  - 协作提示词从近 500 字精简到必要几句
  - 组上下文从文件清单注入精简到组名 + 一句引导
  - getSystemPromptSegments 从 8 条减到 5 条
