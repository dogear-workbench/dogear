---
step: 2
title: SendMessage 自动调起停机子会话
status: done
---

## 目标

SendMessage 遇到停机的直派子会话（stopped，无论是否已交付）时自动调起并投递消息，不再返回 `target_inactive` 丢消息。

## 依赖上下文（接力棒输入）

- 设计文档：§架构 A.1；排除「中断续跑」提示词复用的原因：追问语境下「你因中断停止，请从中断处继续」是错误提示。
- 关键现状：
  - `delegation-bridge.ts:799-824`（deliverMessage）是**同步函数**：waiter 命中 → 直送；session 存活 → queued；否则返回 `'target_inactive'`。
  - `delegation-tools.ts:126-141`（SendMessage handler）是 async，`target_inactive` 时返回「对方暂时收不到，请稍后重试」文案——此处是自动调起的最佳挂点。
  - `delegation-bridge.ts:307-375`（resumeChild）：末尾 fire-and-forget 发 `buildResumePrompt`（delegation-resume.ts:50）。
  - 直派关系判断：工具层有 `opts.conversationId`（父会话），`bridge.getChildIdBySessionId(parentConvId, targetSessionId)` 可反查 childId。
- Step 1 产出：outputPath 空值兼容已完成，resumeChild 跳过空路径的 release/claim。

## 计划改动

- [x] `electron/main/agents/delegation-bridge.ts` resumeChild 加可选参数 `wakeupMessage?: string`：提供时用它替代 `buildResumePrompt` 作为唤醒输入（消息体包 sender 标签的逻辑与 deliverMessage 的 queued 分支对齐，建议把 senderTag 拼装提为小函数复用）
- [x] `delegation-bridge.ts` 新增 async 包装 `resumeChildAndDeliver(childId, deliverOpts)`（或直接在 deliverMessage 调用链上做，见下）：调起成功后投递消息，返回 queued 语义
- [x] `electron/main/agents/tools/delegation-tools.ts` SendMessage handler：`target_inactive` 时先判断 `target.conv.contractMetadata?.parentSessionId === ownSessionId` 且子会话非 running → 调 bridge 自动调起 + 投递；成功返回「✅ 目标会话已停机，已自动调起并送达」类文案；失败（如 JSONL 丢失）走现有 errorResult
- [x] 实现位置二选一（实施时定）：a) 工具层判断（推荐——deliverMessage 保持同步纯投递，调起是编排逻辑）；b) bridge 层做。若选 a，`deliverMessage` 不动，handler 里先 resumeChild 再 sendMessage
- [x] 并发防护：两次快速 SendMessage 打同一停机会话，第一次触发调起后 session 已 attach，第二次走 queued 排队，无需额外锁（确认 resumeChild 的状态提交顺序无中间态可见窗口）
- [x] 测试：delegation-resume.test.ts 加用例——stopped 已交付子会话收到 SendMessage 自动复活、唤醒消息为追问原文而非中断模板
- [x] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 实现位置选 a 方案（工具层判断 + bridge 提供编排封装）：deliverMessage 未动，SendMessage handler 里判断「我派出的停机子会话」后调新增的 `bridge.resumeChildAndDeliver`（内部 = resumeChild(wakeupMessage) ，即计划中的「先 resumeChild 再 sendMessage」）。
  - 计划改动第 2 条的「返回 queued 语义」简化为 void + 成功文案：resumeChild 成功即等价于消息已作为唤醒输入发出，handler 拿到 resolve 后返回成功文案；失败（不在运行时跟踪 / JSONL 丢失）抛错走 errorResult。
  - 并发防护确认：两次快速 SendMessage 的常态窗口（第一次 attach 完成后）第二次走 deliverMessage 的 queued 分支，无需锁；极端窗口（两路都进 resumeChild）消息不丢、状态收敛 running，仅监听叠加/timer 双挂，行为收敛等价（onSessionComplete 幂等、stopChild 幂等），遵循计划不加锁。
  - 测试基建：mock 的 attachConversation 补了 sessionId 回写 convStore（对齐真实 attach 行为），否则 getBySessionId 找不到子会话，handler 端到端测不了。
- 改动文件清单：
  - electron/main/agents/delegation-bridge.ts：resumeChild 加 `wakeupMessage?: string` 可选参数（缺省仍用 buildResumePrompt）；senderTag 拼装提为 buildSenderTag 小函数（deliverMessage 复用）；新增 `resumeChildAndDeliver(childId, deliverOpts)`（不在跟踪则抛错）。
  - electron/main/agents/tools/delegation-tools.ts：SendMessage handler 的 target_inactive 分支加自动调起（contractMetadata.parentSessionId === ownSessionId 且 snapshot 非 running），成功返回「✅ 目标会话已停机，已自动调起并送达…」；失败走 errorResult；非直派对象保留原文案。
  - electron/main/agents/delegation-test-mocks.ts：attachConversation 回写 conv.sessionId。
  - electron/main/agents/delegation-resume.test.ts：+2 用例（自动调起复活且唤醒为追问原文 + sender 标签、非我派出的停机会话不触发）。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `resumeChild(childId, { reason, modelOverride?, wakeupMessage? })`：wakeupMessage 提供时替代 buildResumePrompt 成品发送（含 sender 标签的最终文本）。
  - `resumeChildAndDeliver(childId, Omit<DeliverMessageOptions, 'toConversationId'>)`：bridge 层编排，唤醒输入 = buildSenderTag(...) + '\n' + message。
  - handler 判断链：hasDirectContractChannel（既有）→ deliverMessage 返回 target_inactive → contractMetadata.parentSessionId === ownSessionId → getChildIdBySessionId ?? conv.id → getChildSnapshot 非 running → resumeChildAndDeliver。
- 下个 step 该从哪里继续：按 plan.md 顺序取下一 step 的计划文件；本 step 无未完成项。
- 待办或已知限制：
  - 应用重启后 childStates 丢失，停机子会话不在运行时跟踪 → SendMessage 自动调起不可用（走「暂收不到」文案），与 dogear__ResumeSession 的「不在跟踪中」限制一致；若要覆盖需先做 childState 降级重建，属另一 step 体量。
  - resumeChild 的 `consecutiveFails += 1` 对 SendMessage 自动调起也会 +1（非失败重试场景），系既有字段语义（手动 ResumeSession 同样如此），本 step 未动。
  - 提示词零改动（约束遵守）：自动调起复用的判断线只在工具文案与 ListLinkedSessions 既有描述里，未新增「总是复用」类倾向性硬编码。
