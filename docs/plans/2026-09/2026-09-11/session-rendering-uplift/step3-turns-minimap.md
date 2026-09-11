---
step: 3
title: 轮次与小地图修正
status: done
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
  - injectedPreviewPrefix 增加 task-execution 前置判定（parseTaskExecution 命中或包裹残留）——resolveInjectionTag 不认 task-execution 包裹会兑成「回复」，补上与 MessageItem forcedTag 同口径
  - failover 哨兵特判「⇄ 切换」（step 前缀枚举未列，防关键词漂移）
  - 分隔符「 · 」由 MessageMinimap 拼装而非前缀自带（正文空只显前缀不残留尾分隔符）
  - 返工补丁：成员预览 prefix 计算加 `m.role === 'user'` 门槛（assistant 正文含 `<sender` 代码样例不误加前缀）
- 改动文件清单：`turns.ts`（isHeader 加 !isInjectedUserMessage，:26-27）、`minimap-utils.ts`（extractMessagePreview 剥 failover 哨兵/sender/task-execution 整段；INJECTED_PREVIEW_PREFIXES + injectedPreviewPrefix，:41-61）、`MessageMinimap.tsx`（成员过滤只排命令类 SDK 注入，预览 = 前缀 · 正文）
- 确认项结论：AgentChat 布局层无副作用——渲染层已不存在 data-virtual-turn-id（虚拟滚动已移除，StableHistory 渲染 section.agent-turn），注入消息并入上一轮仅改变 section 内成员归属

### 给下一步的接力棒
- 关键签名 / 数据结构：`injectedPreviewPrefix(content): string | null`（↩ 交付/↩ 回复/⚠ 子会话终止/↻ 续跑/▣ 任务执行/⇄ 切换，非注入 null）；成员预览前缀仅对 role='user' 生效；jumpTargetId = headerId ?? memberIds[0] 未动
- 下个 step 该从哪里继续：Step 4 工具渲染三件套（ReportTaskResult / NoteCard / SendMessage 交付卡）
- 待办或已知限制：
  - MessageMinimap 当前轮高亮因 data-virtual-turn-id 不存在恒失效（既有问题非本 step 引入，待主会话定夺是否清理）
  - task-execution 成员预览只显「▣ 任务执行」，如需标题属计划变更
  - dev GUI 人工项（hover 前缀、跳转、真实历史回归）待用户回归
