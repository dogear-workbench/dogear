---
step: 3
title: 轮次与小地图修正
status: pending
---

## 目标

小地图轮次头只认真人消息；注入消息并入当前轮成员并在 hover 卡片显示类型前缀；预览文本剥标签。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-fe-injected-message.md] `utils.ts` 已导出 `isInjectedUserMessage(content)`；tag→样式映射常量已建
- 当前关键文件状态：
  - `components/agent-chat/turns.ts:17` `isHeader`：`role === 'user' && !isMeta && !isCompactBoundary && !isCompactSummary && !isSdkInjectedUserMessage(content)`——sender/task-execution 注入消息全部漏网被当轮次头
  - `components/agent-chat/minimap-utils.ts` `extractMessagePreview`：只剥 referenced_articles / quoted_snippet / command 标签，不剥 sender / task-execution / failover 哨兵
  - `components/agent-chat/MessageMinimap.tsx` `turnPreviews`：`headerMsg` 提供头预览、memberIds 过滤 isMeta 等后提供成员预览
- 关键决策回顾：注入消息 = 当前轮成员（不新开轮）；成员预览带类型前缀（↩ 交付 / ↩ 回复 / ⚠ 子会话终止 / ↻ 续跑 / ▣ 任务执行）

## 计划改动

- [ ] `turns.ts` `isHeader`：加 `!isInjectedUserMessage(msg.content)`；确认文件头部 import
- [ ] `minimap-utils.ts`：`extractMessagePreview` 剥 `<sender .../>` 自闭合与 `<task-execution>...</task-execution>`（保留内部可读文本？——**不保留**，整段剥离后该消息预览为空，成员预览用类型前缀替代正文，见下条）；failover 哨兵剥离（stripFailoverContinueSentinel）
- [ ] `minimap-utils.ts` 新增 `injectedPreviewPrefix(content): string | null`：按 tag / 兜底规则返回「↩ 交付 ·」「⚠ 子会话终止 ·」等前缀（与 Step 2 兜底判定同口径，抽公共小函数避免两处漂移）
- [ ] `MessageMinimap.tsx` `turnPreviews`：成员过滤去掉注入消息的排除（保留它们），预览 = `injectedPreviewPrefix + 正文摘要`（正文为空时只显示前缀）；注入消息不参与 `userPreview`（天然不参与，因 isHeader 已排除）
- [ ] `AgentChat.tsx`：确认 turns 构建/虚拟滚动 section（`data-virtual-turn-id`）对「注入消息并入上一轮」无副作用——注入消息不再单独成 section 头部，仅作成员渲染，布局层无需改

## 验证

- 有子会话交付历史的会话：小地图 hover 卡片每轮头部只显示真人消息；交付/终态消息以「↩ 交付 ·」「⚠ …」前缀出现在成员预览区
- 预览文本不再露出 `<sender` / `<task-execution>` 原文
- 跳转：点小地图卡片仍能跳到正确轮次（注入消息并入后 jumpTargetId 语义不变，仍是 headerId 或 memberIds[0]）
- 回归：无注入消息的普通会话小地图不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
