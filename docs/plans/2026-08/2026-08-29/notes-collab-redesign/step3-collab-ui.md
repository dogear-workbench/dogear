---
step: 3
title: 协作闭环 UI
status: pending
---

## 目标
打通人机协作闭环的 UI 两端：笔记卡一键引用进会话（锚定最近活跃会话+跳转确认）；Agent 存卡带来源身份证 + 详情来源行跳回讨论。

## 依赖上下文（接力棒输入）
- 设计依据：`../note-agent-collaboration-design.md` 架构第 3、4 节
- 前置 step 产出：[step1] `NoteReference` 类型与 store API 已就绪（签名见回填）；[step2] meta 行与卡片 hover 区已预留引用按钮位
- 现状事实：`useSendMessage.ts:216-314` XML 拼接模式；`utils.ts:22-139` `parseUserMessageReferences`；`lib/reference-guard.ts` 守卫模式；`notes-tools.ts:61` CreateNote、`:103` GetNote；`types/note.ts:21-36` NoteMeta

## 计划改动
- [ ] 「最近活跃会话」判定：查 tab/会话 store 是否已有「上一个活跃会话 tab」概念，没有则补（记录最近激活的会话 tab id，笔记 Tab 激活不清除它）
- [ ] 引用按钮实装：`NoteCardItem` hover 区 + `NoteEditor` meta 行；onClick 流程——工作区守卫（笔记 workspacePath ≠ 焦点会话工作区 → toast 拒绝，照抄 `guardReferenceIntoFocus` 模式）→ `addReferencedNote`（锚定最近活跃会话）→ 激活该会话 tab + 聚焦输入框
- [ ] 无最近活跃会话时：toast 提示先打开会话（按钮不禁用，点击给指引）
- [ ] `ChatInputArea.tsx`：笔记芯片（新配色，现有 5 色已占：淡蓝/灰紫/青绿/淡紫/青柠），X 可删，无标题卡显示截断正文
- [ ] `useSendMessage.ts`：拼 `<referenced_notes><note noteId title workspacePath /></referenced_notes>`；按 noteId 去重已由 store 保证
- [ ] `utils.ts`：`parseUserMessageReferences` 加笔记正则，剥离后气泡不显示原文 XML
- [ ] `electron/main/agents/tools/notes-tools.ts`：`dogear__CreateNote` 加可选 `sourceSessionId`（+ 会话标题）参数写入 frontmatter `source`；工具描述尾部加「存卡后在回复中告知用户存了什么」（规范落点：工具描述，非系统提示词）
- [ ] `types/note.ts`：`NoteMeta` 加 `source?: { sessionId, title, date }`
- [ ] `NoteEditor.tsx` meta 行：有 source 时渲染 `🔗` 图标（tooltip 会话标题+日期），点击跳回该会话 tab

## 验收
- 从笔记 Tab 点引用 → 自动落到最近活跃会话、输入框聚焦、芯片可见、消息发出后我方 `GetNote` 能读全文
- 冷启动无会话时点引用得到 toast 指引
- 我 CreateNote 带 source 后，卡片 meta 行出现 🔗，点击跳回本会话
- 跨工作区引用被 toast 拦截
- 存量无 source 卡片 meta 行不渲染 🔗

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
