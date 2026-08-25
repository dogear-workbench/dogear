---
step: 2
title: 触发点下沉 pi-session-manager + failover 排除
status: done
---

## 目标

`_destroySession` 区分自然销毁与强杀，自然销毁成功后把 conversationId 交给调度器形成完整触发链；failover 换血的 detach 链路透传 forced，不误触发。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-scheduler-context.md] `schedulerService.handleSessionClose(conversationId: string)` 已就绪（quitting 拦截、工作区过滤、triggerContext 贯通、精准提炼入口）
- 关键现状（冲突核查已确认，行号基于 5917f26）：
  - `electron/main/agents/pi-session/pi-session-manager.ts:213` `_destroySession(sessionId)`：先摘 `sessions`/`refCounts`/`conversationSessionMap`（:215-217 循环删 sid 匹配项），再 `await session.close()`（吞错）
  - 调用方：`release`（:152，非 running 分支 :156-158）→ natural；`maybeCollectOrphan`（:177）→ natural；`closeSession`（:168）→ forced；**`closeAll`（:238）不走 `_destroySession`**（直接 clear 三个 Map），退出路径天然不触发，无需处理
  - `conversationSessionMap`（:43）是 conversationId → sessionId 的 Map，摘除循环里可同时捕获 conversationId
  - failover 换血路径（需排除）：`model-failover.ts:102` `detachByConversationHolder(conversationId, 'desktop')`（turn 已 failed、session 非 running）→ `conversation-runtime-service.ts` `detachByConversationHolder`（:203）→ `detachAttachment`（:181）→ `release`（:196）→ `_destroySession`——与用户关 tab 形态完全相同
  - `detachByWebContentsId`（conversation-runtime-service.ts:220，独立窗口关闭）与前端关 tab 的 detachAttachment 调用方不传 source（默认 natural）
- 关键决策回顾：fire-and-forget（动态 import + catch，失败只 log），绝不阻塞/影响销毁流程；conversationId 必须在摘除 Map **之前**拿到

## 计划改动

- [x] `pi-session-manager.ts` `_destroySession(sessionId, source: 'natural' | 'forced')`；`release(sessionId, source?)`（默认 natural）、`maybeCollectOrphan` 传 natural、`closeSession` 传 forced
- [x] `_destroySession` 内：摘 `conversationSessionMap` 循环时收集 conversationId；`await session.close()` 成功后，若 `source === 'natural'` 且拿到 conversationId，`void import('../../services/scheduler/scheduler-service.js').then((m) => m.getSchedulerService().handleSessionClose(conversationId)).catch(...)` warn 兜底
- [x] failover 排除：`conversation-runtime-service.ts` `detachAttachment(attachmentId, source?)`、`detachByConversationHolder(conversationId, holderType, source?)` 加可选参数透传到 `release`；`model-failover.ts:102` 调用处传 `'forced'`；`detachByWebContentsId` 与其余调用方不传（默认 natural）
- [x] 日志：natural 触发时 `logger.info('会话自然销毁，通知调度器', convId)` 一条
- [x] `bun run build:electron` 编译通过 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - source 类型提取为导出别名 `SessionCloseSource = 'natural' | 'forced'`（pi-session-manager.ts 导出），conversation-runtime-service type-import 复用，避免两处内联联合类型重复
  - conversationSessionMap 摘除循环改为数组收集 conversationIds（防御多绑定形态），natural 时逐个 fire-and-forget 触发；实际绑定是一对一，数组长度 1
  - 调度器通知放在 `session.close()` try/catch 之后（而非 try 内）：close 兜底吞错时 manager 层销毁已完成，通知应继续
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session-manager.ts`：导出 `SessionCloseSource`；`release(sessionId, source?)`（默认 natural）、`closeSession` 固定 forced、`maybeCollectOrphan` 固定 natural、`_destroySession(sessionId, source)` 摘除时收集 convId + close 后 natural 通知调度器（动态 import + catch 兜底）
  - `electron/main/services/conversation-runtime-service.ts`：`detachAttachment(attachmentId, source?)`、`detachByConversationHolder(conversationId, holderType, source?)` 可选参数透传到 `release`；`detachByWebContentsId` 未加参数（默认 natural）
  - `electron/main/agents/model-failover.ts:102`：`detachByConversationHolder(conversationId, 'desktop', 'forced')`
- lint：0 errors / 74 warnings（全部为未触碰文件既有 warning，本次 3 个文件 0 warning）；build:electron：tsc exit 0

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `PiSessionManager.release(sessionId: string, source?: SessionCloseSource): Promise<number>`（默认 'natural'）
  - `SessionCloseSource = 'natural' | 'forced'`（pi-session-manager.ts 导出，唯一类型源）
  - `conversationRuntimeService.detachAttachment(attachmentId, source?)` / `detachByConversationHolder(conversationId, holderType, source?)`（默认 natural）
  - 完整触发链：detach/release 归零 → `_destroySession(natural)` → 摘 Map 收集 convId → close 后 → `getSchedulerService().handleSessionClose(convId)`（fire-and-forget）
- 下个 step 该从哪里继续：step3 从 `electron/main/index.ts:303-308` 旧触发段删除开始（Step 1 已把该处传参改为 conversationId，当前独立窗口关闭会双发：旧链路 + 新 detach 链路，删整段即消）
- 待办或已知限制：
  - index.ts 旧触发段仍在（双发待 step3 删除）；其余见 step1 交付的全工作区任务不响应、failStreaks 拦截等已确认限制
  - `attachConversation` start 失败的 closeSession 路径：bindConversation 在 start 成功后才调，_destroySession 拿不到 convId，天然不触发
