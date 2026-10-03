---
step: 3
title: 笔记生命周期纪律
status: done
---

## 目标
提示词模板把「未定型先占位任务」动线改为「未定型进笔记状态标签，完全体才挂任务」；笔记明确定位为生命周期池（未定型方案/待办/待议/调研底稿）。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-no-placeholder.md] CreateTask 已完全体化（planPath 必传、占位拒绝）——本步提示词与之对齐
- 当前关键文件状态：
  - `electron/main/agents/session-append-templates.ts:32-33` 笔记存卡纪律段：
    - :32「笔记是用户的工作台：脑暴思路、用户明确要求记录的内容、琐事备忘（正文用 - [ ] 勾选项）进这里；可实施工作一律走任务（dogear__CreateTask），不要为任务存笔记卡」
    - :33「与用户聊完方案后的动线：落盘设计文档（docs/plans/...）→ 过「是否分步骤」判断 → dogear__CreateTask 挂到计划栏 → 在回复中告知用户；方案未定型、想先记一笔时 CreateTask 可省略 planPath 占位，文档落盘后同标题再调一次自动补路径」
  - `session-append-templates.ts:173` triggerDescription：「……CreateTask 挂计划栏（可省略 planPath 占位）……」
- 关键决策回顾：任务=完全体，笔记承载生命周期；状态标签示例集（待办/待议/已转入计划）不穷举，agent 可语义扩展（现状已自发出现：待议/需求意向/已转入计划）；多待办可合一张卡片正文 `- [ ]` 勾选项

## 计划改动
- [ ] `session-append-templates.ts:32` 笔记段补生命周期定位：笔记承载未定型方案、待办、未决讨论、调研报告、底稿；状态流转用标签标记（如 待办 / 待议 / 已转入计划），多条待办可合一张卡（正文 `- [ ]` 勾选项）
- [ ] `session-append-templates.ts:33` 动线改写：「落盘设计文档 → 过「是否分步骤」判断 → CreateTask（planPath 必传，任务是完全体）→ 告知用户；方案未定型、待讨论的内容记笔记卡片（打状态标签），拍板落盘 plan 后才挂任务」
- [ ] `session-append-templates.ts:173` triggerDescription 同步（删「可省略 planPath 占位」）
- [ ] 核对 `session-append-templates.ts` 全文件与 `electron/main/agents/tools/task-tools.ts` 是否残留占位表述（Step 2 应已清，本步兜底 grep）
- [ ] 验证：`build:electron`；目验——新会话系统提示中动线段无占位表述
- [ ] 交付提醒（写进交付文档）：存量占位任务 2 个待用户处置——`mfdelhd2`《提交确认 UI 改造》（按 P0 拍板实现会话内 inline 确认卡）、`hvszlply`《核查同页导航 click 误报》——补 plan 文档或转笔记卡片，不代做决定

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无；主会话按微改动例外直接实施（单文件 3 处文案，<20 行）
- 改动文件清单：
  - `electron/main/agents/session-append-templates.ts`：① NOTES_DISCIPLINE_APPEND 首条改写——笔记定位为「工作台与生命周期池」（脑暴/未定型方案/待办/未决讨论/调研报告/琐事备忘），状态流转用标签标记（待办 / 待议 / 已转入计划，示例不穷举），多条待办可合一张卡（`- [ ]` 勾选项）；② 动线条改写——CreateTask 标注 planPath 必传任务是完全体，未定型/待讨论内容记笔记卡片打状态标签，拍板落盘 plan 后才挂任务（删「可省略 planPath 占位、同标题自动补路径」）；③ notes-discipline triggerDescription 同步新语义
- 兑底 grep：electron 源码「占位/可省略/同标题再调/自动补路径」仅剩 outputPath 省略语义（delegation-tools / 协作规范段），与任务占位机制无关；build:electron 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：无代码签名变化，纯提示词文案
- 下个 step 该从哪里继续：step4 手动改口 + 笔记折叠展开（task-store / tipc tasks / 前端面板 / NotesTimelinePane）
- 待办或已知限制：存量占位任务 2 个待用户处置——`mfdelhd2`《提交确认 UI 改造》（按 P0 拍板实现会话内 inline 确认卡）、`hvszlply`《核查同页导航 click 误报》——补 plan 文档或转笔记卡片，不代做决定
