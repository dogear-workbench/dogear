---
step: 4
title: 提示词层全套
status: done
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

- [x] `session-append-templates.ts` MAIN_AGENT_DELEGATION_APPEND 新增「子会话复用判断」段（四条判断线原文见设计文档 §架构 B.2，保留原措辞）
- [x] 同段新增「验收闭环」：收到交付 ≠ 接受交付；读交付物（共享区文件或消息正文）对照任务目标 → 接受 / SendMessage 追问返工（停机会话会自动调起）/ 重派
- [x] 同段修改「交付以收到 delivery 消息为准」类措辞 → 「交付以收到 delivery 消息为准（送达事实）；是否合格由你验收判断」
- [x] `session-append-templates.ts` subAgentContractFor 改造：
  - 交付形态二选一：「复杂产出（报告/代码改动说明）写共享区 outputPath；简单问答/验证类直接在交付消息正文交付」
  - 交付自述义务：「交付消息须结构化自述——目标达成情况 / 未完成或跳过部分 / caveats / 交付物形态与位置（共享区 xxx.md 或本消息正文）」
  - outputPath 为空时契约不出现「交付路径」行（结合 Step 1 的空值传递）
- [x] `delegation-tools.ts:28` ListLinkedSessions 描述：删「不要重派或调起」，改「已交付；如需深挖可直接向它发消息（系统会自动调起）」；`:90` 同步「已交付的仍可追问」
- [x] `delegation-tools.ts` SendMessage 描述补一句：「目标已停机时系统会自动调起它，消息不会丢失」
- [x] 检查 `delegation-tools.ts:410-455` ResumeSession 描述中「已停止且未交付」的限定改为「已停止」（机制已支持任意停止态）
- [x] 渲染目检：写个临时脚本或在测试里打印 `buildSubAgentProfileIndex` + `subAgentContractFor('示例任务', undefined)` 的渲染结果，确认文案无矛盾
- [x] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 多改了 `conversation-runtime-service.ts:104`：把 `?? '（未指定；直接通过 dogear__SendMessage 交付）'` 改为 `?? ''`。这是遗留矛盾修复的必要部分——该兑底文本会把空 outputPath 替换成非空字符串，`subAgentContractFor` 无法感知「通讯型交付」，空值根本传不到契约模板；兑底文案职责整体移入契约模板的通讯型分支。
  2. MAIN_AGENT_DELEGATION_APPEND 的 outputPath 行同步微调：补「可省略（省略 = 通讯型交付）」，「交付物一律经共享区传递」改为「指定了 outputPath 时……文件类交付物一律经共享区传递」，避免与通讯型交付自相矛盾。
  3. 渲染目检落成正式测试 `session-append-templates.test.ts`（断言 + console.log 打印完整渲染），非临时脚本。
  4. SendMessage 描述补句按机制实际语义精确化：「目标是你直接派出且已停机的子会话时，系统会自动调起它，消息不会丢失」（自动调起仅对直派子会话生效）。
- 改动文件清单：
  - `electron/main/agents/session-append-templates.ts`（MAIN_AGENT_DELEGATION_APPEND 复用判断段 + 验收闭环段 + 送达/合格措辞；subAgentContractFor 弹性化 + 自述义务 + 空 outputPath 分支）
  - `electron/main/agents/tools/delegation-tools.ts`（SEND_MESSAGE_DESC / LIST_LINKED_DESC / expandWaitTargets 提示行 / RESUME_SESSION_DESC 四处文案）
  - `electron/main/agents/delegation-resume.ts`（buildResumePrompt 空路径不渲染共享区文件提示）
  - `electron/main/services/conversation-runtime-service.ts`（空 outputPath 兑底文本移除，直传空串）
  - 新增 `electron/main/agents/session-append-templates.test.ts`；`electron/main/agents/delegation-resume.test.ts` 补空路径用例
- 验证结果：`bun run lint` 0 errors（76 warnings 均为既有 any 类，与本次无关）；`bun run build:electron` tsc 编译通过；`bun test electron/main/agents/` 66 pass / 0 fail。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `subAgentContractFor({ task: string; outputPath: string })`：outputPath trim 后为空 = 通讯型契约（无「交付路径」行）；签名未变，调用方 pi-session.ts / conversation-runtime-service.ts 无需适配。
  - `buildResumePrompt(reason: string, outputPath: string)`：空路径不渲染共享区文件提示；delegation-bridge.ts:382 的 `wakeupMessage ?? buildResumePrompt` 链路不变。
  - `PiSessionConfig.subAgent.outputPath` 仍为 `string`（空串 = 通讯型），未改 optional。
- 下个 step 该从哪里继续：提示词层已收尾；按总 plan 看是否有后续 step（如 Profile 配置调整 §架构 C 属用户手动改 settings，不涉代码）。
- 待办或已知限制：
  - 交付自述是提示词约束，模型可能漏写——主会话验收时发现无自述可直接追问，不构成硬故障（设计文档已接受）。
  - CreateSessionBatch 的 outputPath 仍是必填（未在本次计划范围内）；若要批量通讯型派遣需另行放开。
  - MAIN_AGENT_DELEGATION_APPEND 中 ResumeSession 行仍保留「stopped 且未交付」场景定位（已交付会话走 SendMessage 追问自动调起），与工具描述「已停止」并存，不冲突。
