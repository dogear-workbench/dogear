---
step: 4
title: UI 与收尾
status: pending
---

## 目标

子会话图标换 Network、删状态文字徽章，全量回归验证，codebase-map 同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-tools-prompts.md] 工具层与提示词已对齐新模型；快照/工具返回全部为 running/stopped + delivered 形态
- 当前关键文件状态：
  - `components/conversation-list/ConversationRow.tsx` — 图标优先级链（:107-122）：StatusPulse → CircleCheck（done）→ Ban（cancelled/interrupted）→ CircleAlert（childSnapshot 其他）→ GitBranch（isFork = `!!conv.parent_conversation_id`，:68）→ Workflow → MessagesSquare；状态徽章函数（:22-32）产出「子会话运行中 / 已交付 / 未交付」文字标签
  - `components/agent-chat/AgentChat.tsx:37-42` — running/done/no_delivery 状态文案 map（Step 1 做了最小适配，本步核对场景语义）
  - `components/agent-chat/StreamingIndicator.tsx:32` — 「等待 N 个子会话交付」指示条（保留，不属于列表徽章）
- 关键决策回顾：用户拍板——状态图标已足够表达，文字徽章全删；子会话用 Network（lucide，节点连接，表达「协作网络的一员」，项目内无占用）；手动分叉保留 GitBranch 不动

## 计划改动

- [ ] `ConversationRow.tsx` 图标优先级 — `isAgentConversation`（`conv.contractMetadata?.createdBy === 'agent'`，:69 已有）**提前到 isFork 之前**：子会话 → Network（选中蓝/默认 muted，与 MessagesSquare 同配色策略）；其余链路不变（isFork GitBranch 紫色保留给手动分叉）
- [ ] `ConversationRow.tsx` 状态图标对齐新模型 — running → StatusPulse；stopped & delivered → CircleCheck；stopped 未交付 → Ban（muted）；childSnapshot 缺失走默认图标
- [ ] `ConversationRow.tsx` — 删状态文字徽章渲染（:22-32 的 label/className 产出函数及其 JSX 挂点，保留 title 悬停提示可选）
- [ ] `AgentChat.tsx:37-42` — 状态文案 map 核对：该 map 若用于子会话状态 toast/横幅，对齐新状态集（running / stopped+delivered / stopped 未交付）；若 Step 1 已处理则跳过
- [ ] `docs/codebase-map.md` — delegation-persist.ts 条目删除、delegation-bridge 条目改写（去持久化描述、状态模型、连续计数、补集截断）、ListGroupFiles / ResumeSession 描述更新
- [ ] 全量验证：`bun run build:electron` + `bun run lint` + `bun test`
- [ ] dev 走查清单：
  - 子会话列表图标为 Network，手动分叉仍是 GitBranch
  - 无文字徽章；运行中脉冲 / 交付绿勾 / 停止禁止图标正常
  - 派一个子会话 → no_delivery（或等正常完成）→ 让它补交付 → 绿勾落上（卡死 bug 修复的 UI 端验证）
  - 重启应用 → ListLinkedSessions 补集返回 → ResumeSession 调起续跑
  - 旧 `.dogear/delegation-state.json` 启动即被清理

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 完成总结（全部 step 打勾后回填到 plan.md）
- 实际改动汇总、与原计划的偏差
