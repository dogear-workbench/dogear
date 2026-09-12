---
step: 1
title: 通讯卡视觉与交互修正
status: done
---

## 目标
AgentCommCard / InjectedMessageCard / TaskReportMessage 三类消息流卡完成视觉修正：字号调小、展开态可见完整目标信息、收起触发点重排、底色中性化。

## 依赖上下文（接力棒输入）
- 关键文件：`components/agent-chat/AgentCommCard.tsx`（AgentCommCard + CommCollapseButton）、`components/agent-chat/MessageItem.tsx`（InjectedMessageCard）、`components/agent-chat/injection-tags.ts`（INJECTION_TAG_STYLES）、`components/agent-chat/TaskReportMessage.tsx`
- 关键决策回顾：用户反馈「字体太大」「@谁展开要看清所有」「上面触发点与卡片自身重复、下面右下角太小」「最终交付别要颜色」。竖线保留类型色、底色走中性是拍板结论——大面积底色是难看主因，小色块承载类型语义

## 计划改动
- [x] `injection-tags.ts`：全部 tag 的 `card` 改 `bg-secondary/60`（bar/badge 不动）
- [x] `TaskReportMessage.tsx:52` 卡壳 `bg-blue-50/70 dark:bg-blue-950/20` → `bg-secondary/60`，图标蓝色保留
- [x] `AgentCommCard.tsx`：
  - 展开态正文 `MarkdownRenderer className="text-sm"` → `text-xs`
  - 展开态删顶部 `<div className="flex justify-end"><CommCollapseButton/></div>`
  - 展开态顶部加完整目标行：`→ 发给 @{完整会话名} · {sessionId}`（不 truncate，`break-all`；无会话名时显示完整 sessionId）
  - 底部 CommCollapseButton 替换为整行宽收起条：`<button className="w-full flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:bg-muted/50 rounded">收起 + ChevronUp</button>`
- [x] `MessageItem.tsx` InjectedMessageCard：
  - 展开态正文 `text-sm` → `text-xs`
  - 删顶部 CommCollapseButton；顶部加来源信息行（`来源：{senderDisplayName} · {senderSessionId}`，取自 parsed，sessionId 缺省时省略）
  - 底部同样换整行宽收起条
- [x] `CommCollapseButton` 导出若再无消费方则删除；两卡的收起条若样式一致可抽成小组件放 AgentCommCard.tsx（或就地复制，二选一，倾向抽 `CommCollapseBar` 导出共用）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异；CommCollapseButton → CommCollapseBar 采共用方案，组件签名从 `onClick` 改为 `onCollapse`；展开态目标行无会话名时只显示完整 sessionId（不重复拼 ` · sessionId`）；lint 0 errors（98 warnings 与基线一致），tsc 渲染层/electron 层均零错误
- 改动文件清单：
  - `components/agent-chat/injection-tags.ts`：6 个 tag 的 `card` 全部 `bg-secondary/60`，bar/badge 不动，顶部注释同步更新
  - `components/agent-chat/TaskReportMessage.tsx:52`：卡壳 → `bg-secondary/60`，竖线/图标蓝色保留
  - `components/agent-chat/AgentCommCard.tsx`：CommCollapseBar 导出（替 CommCollapseButton）；展开态正文 `text-xs`；顶部完整目标行 `发给 @{完整会话名} · {sessionId}`（break-all）；底部 CommCollapseBar
  - `components/agent-chat/MessageItem.tsx`：InjectedMessageCard 正文 `text-xs`；顶部来源行 `来源：{sourceName} · {senderSessionId}`（sessionId 缺省省略）；底部 CommCollapseBar；import 换 CommCollapseBar

### 给下一步的接力棒
- 关键签名 / 数据结构：`<CommCollapseBar onCollapse={() => setExpanded(false)} />`（从 `./AgentCommCard` 导出，整行宽收起条）；`INJECTION_TAG_STYLES[tag]` 结构不变（bar/card/badge/label），card 恒为 `bg-secondary/60`
- 下个 step 该从哪里继续：按 plan.md 顺序读 round4 下一个 step 文档；本 step 不涉及主进程，无需 build:electron
- 待办或已知限制：收起态头部 `@{peerName ?? sessionId.slice(0,8)}…` 的截断显示保持原样（用户反馈只针对展开态）
