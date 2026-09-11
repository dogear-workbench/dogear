---
step: 2
title: 前端注入消息渲染 + task-execution 卡片
status: done
---

## 目标

注入消息实时出现在会话流，脱离用户气泡：独立左竖线卡片按 tag 分色；`<task-execution>` 折叠卡；failover 沿用既有 Notice 样式。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-mp-injection-event.md] 主进程已广播 `{ type: 'user', content, injectedTag, timestamp }`；sender 标签带 `tag` 属性
- 当前关键文件状态：
  - `components/agent-chat/transformers.ts` `streamReducer` 的 `type === 'user'` 分支（约 :200）现只处理 wechat-bot，其余 `return updated`（忽略）
  - `components/agent-chat/utils.ts` `parseUserMessageReferences`（约 :160）已解析 sender 标签（kind/session_id/name/delivery），**未解析 tag 属性**
  - `components/agent-chat/MessageItem.tsx`：FailoverContinueNotice 组件（顶部，含 stripFailoverContinueSentinel）；用户气泡分支 `parsed.senderKind === 'agent'` 只加小徽章仍走气泡
- 关键决策回顾：历史消息无 tag 时兜底——delivery 属性 → 绿；文案关键词「终止/失败/耗尽/quota」→ 红橙；兜底蓝

## 计划改动

- [ ] `utils.ts`：sender 正则加捕获 `tag` 属性 → `parsed.senderTag`；新增导出 `isInjectedUserMessage(content: string): boolean`（sender 标签存在 / `<task-execution>` 包裹 / failover 哨兵，三者之一）；新增 `parseTaskExecution(content)` 提取 `{ title, taskId, planPath, body }`（按 task-queue.ts buildExecutionPrompt 的行格式：`任务标题：` `任务 ID：` `计划文档：` 前缀行解析，失败返回 null 走普通注入卡）
- [ ] `transformers.ts` `streamReducer`：`type === 'user'` 且 `extendedMsg.injectedTag` 存在的分支 → `createUserMessage({ content, timestamp, id: generateLocalMessageId() })` push（wechat-bot 分支保持在前不受影响）；注意该消息后续会收到 message_id 事件走既有「仅升级本地乐观 push」路径——确认注入消息是 local id 会被正确升级为 uuid
- [ ] `MessageItem.tsx`：`isUser && isFailoverContinueMessage(...)` 分支后新增注入消息分支（在用户气泡 return 之前）：
  - `isUser && parsed.senderKind === 'agent'` → `InjectedMessageCard` 组件：左 3px 彩色竖线（tag → 颜色映射，含兜底逻辑）+ 浅底色圆角卡 + 头部「来源名 + 类型徽章 + 时间」+ 正文（MarkdownRenderer 或纯文本 pre-wrap，摘要类文本用纯文本即可）+ 非 sticky、无 data-message-id 冲突问题确认（保留 data-message-id 供搜索/跳转）
  - `isUser && parseTaskExecution(...)` → `TaskExecutionCard` 折叠卡（样式对齐压缩摘要卡 Collapsible）：收起一行「任务执行会话 · 《标题》」+ 展开显示 taskId / planPath（PathChip）/ 执行约定全文
  - 注入消息不显示分叉/编辑按钮（readOnly 语义）
- [ ] 颜色映射表（tag → tailwind class）抽成模块级常量，Step 3 小地图前缀徽标可复用 tag 判定但不复用 class
- [ ] `hooks/useMessageHistory.ts` / 历史路径：历史加载的注入消息走同一 MessageItem 分支（无需改 hook，确认 history-adapter 透传的 user 消息 content 含标签原文即可）

## 验证

- dev：主会话派子会话 → 子会话交付 → 父会话**实时**出现绿色交付卡（不重载）
- 子会话失败/quota → 父会话实时红橙终态卡
- 任务队列跑一个任务 → 打开执行会话看到 task-execution 折叠卡（历史与实时两路径）
- 旧会话历史（无 tag）：重载后交付消息显示绿卡（delivery 属性兜底）
- 回归：普通用户消息气泡、wechat-bot 消息、failover 提示条不变化

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划中「isUser && parsed.senderKind === 'agent' → InjectedMessageCard」与「isUser && parseTaskExecution(...) → TaskExecutionCard」合并为一个 `isUser && isInjectedUserMessage(content)` 分支（统一口径），内部先试 parseTaskExecution（命中走折叠卡），否则 parseUserMessageReferences 走注入卡；`<task-execution>` 包裹但字段解析失败时 forcedTag='task-execution' 走普通注入卡（来源名「任务系统」）
  - 气泡分支内原「Sender 徽章：agent 跨会话消息」代码因注入卡提前 return 变成死代码，已删除（「你」徽章保留）
  - 计划要求确认的「message_id 升级」实际结论：**注入消息不会被升级为 uuid**——主进程同一 message_end 先广播 message_id 后广播内容事件，message_id 到达时消息尚未 push；local id 永久保留，无副作用（不参与分叉定位，data-message-id/搜索跳转/turns header 锚定均可用）
- 改动文件清单：
  - `components/agent-chat/types.ts`：InjectionTag 类型（:2，镜像主进程 task-types.ts）、ParsedUserMessage.senderTag（:174）、ParsedTaskExecution 接口（:184）
  - `components/agent-chat/utils.ts`：sender 正则加 tag 捕获 + 枚举校验（:124/:141）、isInjectedUserMessage（:215）、parseTaskExecution（:226）、resolveInjectionTag（:247，含 TERMINAL_HINT_RE 关键词兑底）
  - `components/agent-chat/transformers.ts`：streamReducer user 分支 injectedTag 处理（:257-265，wechat-bot 分支保持在前）
  - `components/agent-chat/MessageItem.tsx`：INJECTION_TAG_STYLES 颜色映射常量（:13）、InjectedMessageCard（:67）、TaskExecutionCard（:110）、注入分支（:258，failover 分支后）、删除气泡内死代码 agent 徽章（:354）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `isInjectedUserMessage(content): boolean`（utils.ts）：sender 标签 / `<task-execution>` 包裹 / failover 哨兵三者之一，统一口径，Step 3 小地图/turns 可直接复用
  - `resolveInjectionTag(parsed: ParsedUserMessage): InjectionTag`：senderTag → senderIsDelivery('delivery') → 终态关键词（终止/失败/耗尽/quota，测 parsed.userMessage）→ 兑底 'reply'
  - `parseTaskExecution(content): ParsedTaskExecution | null`：`{ title, taskId, planPath, body }`，字段缺失返回 null
  - INJECTION_TAG_STYLES（MessageItem.tsx 模块级）：`Record<InjectionTag, { bar, card, badge, label }>`，Step 3 复用 tag 判定但不复用 class；徽标文案 label：交付/回复/终态/恢复/任务执行/切换
  - 实时注入消息 streamReducer push 后 id 为 `local-*` 永久（message_id 先于内容事件），历史消息 id 为磁盘 uuid，两者同一 MessageItem 分支渲染
- 下个 step 该从哪里继续：Step 3 小地图：注入消息当前按既有 isHeader 规则仍算轮次 header（isSdkInjectedUserMessage 不含 isInjectedUserMessage），如需徽标/独立节点判定用 isInjectedUserMessage + resolveInjectionTag
- 待办或已知限制：
  - 旧历史 hang/timeout/cancelled 终态消息文案（「无进展中断/超时中断/已取消」）不命中决策关键词集合（终止/失败/耗尽/quota），兑底蓝色；新消息带 tag="terminal" 不受影响
  - 注入消息到达会清队列中排队消息的 isQueued 标记（user 事件共用既有清除循环，与 wechat-bot 行为一致，未改动）
