---
step: 5
title: 分流建议卡
status: pending
---

## 目标

agent 检测岔题后在回复末尾输出结构化建议（文本协议），前端 MessageItem 解析渲染为三按钮建议卡（非阻塞）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1–4 与本 step 无代码依赖（建议卡只做渲染，不依赖 personal）；可并行于 Step 4
- 关键现状签名：
  - 前端已有「agent 文本 → 结构化渲染」先例：`MessageItem.tsx:123` 解析 planPath 渲染计划链接；`useSendMessage.ts:335` 注入 `<conversation>` 标签
  - 岔题信号（设计约定）：「另外/顺便/以后是不是/先记下来」类措辞、与当前目标无共享交付物、需要不同工具/文件/工作区
- 关键决策回顾：建议卡是**事后建议非阻塞等待**（与 AskUserQuestionCard 的暂停语义不同）；agent 只建议不执行；协议格式本 step 定稿并回填 plan.md 全局决策 6

## 计划改动

- [ ] 定文本协议：建议 fenced JSON 块（如 ```shunt-suggestions {"summary":"...","options":["new-session","new-topic","note"]}```），定稿后回填 plan.md 全局决策；注意与现有 markdown 渲染的冲突（代码块会被渲染为代码——需在 MarkdownRenderer 之前截获或在 MessageItem 层预处理，方案回填记录）
- [ ] 提示词：`session-append-templates.ts` 加分流引导段（activeAbilities 条件注入）：何时输出建议块、summary 要短、不要每条消息都建议、用户明确说「另开/记下来」时直接在回复中引导点按钮
- [ ] `MessageItem.tsx`（或新组件 `ShuntSuggestionCard`）：解析 assistant 文本末尾的建议块 → 渲染摘要 + 三按钮（另起会话/另起话题/记为笔记）；点击行为本 step 只做「插入输入框气泡」的占位调用（Step 6 提供真实实现），未实现前按钮可先 disabled 或最小 toast——回填记录选择
- [ ] 流式期间的处理：建议块在流式输出中途会出现半截 JSON——解析容错（不完整不渲染，流结束再渲染）
- [ ] `bun run lint` + 手动验收

## 验收

- [ ] 会话中问「另外我想到以后能不能支持 RSS」类岔题 → agent 回复末尾出现建议卡（摘要 + 三按钮）
- [ ] 正常工作消息不触发建议卡（提示词克制）
- [ ] 流式过程中卡片不闪烁/不出半截
- [ ] 历史加载后建议卡正常渲染（transcript 回放）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
