---
step: 2
title: agent↔agent 通讯卡统一
status: done
---

## 目标
SendMessage 摘出工具壳改为一行收起「→ 发给 @目标会话」卡（与注入消息「← 来自 @子会话」形态对仗）；注入消息展开态上下各加一个收起触发点。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 2 节
- 现状：SendMessage 走 DeliveryCardRenderer（ToolBlock.tsx:169 分派；交付=true 绿卡 / false 键值对壳）；注入消息走 InjectedMessageCard（MessageItem.tsx:61-108，判定 :267-291），默认收起一行，色板 INJECTION_TAG_STYLES（MessageItem.tsx:21-56）
- Step 1 产出的摘壳拦截模式：ContentBlockItem 分发 + groupBlocks 排除（若 Step 1 已做成通用拦截表，本步只加条目）
- SendMessage 的 toolInput：toSessionId / message / options.delivery

## 计划改动
- [x] 新建（或复用 Step 1 模式建）AgentCommCard：一行收起卡，方向「→ 发给 @会话名」/「← 来自 @会话名」，类型徽章与色沿用 INJECTION_TAG_STYLES，delivery=true 加绿色交付徽章
- [x] 会话名反查：toSessionId → 会话标题（参考 SubAgentCardRenderer/ToolBlock.tsx:351-367 打开子会话的反查链路）
- [x] ContentBlockItem 拦截 dogear__SendMessage 走 AgentCommCard（发出方向），groupBlocks 排除
- [x] InjectedMessageCard（收到方向）：展开态顶部与底部各一个收起按钮（同一 expanded state，两处 toggle）
- [x] 删除 DeliveryCardRenderer 及其注册（确认无其他引用）
- [x] 历史重载验证：旧 SendMessage tool_use 块与旧注入消息（sender 标签/正则识别）两侧都走新形态

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - INJECTION_TAG_STYLES 未从 MessageItem.tsx 直接导出，而是抽到新模块 injection-tags.ts：ContentBlockItem→AgentCommCard→MessageItem 会成循环 import，抽模块一并解决；色板值未变，MessageItem 改为 import
  - AgentCommCard 只实现发出方向：收到方向本 step 仍由 InjectedMessageCard 承担（user 消息路径，识别逻辑未动），未做组件迁移；两卡形态已对仗（同款竖线卡 + 一行收起 + 展开态上下收起按钮）
  - 会话名反查落在 AgentCommCard 内部 hook：本地 conversation store → client.getByWorkspaceId 兑底（同 ToolBlock 打开子会话口径），反查不到显示 sessionId 前 8 位，title 提示完整 id
- 改动文件清单：
  - 新增 components/agent-chat/AgentCommCard.tsx（AgentCommCard + CommCollapseButton 导出；usePeerConversationName 私有 hook）
  - 新增 components/agent-chat/injection-tags.ts（INJECTION_TAG_STYLES）
  - 改 ContentBlockItem.tsx（dogear__SendMessage → AgentCommCard，传 timestamp）、MessageItem.tsx（import 色板；InjectedMessageCard 受控展开 + 展开态顶/底收起按钮）、session-tools.ts（加 'dogear__SendMessage'，groupBlocks 排除自动生效）、ToolBlock.tsx（三表删 dogear__SendMessage 条目 + Send 图标 import 清理）
  - 删 tool-renderers/DeliveryCardRenderer.tsx（全仓引用仅 ToolBlock 一处，已同步清理）
- 验证：lint 0 errors（98 warnings 与基线一致）；tsc --noEmit 渲染层零错误；未改 electron/ 文件无需 build:electron；历史重载两侧确认——旧 SendMessage tool_use 块持久化在 contentBlocks 走同一分发（toolInput 结构 toSessionId/message/options.delivery 未变），旧注入消息识别路径未动

### 给下一步的接力棒
- 关键签名 / 数据结构：`<AgentCommCard toolInput toolOutput isError timestamp />`；running = toolOutput === undefined → 「发送中」spinner；isError → 红「发送失败」徽章 + 收起行 preview 换错误首行 + 展开态错误 pre；delivery=true → INJECTION_TAG_STYLES.delivery 绿徽章「交付」，否则 reply 蓝徽章「消息」（与主进程 delegation-tools label 口径一致）；CommCollapseButton 从 AgentCommCard.tsx 导出，注入卡/通讯卡共用；INJECTION_TAG_STYLES 在 injection-tags.ts
- 下个 step 该从哪里继续：Step 3（等待图标/插话提示）与本 step 无文件交集（AwaitingDeliveryIndicator.tsx / AgentChat.tsx / ChatInputArea.tsx）；若后续小地图/其他组件要复用 tag 色板，从 injection-tags.ts 拿
- 待办或已知限制：InjectedMessageCard 未迁移为 AgentCommCard（行首仍是 Bot 图标 + 来源名，无「← 来自」文案；若要完全统一由主会话拍板后再动）；AgentCommCard 会话名反查只查当前工作区（与 ToolBlock 打开子会话口径一致，跨工作区目标显示 sessionId 短形式）
