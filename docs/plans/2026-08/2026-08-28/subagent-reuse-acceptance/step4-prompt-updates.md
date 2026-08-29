---
step: 4
title: 提示词层全套
status: pending
---

## 目标

机制开路完成后，把判断依据写进提示词：复用判断框架、验收闭环、契约弹性化与交付自述义务、工具描述改中性。

## 依赖上下文（接力棒输入）

- 设计文档：§架构 B 全部。
- 关键现状：
  - `session-append-templates.ts:26-32` MAIN_AGENT_DELEGATION_APPEND：含「必须 WaitForMessage」「交付以收到 delivery 消息为准」「stopped 未交付用 ResumeSession 续」。
  - `session-append-templates.ts:56-66` subAgentContractFor：契约写死「完整交付内容写到共享区 outputPath，SendMessage 只放摘要」「产出的新文件一律写到共享区」。
  - `delegation-tools.ts:28` ListLinkedSessions 描述：「已交付 → 已完成，不要重派或调起」；`:90` 「已交付的不用等」。
- Step 1-3 产出：outputPath 可选、SendMessage 自动调起、重启降级恢复均可用——提示词可以放心引用这些能力。

## 计划改动

- [ ] `session-append-templates.ts` MAIN_AGENT_DELEGATION_APPEND 新增「子会话复用判断」段（四条判断线原文见设计文档 §架构 B.2，保留原措辞）
- [ ] 同段新增「验收闭环」：收到交付 ≠ 接受交付；读交付物（共享区文件或消息正文）对照任务目标 → 接受 / SendMessage 追问返工（停机会话会自动调起）/ 重派
- [ ] 同段修改「交付以收到 delivery 消息为准」类措辞 → 「交付以收到 delivery 消息为准（送达事实）；是否合格由你验收判断」
- [ ] `session-append-templates.ts` subAgentContractFor 改造：
  - 交付形态二选一：「复杂产出（报告/代码改动说明）写共享区 outputPath；简单问答/验证类直接在交付消息正文交付」
  - 交付自述义务：「交付消息须结构化自述——目标达成情况 / 未完成或跳过部分 / caveats / 交付物形态与位置（共享区 xxx.md 或本消息正文）」
  - outputPath 为空时契约不出现「交付路径」行（结合 Step 1 的空值传递）
- [ ] `delegation-tools.ts:28` ListLinkedSessions 描述：删「不要重派或调起」，改「已交付；如需深挖可直接向它发消息（系统会自动调起）」；`:90` 同步「已交付的仍可追问」
- [ ] `delegation-tools.ts` SendMessage 描述补一句：「目标已停机时系统会自动调起它，消息不会丢失」
- [ ] 检查 `delegation-tools.ts:410-455` ResumeSession 描述中「已停止且未交付」的限定改为「已停止」（机制已支持任意停止态）
- [ ] 渲染目检：写个临时脚本或在测试里打印 `buildSubAgentProfileIndex` + `subAgentContractFor('示例任务', undefined)` 的渲染结果，确认文案无矛盾
- [ ] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
