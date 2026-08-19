---
step: 3
title: 触发点下沉 pi-session-manager
status: pending
---

## 目标

`_destroySession` 区分自然销毁与强杀，自然销毁成功后把 conversationId 交给调度器，形成完整触发链。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-scheduler-context.md] `schedulerService.handleSessionClose(conversationId: string)` 已就绪（内部解析工作区、quitting 拦截、工作区过滤、triggerContext 贯通）
- 关键现状（本会话已调查）：
  - `electron/main/agents/pi-session/pi-session-manager.ts:209` `_destroySession(sessionId)`：先摘 `sessions`/`refCounts`/`conversationSessionMap`（循环删 sid 匹配项），再 `await session.close()`（吞错）
  - 调用方：`release`（pi-session-manager.ts:150，非 running 分支）→ natural；`maybeCollectOrphan`（:173，orphan settled 回收）→ natural；`closeSession`（:168，强杀）→ forced；`closeAll`（:239 附近，退出路径，实现细节执行时核对，统一 forced）
  - `conversationSessionMap` 是 conversationId → sessionId 的 Map，摘除循环里可同时捕获 conversationId
- 关键决策回顾：fire-and-forget（动态 import + catch，失败只 log），绝不阻塞/影响销毁流程；conversationId 必须在摘除 Map **之前**拿到

## 计划改动

- [ ] `pi-session-manager.ts` `_destroySession(sessionId, source: 'natural' | 'forced')`，三个调用方对应传参
- [ ] `_destroySession` 内：摘 `conversationSessionMap` 循环时收集 conversationId；`await session.close()` 成功后，若 `source === 'natural'` 且拿到 conversationId，`void import('../../services/scheduler/scheduler-service.js').then((m) => m.getSchedulerService().handleSessionClose(conversationId)).catch(...)` warn 兜底
- [ ] 日志：natural 触发时 `logger.info('会话自然销毁，通知调度器', convId)` 一条
- [ ] `bun run build:electron` 编译通过 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
