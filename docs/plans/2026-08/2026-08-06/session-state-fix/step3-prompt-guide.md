---
step: 3
title: B4 主会话派遣后必须 WaitForMessage
status: done
---

## 目标

通过工具描述和系统提示词引导主会话在 CreateSession 后必须 WaitForMessage 挂起等待子会话交付。

## 依赖上下文（接力棒输入）

- 关键文件：
  - `electron/main/agents/tools/delegation-tools.ts` — CreateSession 工具定义 L170，description 在第一个参数
  - `electron/main/agents/session-append-templates.ts` — `subAgentContractFor()` L52 是子会话 append 段，主会话目前无对应段
  - `electron/main/agents/pi-session/pi-session.ts` — `start()` L280-293 组装 promptParts，当前只在 `isSubAgent` 时 push subAgentContractFor
- 子会话 SendMessage 已正确实现两条路径（waiter/queued），不需要改
- SendMessage 工具 description（delegation-tools.ts L25-31）已说明 delivery 和 waiter/queued 语义

## 计划改动

- [ ] `delegation-tools.ts`：CreateSession description 追加"创建后必须用 WaitForMessage 挂起等待交付，不要在创建后就结束本轮"
- [ ] `session-append-templates.ts`：新增 `mainAgentDelegationAppend()` 函数，内容为主会话子会话协作规范（CreateSession 后 WaitForMessage / delivery 通过工具返回 / 反问同样通过 WaitForMessage / 多子会话可同时等待）
- [ ] `session-append-templates.ts`：末尾 `getSystemPromptSegments()` 注册新段（category: 'sub-agent'，trigger: 主会话且 groupId 存在）
- [ ] `pi-session.ts`：`start()` 的 promptParts 组装中，在 `!isSubAgent && this.config.groupId` 时 push `mainAgentDelegationAppend()`
- [ ] 验证：主会话派遣子会话后走 WaitForMessage 而非 end_turn；子会话交付走 waiter 路径

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划说新增 `mainAgentDelegationAppend()` 函数，实际实现为常量 `MAIN_AGENT_DELEGATION_APPEND`（内容无动态参数，与既有静态段风格一致）。语义等价。
- 改动文件清单：
  1. `electron/main/agents/tools/delegation-tools.ts` — CreateSession description 追加 WaitForMessage 挂起等待指引
  2. `electron/main/agents/session-append-templates.ts` — 新增 `MAIN_AGENT_DELEGATION_APPEND` 常量 + getSystemPromptSegments() 注册 key=`main-agent-delegation`（category=`sub-agent`）
  3. `electron/main/agents/pi-session/pi-session.ts` — import 扩展 + start() promptParts 在 `!isSubAgent && this.config.groupId` 时 push 该段

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `MAIN_AGENT_DELEGATION_APPEND` 常量（静态字符串）
  - pi-session.ts start() L293：`if (!isSubAgent && this.config.groupId) promptParts.push(MAIN_AGENT_DELEGATION_APPEND)`
- 下个 step 该从哪里继续：B3 立即初始化，改 conversation-store.ts 的 newConversation() + useAgentSession.ts
- 待办或已知限制：无
