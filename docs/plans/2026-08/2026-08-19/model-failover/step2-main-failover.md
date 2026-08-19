---
step: 2
title: failover 核心 + 主会话自动切换
status: done
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

- [x] 新 `electron/main/agents/model-failover.ts`（纯逻辑 + 编排，<300 行）：
  - `findNextFailover(chain, currentProfileId, tried): FailoverEntry | null`——plan.md 全局决策的切换语义；tried 为已试 profileId 集合
  - `buildFailoverContinuePrompt(toLabel: string): string`——续跑提示（「你因供应商费率限制中断，模型已切换为 {toLabel}，请检查已完成部分从中断处继续」同款语义）
  - `maybeFailoverMainSession(sessionId: string, result: PiSessionTurnResult): Promise<boolean>`——主会话编排：
    1. 守卫：subtype === 'failed' 且 `isQuotaErrorMessage(result.error?.message)`；`failover.enabled`；会话 role === 'main'（经 conversation-runtime 的 sessionId → conversationId → getByIdGlobal 链路）；非切换中（per-conversation settling 标志防 complete 重入）
    2. `findNextFailover` 无结果 → return false（耗尽，走原有报错渲染）
    3. `updateModelSelection(convId, entry)` → detach 主会话 attachment（holderType 'desktop'，记下 webContentsId 透传）→ `attachConversation` 重建 → 续跑提示 fire-and-forget（catch 按 complete(failed) 处理，让链路可再次触发）
    4. tried 集合记录原供应商；广播 failoverNotice
    5. 对 runtime-service / conversation-service 用 `await import()` 防循环依赖
  - `clearFailoverTried(conversationId)`——turn 成功完成时清空（broadcaster complete(success) 分支调用）
- [x] `electron/main/tipc/agent.ts`：broadcaster 的 complete 分支追加 `void maybeFailoverMainSession(sessionId, payload)`（role='main' 且 success 时 `clearFailoverTried`）；保持薄，不写业务
- [x] `electron/main/tipc/renderer-handlers.ts`：新增 `failoverNotice: (data: { conversationId: string; fromLabel: string; toLabel: string; at: number }) => void`
- [x] broadcaster 内触发 `h.failoverNotice.send(...)`（fromLabel/toLabel 从 profiles 反查 name）
- [x] 前端：`stores/conversation-store.ts`（或文件内独立小节）订阅 `failoverNotice`，存 `failoverNoticesByConversation: Record<string, FailoverNotice[]>`（保留最近 5 条）；`components/AgentChat.tsx` 渲染非持久提示条（消息流末尾、输入区上方，黄色系信息样式，含 from → to 与时间），不写入会话持久层
- [x] 测试 `electron/main/agents/model-failover.test.ts`（installDelegationMocks 基建 + DOGEAR_CONFIG_DIR）：
  - findNextFailover 矩阵：顺位下一个 / 当前不在链走链头 / tried 跳过 / 全 tried 返回 null / 空链返回 null
  - maybeFailoverMainSession：quota → updateModelSelection 收到链下一家 + detach/attach 调用序列 + sendMessage 收到续跑提示；transient/关闭开关/cancelled → false 且零调用；链耗尽 → false；二次 quota → 切到第三家（tried 生效）；complete(success) → tried 清空
- [x] 验证：`bun test electron/main/agents/` 全 pass；lint / build:electron / 前端 tsc 零新增；dev 手动——造一家假 key 供应商排进链第二位，主会话用主供应商跑长任务，改坏主供应商 key 触发 quota（或直接用假 key 主供应商），观察自动切换续跑 + 提示条（dev 走查项待主会话/用户手动验证）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `clearFailoverTried` 额外导出 session 入口版 `clearFailoverTriedBySession(sessionId)`——broadcaster 只握 sessionId，内部经 getConversationIdBySession 转换，agent.ts 接入保持两行
  2. 续跑提示失败的双路触发：PiSession.sendMessage 内部 catch 后 finally 必 emit complete(failed)，prompt 层错误天然经 broadcaster 再进 failover；仅前置 throw（未启动/已关闭）走 model-failover 内 catch 手动递归
  3. runtime-service 新增公开方法 `detachByConversationHolder(conversationId, holderType): { count; webContentsId? }`（conversation-runtime-service.ts:212）——attachmentMap 私有，按对话+holder 批量 detach 只能加公开方法，顺带返回首个匹配 attachment 的 webContentsId 供重建透传
  4. 共享 mock 增量扩展：pi-session-manager mock 补 getConversationIdBySession（新 sessionOwnerConv 反查 Map）、tipc mock 补 failoverNotice handler、runtime mock 补 detachByConversationHolder（删 attachSessionByConv 条目模拟销毁重建）——既有 bridge 测试不受影响（48 pass 验证）
- 改动文件清单：
  - 新增 `electron/main/agents/model-failover.ts`（149 行）+ `electron/main/agents/model-failover.test.ts`（6 用例）
  - 修改 `electron/main/services/conversation-runtime-service.ts`（+20 行）
  - 修改 `electron/main/tipc/agent.ts`（broadcaster +2 分支，import +1 行）
  - 修改 `electron/main/tipc/renderer-handlers.ts`（+9 行类型）
  - 修改 `stores/conversation-store.ts`（FailoverNotice 类型 + state + pushFailoverNotice + 订阅，5 处）
  - 修改 `components/agent-chat/AgentChat.tsx`（提示条 + selector，+18 行）
  - 修改 `electron/main/agents/delegation-test-mocks.ts`（mock 扩展，+12 行）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `findNextFailover(chain: FailoverEntry[], currentProfileId: string, tried: ReadonlySet<string>): FailoverEntry | null`——step3 子会话路径 decideResume 的 quota 分支改调此函数（换掉 findFallbackModel），tried 传 modelTried 解析出的 profileId 集合
  - `buildFailoverContinuePrompt(toLabel: string): string`——子会话 resume 续跑提示可复用
  - `maybeFailoverMainSession / clearFailoverTriedBySession` 已在 agent.ts broadcaster 接线完毕，step3 无需再动主会话路径
  - 前端 `FailoverNotice { fromLabel; toLabel; at }` 在 stores/conversation-store.ts，`failoverNoticesByConversation` 每会话留最近 5 条；renderer-handlers.ts 的 `failoverNotice` 事件已注册
- 下个 step 该从哪里继续：delegation-bridge.ts `decideResume`（:234）quota 分支——findFallbackModel(subAgent.profiles) 改为 loadSettings().failover 链 + findNextFailover；resumeChild 的 modelOverride 传链下一家 { profileId, tier }
- 待办或已知限制：
  - wechat-bot holder 的主会话：failover 只 detach desktop holder，bot attachment 仍持有旧 session（refCount 不归零不销毁）→ attach 复用旧 session 新模型不生效，续跑提示发旧模型直到链耗尽（罕见场景，未处理）
  - 同会话多窗口：detach 全部 desktop attachment 后仅重建一个（透传首个 webContentsId），另一窗口消息流断到刷新/重聚焦
  - pendingSteerCount>0 的 orphan 保活：release 归零但 session running → 不销毁，attach 复用旧 session（新模型不生效，下次 quota 继续顺位，settled 后 maybeCollectOrphan 回收）
  - dev 端到端（真 quota 触发切换 + 提示条 + 断点续跑不重跑）待主会话/用户手动验证
