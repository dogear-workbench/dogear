---
step: 2
title: failover 提示改造
status: pending
---

## 目标

failover 切换时的视觉体验干净：续跑提示不再像用户手打的机器指令，横幅单条可关闭，quota 失败不再先弹系统通知 + 红色 429 Alert 吓人。

## 依赖上下文（接力棒输入）

- 调查报告（共享区 `failover-investigation.md`）§3：
  - 续跑提示 `buildFailoverContinuePrompt`（`model-failover.ts:27-29`）经 sendMessage 持久化为普通 user 消息，前端在 `ContentBlockItem.tsx:363-379` user 分支与普通消息同款渲染
  - 横幅：`components/agent-chat/AgentChat.tsx:507-518`，amber 色带，store 侧 `conversation-store.ts:813-817` slice(-5) 最多堆 5 条，无关闭无过期，纯内存态
  - 失败噪音前置链：complete(failed) → 系统通知（`electron/main/tipc/agent.ts:66-103`）+ 红色 Alert 含 429 JSON 技术详情（`ContentBlockItem.tsx:334-360`），时序在 failoverNotice 之前
- Step 1 已完成：failoverNotice 现在会触发重连。

## 计划改动

- [ ] **续跑提示标记**：先验证 pi harness 落盘链路（`pi-session.ts:644-660` appendMessage；查 `node_modules/@earendil-works/pi-agent-core/dist/harness/` 的消息结构与 pi-ai 消息类型是否支持 metadata/自定义字段透传到 history）：
  - 支持 → 附带标记字段；不支持 → 文本加哨兵前缀 `[system:failover-continue]`
  - 前端 `ContentBlockItem.tsx` 识别标记/哨兵，渲染为系统提示条样式（参照 compact boundary 的样式基调 `ContentBlockItem.tsx:33-34`），剥掉哨兵不显示
- [ ] **横幅单条化**：`conversation-store.ts:813-817` 改新切换覆盖旧条（同一 conversation 只保留最新一条）；`AgentChat.tsx:507-518` 加关闭按钮、60 秒自动过期（setTimeout 清除）
- [ ] **quota 失败降噪**（两处，判定条件：错误消息命中 `isQuotaErrorMessage` 且 `settings.failover.enabled` 且 failover 实际接管）：
  - 系统通知：`tipc/agent.ts:66-103` 的通知分支跳过 quota+failover 场景。注意主进程无法同步知道 failover 是否成功（maybeFailoverMainSession 是 fire-and-forget 编排）——可行方案：延迟发送（failover 编排成功/失败后决定发不发），或让 maybeFailoverMainSession 返回前抑制。实施时选耦合最小的方案
  - 红色 Alert：前端识别「quota 失败 + 该会话最近收到过 failoverNotice」→ Alert 降级为一行摘要（不展开 429 JSON 技术详情）。重开会话的历史 Alert 无 failoverNotice 内存态——若续跑提示标记（第一项）已落地，可用「错误消息后紧跟带标记的续跑消息」作为持久化判定依据，无需内存态
- [ ] **链耗尽保留报错**：maybeFailoverMainSession 返回 false（链耗尽/未开启）时系统通知与 Alert 原样展示——降噪改动不得影响该路径

## 验证

- 手动：构造 quota 错误（临时放宽判定）走一遍切换，确认无系统通知、无红色 Alert、只见单条横幅 + 系统条样式的续跑提示
- lint / 既有测试 / build:renderer / build:electron

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
