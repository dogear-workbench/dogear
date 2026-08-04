---
step: 4
title: 端到端验收与主计划文档同步
status: pending
---

## 目标

手测确认子会话协作全链路在 Pi 运行时下正常工作；把本次提前完成的范围记录到主计划的 Step5 文档，避免以后做 Step5 时重复劳动或遗漏。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - Step1：`PiSession` 按 `config.role` 正确挂载委派工具包；`getSdkSessionId()` 返回真实 Harness sessionId。
  - Step2：`attachConversation` 透传 role；`conv.sdkSessionId` 与 `conv.sessionId` 同步写入。
  - Step3：`delegation-bridge.ts` 全面切到 `PiSessionManager` 查找会话。
- 验收标准（来自主对话确认的范围）：`CreateSession` 创建子会话不再抛 `session 拉起失败`；子会话创建后能立即通过 `SendMessage`/`WaitForMessage` 正常收发消息；`StopSession` 能正常停止；`ListLinkedSessions` 能列出正确的直接契约通道对方；`contractMetadata` 正确写入真实 sessionId（不再是 undefined 导致 warn 跳过）。

## 计划改动

- [ ] `bun run build:electron` 全量通过（三步累计改动）。
- [ ] 手测：从一个主会话调用 `CreateSession` 派一个子会话，确认子会话创建成功（无 `session 拉起失败` 报错），子会话只挂载 `SendMessage`/`WaitForMessage`/`ListLinkedSessions`（不应该出现 `CreateSession`/`CreateSessionBatch`/`StopSession`——验证 Step1 的 role 修复生效）。
- [ ] 手测：主会话对子会话 `SendMessage`，子会话通过 `WaitForMessage` 能收到；子会话回复后主会话能收到交付（`delivery: true` 路径）。
- [ ] 手测：主会话调用 `StopSession` 能正常中断子会话。
- [ ] 手测：`ListLinkedSessions` 在主会话和子会话两端分别调用，确认列出的是正确的直接契约通道对方（不能看到"孙子会话"）。
- [ ] 检查日志：确认不再出现"发起会话 xxx 尚无 sdkSessionId，新会话将不写入 contractMetadata"的 warn（除非该父会话本身就是旧归档会话，这种情况不算回归）。
- [ ] 更新主计划 `docs/plans/2026-08/2026-08-02/pi-harness-sdk-main-session-removal/step5-transcript-delegation.md` 的"依赖上下文（接力棒输入）"一节，补充一条：delegation 协议路由修复（`sdkSessionId` 取值来源、`PiSession` 角色感知、`delegation-bridge.ts` 查找路由）已在独立的 `docs/plans/2026-08/2026-08-04/delegation-pi-session-routing-fix/` 计划中完成，Step5 剩余范围收窄为 transcript/组摘要/引用工具的 Harness 适配（仍依赖主计划 Step4 的共享 reader）。
- [ ] 在主计划 `plan.md` 的"全局决策"末尾追加一条，指向本次提前完成的独立计划文档，避免后续阅读主计划的人以为 Step5 还没有任何进展。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 手测结果摘要（哪些场景验证通过，哪些发现新问题）：
- 主计划文档同步的具体改动位置：
- 下个 step 入口：主计划 Step4（历史/删除/Fork TIPC 适配），之后回到主计划 Step5 收尾 transcript/组摘要/引用工具部分。
- 待办或已知限制：
