---
step: 1
title: fromSessionIds 入口校验，非法 ID 秒级报错
status: done
---

## 目标

`dogear__WaitForMessage` 收到与当前会话无直接派出关系的 sessionId 时，立即返回 isError（不进入等待），错误信息附上正确的契约通道清单，让模型下一轮自愈重试。

## 依赖上下文（接力棒输入）

- 无前置 step。本步是第一个。
- 改动对象：`electron/main/agents/tools/delegation-tools.ts:122-144`（`dogear__WaitForMessage` 工具，sharedTools 数组内，主/子会话都挂载）
- 参照模式（同文件 SendMessage，:76-95）：handler 开头 `resolveOwnConversation()` 拿 `ownSessionId`；无 sessionId 时返回 errorResult「尚未完成初始化，请稍后重试」；逐目标调 `hasDirectContractChannel(ownSessionId, targetId)`（`electron/main/services/contract-channel-service.ts:8`，双向判定持久化数据，重启安全）
- 合法清单数据源：`bridge.getChildrenByParent(opts.conversationId)`（`delegation-bridge.ts:658`）返回 `ChildStateSnapshot[]`，字段有 `sessionId?`、`title`、`status`、`delivered`、`outputPath`、`task`；行格式参照 ListLinkedSessions 的拼法（`delegation-tools.ts:158-173`）
- 子会话视角：`opts.role === 'sub'` 时合法对方只有 `opts.parentConversationId` 对应会话（取 sessionId 参照 :189-192），报错文案要区分这个场景

## 计划改动

- [x] `delegation-tools.ts` `dogear__WaitForMessage` handler：在 `loadSettings()` 之前插入校验块
  - `resolveOwnConversation()` → ownSessionId，空则 errorResult 返回
  - `args.fromSessionIds` 逐个 `await hasDirectContractChannel(ownSessionId, id)`，收集非法项
  - 存在非法项时构造 errorResult：列出非法 ID；再列出全部契约通道清单（主会话用 getChildrenByProvider；子会话用父会话单行）；结尾一句「请修正 fromSessionIds 后重试」
  - 全部合法时走原有流程（bridge.waitForMessage 调用与返回处理不动）
- [x] `WAIT_FOR_MESSAGE_DESC`（`delegation-tools.ts:39-40`）补一句：「传入的 sessionId 会做契约通道校验，无派出关系的 ID 会立即报错并返回正确清单」
- [x] 回归：`bun test electron/main/agents/delegation-*.test.ts`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：「计划改动」里的 getChildrenByProvider 实为笔误，按「依赖上下文」段用 bridge.getChildrenByParent(opts.conversationId)；其余无差异
- 改动文件清单：electron/main/agents/tools/delegation-tools.ts（WAIT_FOR_MESSAGE_DESC 补句 + WaitForMessage handler 入口校验块）

### 给下一步的接力棒
- 关键签名 / 数据结构：handler 开头顺序 = resolveOwnConversation() 判 sessionId → for 循环 hasDirectContractChannel(ownSessionId, id) 收集 invalidIds（去重）→ invalidIds.length > 0 时构造 errorResult 后才 loadSettings；报错行格式复用 ListLinkedSessions 四字段（sessionId/title/status/delivered），子会话分支用 getById(workspaceId, parentConversationId) 取父 sessionId
- 下个 step 该从哪里继续：决策 3/4（免传展开）。step2 可把「校验块」改为：args.fromSessionIds 为空且 role==='main' 时先调 bridge.getChildrenByParent 展开（过滤 status==='running' 且 sessionId 就绪）再进同一套等待流程；展开为空立即报错+ResumeSession 建议；子会话不传展开为父单元素。zod schema 需同步改 optional；显式传入分支维持本 step 校验不变
- 待办或已知限制：self 传 ownSessionId 会因 hasDirectContractChannel 双向判定失败而被拒（合理行为，未特判）；主进程已 build:electron 编译通过，应用内实测由主会话执行
