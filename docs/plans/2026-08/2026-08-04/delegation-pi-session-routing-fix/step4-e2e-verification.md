---
step: 4
title: 端到端验收与主计划文档同步
status: done
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

- 与计划差异：无代码改动（本 step 是纯验收 + 文档同步）。手测方式与计划描述略有差异：没有单独测试"CreateSession 报错"分支，而是直接派出真实子会话观察是否报"session 拉起失败"（Step1-3 的三次真实分派 + 本 step 一次专门测试分派，共 4 次均未报错），属于更强的正向验证。日志层面的 "尚无 sdkSessionId" warn 未能直接 grep 到日志文件（项目未把主进程日志落盘到独立文件，走 console），采用间接验证：`ListLinkedSessions` 全程返回真实 sessionId 而非 undefined、`contractMetadata` 关联的 conversationTitle/sessionId 全部正确，可推断该 warn 路径未被触发。
- 改动文件清单：仅文档，无业务代码改动。
  - `docs/plans/2026-08/2026-08-02/pi-harness-sdk-main-session-removal/step5-transcript-delegation.md`：「依赖上下文」补充一条说明本次提前完成的范围。
  - `docs/plans/2026-08/2026-08-02/pi-harness-sdk-main-session-removal/plan.md`：「全局决策」末尾追加一条指向本次独立计划的说明。

### 手测结果（全部通过）

1. `bun run build:electron` 全量通过（累计三步改动），0 类型错误。
2. 派出子会话（`CreateSession`）4 次（Step1/2/3 各一次实施用 + 本 step 一次专门测试），全部创建成功，无一次"session 拉起失败"。
3. 子会话工具集角色限制生效：专门测试会话尝试确认自己的工具列表，确证只有 `SendMessage`/`WaitForMessage`/`ListLinkedSessions`，**没有** `CreateSession`/`CreateSessionBatch`/`StopSession`。
4. `SendMessage`/`WaitForMessage` 双向收发验证：普通消息（非 delivery）双向往返正常；delivery 消息（Step1-3 交付）正常触发。
5. `StopSession` 正常中断子会话，`ListLinkedSessions` 显示其状态从运行中变为 `status=cancelled`。
6. `ListLinkedSessions` 在子会话侧调用，只看到直接派出者（父会话），未出现祖父会话或兄弟会话，符合"仅直接契约通道"约束。
7. `contractMetadata`/`sdkSessionId` 间接验证：全程 `ListLinkedSessions` 返回的都是真实 UUID sessionId，未出现 undefined 或空值，未观察到协作溯源失效的迹象。

### 给下一步的接力棒

- 手测结果摘要：见上「手测结果」，6 项验收标准全部通过，未发现新问题。
- 主计划文档同步的具体改动位置：`step5-transcript-delegation.md` 依赖上下文段追加"补充（2026-08-04 已提前完成）"小节；`plan.md` 全局决策末尾追加一条。
- 下个 step 入口：主计划 Step4（历史/删除/Fork TIPC 适配），之后回到主计划 Step5 收尾 transcript/组摘要/引用工具部分（`sdkSessionId`→`sessionId` 协议改名视情况一并处理）。
- 待办或已知限制：
  1. `onChildSessionInit`/`sdkSessionIdWaiters`/`waitForChildSdkSessionId` 死代码路径未精简（Step3 交付已指出，留给后续按需清理）。
  2. `PiSessionConfig.parentConversationId` 仍是占位空字符串，未接入真实数据源（`contractMetadata.parentSessionId` 反查链路，见 Step2 交付的接力棒说明），子会话拿子会话嵌套场景暂不受影响（子会话本身不能再派子会话，无嵌套需求），但如果未来该字段被消费方读取，需要先接线。
  3. 主进程日志未落盘到独立文件，无法直接 grep 校验 warn 文本是否消失，只能靠功能层面间接验证（已做，见上）。
