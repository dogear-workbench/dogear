# 模型故障转移（Failover）实施计划

**目标**：任何会话（主/子）quota 类错误时，沿设置页配置的全局降级链自动顺位切换供应商续跑，全程无人值守，链耗尽才停。

**架构思路**：设置页显式配置 failover 链（每家供应商一条 + 一个模型），主/子会话共用；quota 判定复用 `isQuotaErrorMessage`；切换原子动作复用 resumeChild 已验证模式（updateModelSelection → detach 销毁旧 session → attach 以新模型重建 → 发续跑提示断点续跑）。排除：主会话 transient 自动重试（重复副作用风险）、自动切回（YAGNI）、主子两套链（割裂）。

**设计文档**：`../model-failover-design.md`（拍板决策与边界已定，实施时不再重新讨论）

**涉及模块**：
- 设置：`electron/main/services/settings-types.ts`、`settings-service.ts`（normalize）、`types/settings.ts`（前端镜像）、`app/settings/page.tsx`、`stores/settings-store.ts`
- 核心逻辑（新）：`electron/main/agents/model-failover.ts`
- 主会话路径：`electron/main/tipc/agent.ts`（broadcaster complete 分支）、`electron/main/services/conversation-runtime-service.ts`（attach/detach 复用）、`electron/main/services/conversation-service.ts`（updateModelSelection L475）
- 子会话路径：`electron/main/agents/delegation-bridge.ts`（decideResume）、`delegation-resume.ts`（findFallbackModel 废弃）、`delegation-terminal.ts`（isQuotaErrorMessage L32 复用）
- 前端提示：`electron/main/tipc/renderer-handlers.ts`（新事件）、`stores/conversation-store.ts` 或轻量 store、`components/AgentChat.tsx`

## 步骤索引

- [x] [Step 1: 设置层 + 设置页 failover 配置](./step1-settings.md) — 类型/normalize/设置页 UI（开关 + 供应商链列表 + 模型下拉 + 排序）
- [x] [Step 2: failover 核心 + 主会话自动切换](./step2-main-failover.md) — 纯逻辑链查找 + 主会话 quota 编排（切换/重建/续跑）+ 前端切换提示条
- [ ] [Step 3: 子会话统一走全局链 + 回归](./step3-sub-unify.md) — decideResume 改走 failover 链、废弃 findFallbackModel、测试回归、文档同步

## 全局决策

- **数据结构**：`failover: { enabled: boolean; chain: Array<{ profileId: string; tier: string }> }`，profileId = ModelProfile.id（供应商身份），tier = piModels 内模型 id。缺省 `{ enabled: false, chain: [] }`
- **normalize 行为**（settings-service.ts，每次读设置时跑）：failover 缺失 → 按现有 profiles 顺序自动生成链（enabled: false，tier 取该家 piModels 首个）；新增供应商追加链尾；删除供应商移出链；tier 失效（不在该家 piModels）→ 回退 piModels 首个；chain 内 profileId 去重
- **quota 判定**：统一复用 `isQuotaErrorMessage`（delegation-terminal.ts:32），关键词表不另建
- **切换语义**：`findNextFailover(chain, currentProfileId, tried)`——顺位下一个未 tried 且 ≠ 当前的；当前不在链 → 链头第一个未 tried；全 tried → null（耗尽）。tried 集合含已试供应商，不回头
- **切换原子动作**：updateModelSelection → detach 旧 attachment（refCount 归零销毁，**必须**，attach 复用存活 session 不重读 modelSelection——step2 调度站已踩过）→ attachConversation 重建 → fire-and-forget 续跑提示（catch 走 complete(failed) 链路再触发下一步 failover）
- **tried 生命周期**：主会话内存级 Map<conversationId, Set<profileId>>，turn 成功完成后清空（恢复正常）；子会话沿用 modelTried 落盘（delegation-state.json）
- **不触发**：cancelled（用户手动停止）、`failover.enabled === false`（回到现状：主会话报错停、子会话直接终态通知）、transient（子会话保留现有自动复活，主会话维持现状）
- **不自动切回**：切换是会话级 modelSelection 变更，用户可在模型选择器手动改回
- **测试**：沿用 `delegation-test-mocks.ts` 的 `installDelegationMocks()` 基建；主会话编排函数独立 export 可测，broadcaster 只留一行调用
- **代码纪律**：不写注释；>300 行拆模块；错误返回不抛异常（编排层 catch + warn log）

## 完成总结

（全部完成后回填）
