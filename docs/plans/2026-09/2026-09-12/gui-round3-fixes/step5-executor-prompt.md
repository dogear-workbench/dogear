---
step: 5
title: 执行会话提示词精简
status: pending
---

## 目标
任务执行会话（无人值守）的 systemPrompt 裁剪冗余注入：砍「话题状态 + ReadGroupBackground 开局指引」子段与「笔记存卡纪律」；修复 buildGroupContextPrompt 未传 selfConversationId 导致自己出现在未提炼列表。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 5 节
- 现状：systemPrompt 在 PiSession.start() 一次性拼装（pi-session.ts:449-471）；组上下文 group-context-builder.ts buildGroupContextPrompt（话题段/指引 :81-121），调用点 pi-session.ts:411 未传 selfConversationId；追加模板 session-append-templates.ts（MEMORY_GUIDANCE_APPEND :12 / NOTES_DISCIPLINE_APPEND :19 / MAIN_AGENT_DELEGATION_APPEND :27）
- 任务执行会话创建：task-queue.ts:198（role:'main'，复用 origin groupId/modelSelection）→ attachConversation（:209）；首条 user 是 task-execution 注入段（:83-97/280）
- 保留项（不可砍）：两级 agent.md、skills 索引、协作规范 + Profile 索引（分步实施派子会话必需）、记忆规范、core-profile

## 计划改动
- [ ] 执行会话识别标记：给 attach/start 链路加显式 flag（conversation 元数据或 attach 参数，实施时选最小侵入方案），task-queue 创建时置位
- [ ] buildGroupContextPrompt 加 executor 裁剪：执行会话只保留组头/协作规范/Profile 索引，跳过「话题状态 + 指引」子段
- [ ] 同时给 buildGroupContextPrompt 传 selfConversationId（主/执行会话都传），消除「自己出现在未提炼列表」
- [ ] session-append-templates 组装：执行会话跳过 NOTES_DISCIPLINE_APPEND
- [ ] 验证：主会话注入不变（diff 两类会话的 systemPrompt 输出）；执行会话不再出现「开局先调 ReadGroupBackground」指引

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
