---
step: 3
title: 前端 store + useAgentSession 适配新契约
status: pending
---

## 目标

前端围绕 Step 2 的新事件契约做三件事：删 `SessionTab.isStreaming` 补丁字段、迁移所有依赖它的地方到 `runningConversationIds`、改写 `useAgentSession` 的 attach/detach 让 tab 关闭不再触发 session close。

## 依赖上下文（接力棒输入）

**必读 Step 2 的接力棒**（不要全读 Step 2 文档，只看回填的"接力棒"节）：
- 事件契约：`sessionStateChanged` / `sessionClosed` 的实际字段
- retain/release 是否有 API 变化
- hasActiveSession IPC 是否新增
- markUiDetached 是独立 IPC 还是复用 release

**当前前端状态**（探索时已确认）：
- `stores/session-store.ts:12-20` `SessionTab.isStreaming` 字段，`updateStreaming` action 在 `stores/session-store.ts:118-126`
- 唯一写入方：`components/agent-chat/AgentChat.tsx:113-118` 的 useEffect
- 读取方：`components/WorkspaceTabBar.tsx:105`（判断能否弹独立窗口）、`WorkspaceTabBar.tsx:143-144`（showPulse）
- `stores/conversation-store.ts` 有 `runningConversationIds` / `pendingActionConversationIds` 两个 Set 已存在，但更新事件源可能需要重连到 Step 2 新加的 `sessionStateChanged` / `sessionClosed`
- `useAgentSession.ts:218-227` cleanup 目前调 `client.detachConversationRuntime({attachmentId})`，需要改成"只解除订阅，不触发销毁"

## 计划改动

### 3.1 删 SessionTab.isStreaming 及其写入

- [ ] `stores/session-store.ts`：`SessionTab` 接口移除 `isStreaming` 字段
- [ ] 删除 `updateStreaming` action
- [ ] `components/agent-chat/AgentChat.tsx:113-118` 那段同步 useEffect 完全删除
- [ ] 检查 `types/electron-api.ts` 是否有 `SessionTab` 类型镜像，同步删

### 3.2 迁移 WorkspaceTabBar 读取源

- [ ] `components/WorkspaceTabBar.tsx:105` "能否弹独立窗口"的判断改读 `conversation-store.runningConversationIds.has(convId)`
- [ ] `components/WorkspaceTabBar.tsx:143-144` `showPulse` 改读同一个 Set（去掉 `tab.isStreaming || isRunning` 里的 `tab.isStreaming` 分支）
- [ ] `pendingActionConversationIds` 相关的"等待确认"徽章逻辑不变

### 3.3 conversation-store 对齐新事件

- [ ] `stores/conversation-store.ts`：把 `runningConversationIds` / `pendingActionConversationIds` 的事件订阅换到 Step 2 新的 `sessionStateChanged` / `sessionClosed`
- [ ] `sessionStateChanged` 处理：按 payload 的 running / pendingAction 分别 add/remove 对应 conversationId
- [ ] `sessionClosed` 处理：同时从两个 Set 移除该 conversationId
- [ ] 检查是否有旧的事件订阅需要清理（避免双源同时写导致 race）

### 3.4 useAgentSession 重写 attach/detach

- [ ] `components/agent-chat/hooks/useAgentSession.ts` cleanup 逻辑：
  - 原来的 `client.detachConversationRuntime` 语义变成 markUiDetached（不销毁 session，只解除订阅），跟 Step 2 后端契约对齐
  - 若 Step 2 里保留了 detach IPC 名字但改了内部语义，前端代码本身可能不用大改
  - 若 Step 2 新增了 markUiDetached IPC，前端切换 IPC 名
- [ ] attach 逻辑：
  - 若后端 upsert 复用活着的 session（Step 2 决定的方案），attach 时直接拿返回的 sessionId 订阅消息流
  - 若需要前端自己判断（hasActiveSession IPC），attach 前先查，活着走续订、死了走新建/resume
- [ ] `useMessageHistory` 加载路径不变（重开 tab 时从磁盘 jsonl 拉历史消息）

### 3.5 独立会话窗口场景

- [ ] `app/session-window/page.tsx` 也走 `useAgentSession`，逻辑改动自动覆盖，验证一次即可
- [ ] `stores/session-store.ts` 的 `sessionWindowIds` 集合是独立窗口计数，不受本次改动影响

## 验证

- `bun run lint` 通过
- `bun run build` 通过（包含前端 Vite 构建）
- 手测 golden path：
  1. 打开一个会话，让 agent 开始跑
  2. 关掉这个 tab —— 列表行圆点应该仍亮（session 保活）
  3. 重新点这个会话行 —— tab 打开，消息流继续，无空白闪烁
  4. 等 agent 跑完 → 圆点自动灭
  5. 关掉 tab —— session 被 GC
  6. 再次打开 —— 走 resume 冷启动，看到完整历史
- 手测 edge case：
  7. 会话在等 AskUserQuestion 时关 tab，重开能看到问题卡片
  8. 会话在等权限时关 tab，重开能看到权限请求卡片
  9. 快速关-开-关-开 tab，不崩溃、状态一致

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒（Step 4 需要这些）
- 是否有 edge case 手测中发现的问题：
- app 退出时的 session 清理路径是否已经就绪（还是留给 Step 4）：
- SubAgentPanel / agent-monitor 页面是否需要显示"保活但无 tab"的会话：
