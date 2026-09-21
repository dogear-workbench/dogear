---
step: 5
title: 分流建议卡
status: done
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

- [x] 定文本协议：fenced JSON 块（定稿为 ```shunt-suggestions + `{"summary","options"}`，options 为三动作子集），已回填 plan.md 全局决策 6；与 markdown 渲染的冲突方案 = 新增 `ShuntAwareMarkdown` 在 MarkdownRenderer 之前截获（不改 MarkdownRenderer 本身）
- [x] 提示词：`session-append-templates.ts` 加 `SHUNT_GUIDANCE_APPEND` 分流引导段（activeAbilities 条件注入：notes 包 + 非 executor，与存卡纪律同条件）
- [x] 新组件 `shunt-suggestions.tsx`（解析 + 卡片 + 包装渲染），接入 `MessageItem.tsx` content 分支与 `ContentBlockItem.tsx` text 块；按钮点击占位选型 = sonner `toast.info`「即将支持」（用户可感知功能在途，优于 disabled 无反馈）
- [x] 流式容错：完整块正则截获 + 未闭合块剥除（半截 JSON 不渲染也不闪代码块），11 个边界 case 脚本验证全过
- [x] `bun run lint`（0 errors，新增代码 0 warnings）+ `bun run build:electron` 通过 + `bun test` 327 pass 0 fail

## 验收

- [ ] 会话中问「另外我想到以后能不能支持 RSS」类岔题 → agent 回复末尾出现建议卡（摘要 + 三按钮）
- [ ] 正常工作消息不触发建议卡（提示词克制）
- [ ] 流式过程中卡片不闪烁/不出半截
- [ ] 历史加载后建议卡正常渲染（transcript 回放）

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - 渲染接入点是两处而非一处：contentBlocks 模式下 assistant 正文走 `ContentBlockItem` 的 text 块，无块兑底才走 `MessageItem` 的 content 分支——两处均替换为 `ShuntAwareMarkdown`
  - 协议比本文件草案多一个约束：`options` 是按岔题性质选的非空子集（1~3 个）而非固定三按钮，白名单过滤 + 去重 + 空 summary/options 不渲染
  - 注入条件选定 `notes` 包：分流三动作之一的 CreateNote 依赖 notes 工具，且该包解析已含「主会话 + 有工作区」前置；子会话 / 任务执行会话（无人值守）无分流场景，不注入
  - `electron/main/agents/pi-session/pi-session.ts` 有他人未提交改动（updateModelSelection，:360 附近），本 step 仅追加 import + 一行 personaParts.push（:590 附近，与该改动无交集），未 revert 未 commit
- 改动文件清单：
  - `components/agent-chat/shunt-suggestions.tsx`（新）：parseShuntSuggestions / ShuntSuggestionCard / ShuntAwareMarkdown
  - `components/agent-chat/ContentBlockItem.tsx`：text 块 MarkdownRenderer → ShuntAwareMarkdown
  - `components/agent-chat/MessageItem.tsx`：content 分支 MarkdownRenderer → ShuntAwareMarkdown
  - `electron/main/agents/session-append-templates.ts`：SystemPromptSegmentKey 加 'shunt-guidance'、SHUNT_GUIDANCE_APPEND 常量、getSystemPromptSegments 注册（category 'notes'）
  - `electron/main/agents/pi-session/pi-session.ts`：import + 主会话分支一行条件注入
  - `docs/plans/.../quick-chat/plan.md`：全局决策 6 回填定稿协议

### 给下一步的接力棒

- 关键签名 / 数据结构：
  - `parseShuntSuggestions(content: string): { body: string; suggestions: ShuntSuggestions | null }`（shunt-suggestions.tsx）
  - `ShuntSuggestions = { summary: string; options: ShuntAction[] }`，`ShuntAction = 'new-session' | 'new-topic' | 'note'`
  - `SHUNT_ACTION_META`（同文件）：action → { label, icon }，Step 6 气泡可直接复用作展示文案
- 下个 step 该从哪里继续：Step 6 把 ShuntSuggestionCard 的 onClick 从 toast 占位换成「向 ChatInputArea 插入操作气泡」——建议通过现有输入状态 store 或新增回调 prop（onShuntSelect(action, summary)）从 AgentChat 层传入；气泡发出时 useSendMessage 注入 `<shunt>` 标签（格式见 plan.md 决策 6 ②，Step 6 定稿回填）
- 待办或已知限制：
  - 搜索高亮以原始 message.content 计命中（SearchBar），命中建议块 JSON 内文字时高亮不落到渲染正文（块已剥除）——影响极小，暂不处理
  - personal 临时会话 notes 包默认开 → 临时会话也会注入分流引导（其组为隐式单会话组，「另起会话/话题」语义待定）——Step 6 ForkSession 接线时决定是否对 personal 禁用该段或过滤按钮
  - 验收第 1、2 条（agent 实际行为克制度）需起 Electron 真会话验证：问「另外我想到以后能不能支持 RSS」看建议卡、发正常工作消息确认不出卡；本会话无 GUI 环境，未执行
