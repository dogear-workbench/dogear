---
step: 5
title: 执行会话提示词精简
status: done
---

## 目标
任务执行会话（无人值守）的 systemPrompt 裁剪冗余注入：砍「话题状态 + ReadGroupBackground 开局指引」子段与「笔记存卡纪律」；修复 buildGroupContextPrompt 未传 selfConversationId 导致自己出现在未提炼列表。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 5 节
- 现状：systemPrompt 在 PiSession.start() 一次性拼装（pi-session.ts:449-471）；组上下文 group-context-builder.ts buildGroupContextPrompt（话题段/指引 :81-121），调用点 pi-session.ts:411 未传 selfConversationId；追加模板 session-append-templates.ts（MEMORY_GUIDANCE_APPEND :12 / NOTES_DISCIPLINE_APPEND :19 / MAIN_AGENT_DELEGATION_APPEND :27）
- 任务执行会话创建：task-queue.ts:198（role:'main'，复用 origin groupId/modelSelection）→ attachConversation（:209）；首条 user 是 task-execution 注入段（:83-97/280）
- 保留项（不可砍）：两级 agent.md、skills 索引、协作规范 + Profile 索引（分步实施派子会话必需）、记忆规范、core-profile

## 计划改动
- [x] 执行会话识别标记：给 attach/start 链路加显式 flag（conversation 元数据或 attach 参数，实施时选最小侵入方案），task-queue 创建时置位
- [x] buildGroupContextPrompt 加 executor 裁剪：执行会话只保留组头/协作规范/Profile 索引，跳过「话题状态 + 指引」子段
- [x] 同时给 buildGroupContextPrompt 传 selfConversationId（主/执行会话都传），消除「自己出现在未提炼列表」
- [x] session-append-templates 组装：执行会话跳过 NOTES_DISCIPLINE_APPEND
- [x] 验证：主会话注入不变（diff 两类会话的 systemPrompt 输出）；执行会话不再出现「开局先调 ReadGroupBackground」指引

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 识别标记选了「conversation 元数据」而非 attach 参数：executor 是会话持久身份（重启/failover 重建 session 后 systemPrompt 裁剪仍需一致），attach 临时 flag 在 session 重建后会丢失。 ConversationIndex/ConversationCompat 均不暴露给前端，渲染层零影响。
  - buildGroupContextPrompt 签名由第三位置参数 selfConversationId 改为 opts 对象 `{ selfConversationId?, executor? }`（唯一调用点 pi-session.ts，无兼容负担）。
  - 额外同步了 getSystemPromptSegments 里 group-context / notes-discipline 两段的 triggerDescription（设置页注入时机说明与实际行为保持一致）。
- 改动文件清单：
  - electron/main/services/conversation-service.ts：ConversationIndex 加 `executor?: boolean`；create() options 加 executor 并落盘
  - electron/main/services/task-queue.ts：executeOne 创建执行会话时传 `executor: true`
  - electron/main/services/conversation-runtime-service.ts：attachConversation 透传 `executor: conversation.executor` 到 PiSessionConfig
  - electron/main/agents/pi-session/pi-session.ts：PiSessionConfig 加 `executor?`；start() 组装时 buildGroupContextPrompt 传 `{ selfConversationId: conversationId, executor: !isSubAgent && !!executor }`，role='main' 分支 executor 跳过 NOTES_DISCIPLINE_APPEND
  - electron/main/agents/group-context-builder.ts：buildGroupContextPrompt 改 opts 签名；executor=true 时直接返回组头（跳过 buildTopicStateSection）
  - electron/main/agents/session-append-templates.ts：group-context / notes-discipline 的 triggerDescription 补 executor 说明

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `ConversationIndex.executor?: boolean`（conversation-service.ts）——任务系统无人值守执行会话标记
  - `PiSessionConfig.executor?: boolean`（pi-session.ts）——runtime 从 conversation.executor 透传
  - `buildGroupContextPrompt(workspaceId, groupId, opts?: { selfConversationId?: string; executor?: boolean })`（group-context-builder.ts）
  - 验证结论（临时脚本实测真实 .dogear 数据）：① executor 模式输出 = 仅组头（无话题状态段/无 ReadGroupBackground 指引/保留 ListGroupFiles 引导）；② 主会话传 selfConversationId 后自己从【最近未提炼会话】排除（本组仅剩自己一条 stale 时列表与指引整体消失）；③ selfId 对不在列表中的会话零影响（输出 byte 级一致）
  - systemPrompt diff 摘要——普通主会话：与改动前唯一差异是 selfId 排除自身（plan 预期）；执行会话：组上下文仅组头 + 无 NOTES_DISCIPLINE_APPEND，其余（两级 agent.md/skills 索引/core-profile/记忆规范/协作规范/Profile 索引）全部保留，与设计保留清单一致；子会话：executor 强制 false，路径零变化
- 下个 step 该从哪里继续：按 plan.md 顺序进入 Step 6（设置保存并退出 + 分层生效，设计第 6 节）；pi-session.ts 的脏标记重建机制与本 step 无冲突
- 待办或已知限制：
  - 存量执行会话（本 step 前创建的）无 executor 标记，session 重建后走完整 prompt——历史任务已结束，不追补
  - 执行会话任务结束后用户继续插话时，仍维持裁剪态（话题状态/笔记纪律不回来）——设计认定执行会话身份持久，符合预期
  - bun run lint 0 errors（98 warnings 均为既有生成文件 electron.d.ts 的 any 告警）；build:electron 通过；bun test 258 pass / 0 fail
