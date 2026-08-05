---
step: 2
title: 委派桥接与前端状态呈现
status: done
---

## 目标

让委派桥接按 PiSession 的真实结算结果分类子会话，并在左侧列表、父会话等待面板和子会话页面展示一致状态与原因。

## 依赖上下文（接力棒输入）

- 前置 step 产出：PiSession 已即时广播 `running=true`，并以结构化终态报告 success/failed/cancelled。
- 当前 `delegation-bridge.ts:151` 在 complete 回调中无条件把仍运行的 child 标为 `no_delivery`；当前 `wireSession` 同时监听 complete 与 error，见 `:124`。
- 当前 ChildStatus 定义在 `electron/main/types.ts:222`；`ChildStateSnapshot` 已有 `errorMessage`，见 `:229`。
- 前端运行态消费点为 `stores/conversation-store.ts:780`，聊天页使用 `runningConversationIds`，见 `components/agent-chat/AgentChat.tsx:100`；左侧会话行目前没有 child 终态映射。

## 计划改动

- [ ] 调整 `delegation-bridge.ts` 的 session wiring：依据 Step 1 终态将 child 分类为 `done`、`failed`、`no_delivery`、`cancelled` 或 `timeout`，并只在安全结算点 detach attachment。
- [ ] 完善 `ChildStateSnapshot` 的终态原因字段与前后端镜像类型；保持 `errorMessage` 对模型错误、超时、取消和未交付可读。
- [ ] 确保 `childStatusChanged` 和 `deliveriesAwaitChanged` 在创建、结算、停止、交付与异常顺序下均广播一次有效快照；冷启动 `listAllChildren` 结果与增量事件格式一致。
- [ ] `stores/conversation-store.ts` 建立 child conversation ID 到状态快照的派生查询，避免 `ConversationRow` 只知道普通运行 Set 而丢失 failed/no_delivery。
- [ ] `ConversationRow.tsx` 显示运行脉冲、失败/超时/取消、未交付等状态和 tooltip；父会话的等待区应统计运行、完成及异常，不能把 no_delivery 当完成交付。
- [ ] `AgentChat`、`useAgentSession`、`useSessionMessages` 处理晚打开回放：接收 snapshot 后去重呈现消息、权限和终态，不因后台派遣而依赖本地 `isLoading`。

## 实施回填（做完后填）

### 实际改动
- bridge 只消费 PiSession 的结构化 `complete` 终态：正常未交付为 `no_delivery`，失败为 `failed`，中断为 `cancelled`；所有 attachment 都在该安全结算点回收。
- runtime attach 返回实时消息、权限请求及运行状态快照。`useAgentSession` 把权威状态写入 store，并通过 `streamReducer` 回放快照，消除依赖延时 IPC 广播的晚打开竞态。
- conversation store 建立 `childSnapshotsById` 索引；会话行和子会话页面显示运行、交付、失败、超时、取消及未交付原因。父会话等待区分别统计已交付与异常，未交付不计为完成。
- 与计划差异：现有 `ChildStateSnapshot.errorMessage` 已同时镜像主进程与前端，未新增重复的终态原因字段。
- 改动文件清单：
  - `electron/main/agents/delegation-bridge.ts`
  - `electron/main/agents/pi-session/pi-session.ts`
  - `electron/main/services/conversation-runtime-service.ts`
  - `electron/main/tipc/conversation-runtime.ts`
  - `stores/conversation-store.ts`
  - `components/conversation-list/ConversationRow.tsx`
  - `components/agent-chat/AgentChat.tsx`
  - `components/agent-chat/StreamingIndicator.tsx`
  - `components/agent-chat/hooks/useAgentSession.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：`attachConversationRuntime` 返回 `snapshot`、`pendingPermissionRequests` 和 `sessionState`；`childSnapshotsById[conversationId]` 是子会话终态的前端查询入口。
- 下个 step 该从哪里继续：执行真实派遣回归，尤其验证未打开子会话、晚打开、模型错误、取消与超时的状态和 attachment 回收。
- 待办或已知限制：未在本机发起真实模型任务；需要 Step 3 按场景验收。
