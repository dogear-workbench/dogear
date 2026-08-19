---
step: 2
title: failover 核心 + 主会话自动切换
status: pending
---

## 目标

主会话 turn 因 quota 失败时：自动切换到链上下一家供应商、销毁重建 session、发续跑提示从断点继续；聊天流出现切换提示条；链耗尽才报错停止。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-settings.md] failover 配置已可读——`loadSettings()` 返回值带 `failover: { enabled, chain }`（normalize 保证非空 chain 结构合法）
- 当前关键文件状态：
  - `electron/main/agents/delegation-terminal.ts:32` `isQuotaErrorMessage(message: string): boolean`——quota 关键词判定，直接 import 复用
  - `electron/main/tipc/agent.ts` L41-80：`setBroadcaster` 回调，`complete` 事件分支已存在（转发渲染层 + handleSessionNotification 有 `getConversationIdBySession` → `getByIdGlobal` → `role === 'main'` 的角色查法先例）
  - `electron/main/services/conversation-service.ts:475` `updateModelSelection(workspaceId, id, modelSelection | null)`
  - `electron/main/services/conversation-runtime-service.ts:60` 起 `attachConversation(workspaceId, conversationId, holderType, options?)` / detach 对应方法；attachmentMap + refCount 语义
  - `electron/main/tipc/renderer-handlers.ts:36` 起现有 renderer handler 定义（queryBasedSessionMessage 等），`childStatusChanged`（L213）是自定义事件先例
  - `stores/conversation-store.ts:843` `rendererEvents.childStatusChanged.listen` 是前端订阅先例
- 关键决策回顾：切换必须先 detach 让旧 session 销毁（attach 复用存活 session 不重读 modelSelection）；cancelled/开关关闭不触发；tried 内存级 per-conversation、turn 成功清空；编排函数独立 export 可测，broadcaster 只留薄调用

## 计划改动

- [ ] 新 `electron/main/agents/model-failover.ts`（纯逻辑 + 编排，<300 行）：
  - `findNextFailover(chain, currentProfileId, tried): FailoverEntry | null`——plan.md 全局决策的切换语义；tried 为已试 profileId 集合
  - `buildFailoverContinuePrompt(toLabel: string): string`——续跑提示（「你因供应商费率限制中断，模型已切换为 {toLabel}，请检查已完成部分从中断处继续」同款语义）
  - `maybeFailoverMainSession(sessionId: string, result: PiSessionTurnResult): Promise<boolean>`——主会话编排：
    1. 守卫：subtype === 'failed' 且 `isQuotaErrorMessage(result.error?.message)`；`failover.enabled`；会话 role === 'main'（经 conversation-runtime 的 sessionId → conversationId → getByIdGlobal 链路）；非切换中（per-conversation settling 标志防 complete 重入）
    2. `findNextFailover` 无结果 → return false（耗尽，走原有报错渲染）
    3. `updateModelSelection(convId, entry)` → detach 主会话 attachment（holderType 'desktop'，记下 webContentsId 透传）→ `attachConversation` 重建 → 续跑提示 fire-and-forget（catch 按 complete(failed) 处理，让链路可再次触发）
    4. tried 集合记录原供应商；广播 failoverNotice
    5. 对 runtime-service / conversation-service 用 `await import()` 防循环依赖
  - `clearFailoverTried(conversationId)`——turn 成功完成时清空（broadcaster complete(success) 分支调用）
- [ ] `electron/main/tipc/agent.ts`：broadcaster 的 complete 分支追加 `void maybeFailoverMainSession(sessionId, payload)`（role='main' 且 success 时 `clearFailoverTried`）；保持薄，不写业务
- [ ] `electron/main/tipc/renderer-handlers.ts`：新增 `failoverNotice: (data: { conversationId: string; fromLabel: string; toLabel: string; at: number }) => void`
- [ ] broadcaster 内触发 `h.failoverNotice.send(...)`（fromLabel/toLabel 从 profiles 反查 name）
- [ ] 前端：`stores/conversation-store.ts`（或文件内独立小节）订阅 `failoverNotice`，存 `failoverNoticesByConversation: Record<string, FailoverNotice[]>`（保留最近 5 条）；`components/AgentChat.tsx` 渲染非持久提示条（消息流末尾、输入区上方，黄色系信息样式，含 from → to 与时间），不写入会话持久层
- [ ] 测试 `electron/main/agents/model-failover.test.ts`（installDelegationMocks 基建 + DOGEAR_CONFIG_DIR）：
  - findNextFailover 矩阵：顺位下一个 / 当前不在链走链头 / tried 跳过 / 全 tried 返回 null / 空链返回 null
  - maybeFailoverMainSession：quota → updateModelSelection 收到链下一家 + detach/attach 调用序列 + sendMessage 收到续跑提示；transient/关闭开关/cancelled → false 且零调用；链耗尽 → false；二次 quota → 切到第三家（tried 生效）；complete(success) → tried 清空
- [ ] 验证：`bun test electron/main/agents/` 全 pass；lint / build:electron / 前端 tsc 零新增；dev 手动——造一家假 key 供应商排进链第二位，主会话用主供应商跑长任务，改坏主供应商 key 触发 quota（或直接用假 key 主供应商），观察自动切换续跑 + 提示条

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
