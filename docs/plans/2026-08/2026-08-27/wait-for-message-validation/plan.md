# WaitForMessage 校验与免传 ID 实施计划

**目标**：消灭「sessionId 抄错 → 静默空等超时」的失败模式——传错 ID 秒级报错并给出正确清单（A）；常用路径彻底不用抄 ID（B）。

**架构思路**：校验放工具语义层（`delegation-tools.ts` handler），不动 `delegation-bridge.ts` 的 `waitForMessage` 运行时机制——与现有 `dogear__SendMessage` 的分层惯例一致（工具层调 `hasDirectContractChannel` 校验，bridge 层不校验）。免传 ID 的展开同样在工具层做，来源 `getChildrenByParent`（运行时快照）本身可信，展开结果不再二次校验。排除的选项：bridge 层加校验（分层不对，且 bridge 无契约元数据上下文）、调度器自动挂起（改变协作协议语义，太激进）。

**涉及模块**：
- `electron/main/agents/tools/delegation-tools.ts` — `dogear__WaitForMessage` handler + schema、`dogear__CreateSession` 成功文案
- `electron/main/agents/session-append-templates.ts` — 主会话系统提示模板
- 参照（不改）：`electron/main/services/contract-channel-service.ts`（校验函数）、`electron/main/agents/delegation-bridge.ts:658`（getChildrenByParent）

## 步骤索引

- [x] [Step 1: fromSessionIds 入口校验，非法 ID 秒级报错](./step1-validate-session-ids.md) — 抄错 ID 时立刻返回错误 + 正确的契约通道清单
- [x] [Step 2: fromSessionIds 可选化（免传 = 等所有运行中直属子会话）](./step2-optional-from-ids.md) — schema optional + 展开逻辑 + 提示词模板同步

## 全局决策

1. **校验语义 = 契约通道存在性，不看运行状态**：显式传已 stopped 的合法 ID 允许等（无害，超时兜底）；只挡「与当前会话无直接派出关系」的 ID。
2. **报错必须引导自愈**：错误信息列出全部契约通道（sessionId、title、status、delivered），模型下一轮直接改对。格式参照 `ListLinkedSessions` 的行格式（`delegation-tools.ts:158-173`）。
3. **免传展开语义**：主会话不传 = 所有 `status === 'running'` 且 sessionId 就绪的直属子会话；为空立即报错（附全部子会话状态 + ResumeSession 建议），绝不傻等超时。子会话不传 = 等派出它的会话。
4. **展开结果不做二次契约校验**：来源 `getChildrenByParent` 是 bridge 自己的快照，sessionId 已处理复活变更（`delegation-bridge.ts:209-211`）。
5. **超时缺省逻辑不动**：`timeoutMs` 缺省仍走 defaultProfile.timeoutMinutes ?? 30 分钟（`delegation-tools.ts:131-133`）。
6. **验证方式**：改完跑既有回归 `bun test electron/main/agents/delegation-*.test.ts`（不新增单测，项目偏好）；主进程改动需 `bun run build:electron` 后在应用内实测。

## 背景（为什么做）

2026-08-27 实际事故：主会话 CreateSession 返回 `...67f235`，WaitForMessage 手抄成 `...67f35e`——`waitForMessage`（`delegation-bridge.ts:767-785`）对 fromSdkSessionIds 零校验，静默挂满 600s 超时，子会话早已交付却无人接收。用户拍板 A+B 方案。

## 完成总结

两步全部完成（2026-08-27，commit 11e3cd9 + 后续）：

1. **Step 1**：`dogear__WaitForMessage` handler 入口新增契约通道校验——`resolveOwnConversation()` 后逐 ID 调 `hasDirectContractChannel`，非法 ID 立即 isError 并附全部契约通道四字段清单（主/子会话文案分支），不再静默空等。校验语义只看契约存在性不看运行状态，stopped 合法 ID 照常可等。
2. **Step 2**：`fromSessionIds` 改 `.optional()`（保留 min(1)，空数组被 zod 拒）。免传时闭包 helper `expandWaitTargets()` 展开：主会话 = 所有 running 且 sessionId 就绪的直属子会话（为空立即报错附全量状态 + ResumeSession 建议）；子会话 = 派出方单元素。展开路径跳过契约校验（bridge 自家快照可信），显式传入才走校验。`WAIT_FOR_MESSAGE_DESC`、CreateSession 成功文案、`MAIN_AGENT_DELEGATION_APPEND` 三处提示词同步免传用法。

回归 24 pass / lint 0 errors / build:electron 通过。遗留：免传等待只含调用时刻已 running 的子会话，等待期间新建的不在本次范围（超时后再等一次即可）；新代码需重启应用后生效。
