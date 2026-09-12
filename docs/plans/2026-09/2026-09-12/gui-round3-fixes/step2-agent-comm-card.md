---
step: 2
title: agent↔agent 通讯卡统一
status: pending
---

## 目标
SendMessage 摘出工具壳改为一行收起「→ 发给 @目标会话」卡（与注入消息「← 来自 @子会话」形态对仗）；注入消息展开态上下各加一个收起触发点。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 2 节
- 现状：SendMessage 走 DeliveryCardRenderer（ToolBlock.tsx:169 分派；交付=true 绿卡 / false 键值对壳）；注入消息走 InjectedMessageCard（MessageItem.tsx:61-108，判定 :267-291），默认收起一行，色板 INJECTION_TAG_STYLES（MessageItem.tsx:21-56）
- Step 1 产出的摘壳拦截模式：ContentBlockItem 分发 + groupBlocks 排除（若 Step 1 已做成通用拦截表，本步只加条目）
- SendMessage 的 toolInput：toSessionId / message / options.delivery

## 计划改动
- [ ] 新建（或复用 Step 1 模式建）AgentCommCard：一行收起卡，方向「→ 发给 @会话名」/「← 来自 @会话名」，类型徽章与色沿用 INJECTION_TAG_STYLES，delivery=true 加绿色交付徽章
- [ ] 会话名反查：toSessionId → 会话标题（参考 SubAgentCardRenderer/ToolBlock.tsx:351-367 打开子会话的反查链路）
- [ ] ContentBlockItem 拦截 dogear__SendMessage 走 AgentCommCard（发出方向），groupBlocks 排除
- [ ] InjectedMessageCard（收到方向）：展开态顶部与底部各一个收起按钮（同一 expanded state，两处 toggle）
- [ ] 删除 DeliveryCardRenderer 及其注册（确认无其他引用）
- [ ] 历史重载验证：旧 SendMessage tool_use 块与旧注入消息（sender 标签/正则识别）两侧都走新形态

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
