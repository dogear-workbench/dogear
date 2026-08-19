---
step: 3
title: 子会话统一走全局链 + 回归
status: done
---

## 目标

子会话 quota 降级改走全局 failover 链（废弃 subAgent.profiles 降级语义），开关/耗尽语义与主会话一致；测试回归 + 文档同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-main-failover.md] `model-failover.ts` 提供 `findNextFailover(chain, currentProfileId, tried)`；failover 配置经 normalize 保证结构合法
- 当前关键文件状态：
  - `electron/main/agents/delegation-resume.ts:17` `findFallbackModel(profiles: SubAgentProfile[], currentProfileId: string): ModelSelection | null`——本步废弃，调用方改用 findNextFailover
  - `electron/main/agents/delegation-bridge.ts:234` `decideResume(c)`：quota 分支 `getById` 拿 profileId → `findFallbackModel(settings.subAgent?.profiles ?? [], currentProfileId)`（L285）；`resumeChild(childId, { reason, modelOverride? })` 已 export（L325），modelOverride 为 ModelSelection，FailoverEntry 同 shape 直接兼容
  - `delegation-bridge.ts` settleTerminal（L250）统一结算、modelTried 落盘机制均不变
  - `electron/main/agents/delegation-resume.test.ts`：现有 quota 用例基于 `subAgent.profiles` 拓扑（setMockSettings 注入），需改为 failover.chain 拓扑
- 关键决策回顾：「profile 列表顺序即降级链」语义废弃，subAgent profile 回归纯功能配置（工具/超时/能力）；quota 只走链、tried 不回头；`failover.enabled === false` 时子会话 quota 直接终态通知（回到调度站现状行为）；transient 自动复活不动；通知文案「已降级尝试 A → B」数据源仍是 modelTried

## 计划改动

- [x] `electron/main/agents/delegation-resume.ts`：删 `findFallbackModel`；`decideResumeOnError` 签名中 fallback 来源参数语义调整为 FailoverEntry（调用方传 findNextFailover 结果），quota 耗尽判定不变
- [x] `electron/main/agents/delegation-bridge.ts` `decideResume`：quota 分支改为 `loadSettings()` → `failover.enabled` 且 `findNextFailover(failover.chain, currentProfileId, modelTried 提取的 profileId 集合)` → 有结果传 `resumeChild(childId, { reason, modelOverride: entry })`；开关关闭或链耗尽 → 落到通知（文案沿用 buildTerminalNotice quota 分支，「无可降级」措辞可顺带改为「降级链无可用供应商」）
- [x] `electron/main/agents/delegation-terminal.ts`：quota 通知文案核对（含链耗尽语义），关键词表不动
- [x] 测试 `delegation-resume.test.ts` 改造：setMockSettings 注入 `failover: { enabled: true, chain: [...] }` 拓扑——保留语义场景：quota 降级收异供应商（updateModelSelection）、链上全为已试供应商立即通知、降级后仍 quota 即耗尽（文案含「已降级尝试」）、开关关闭 → quota 直接通知不降级、transient 复活不受影响（回归）、stopChild(cancelled) 无 resume（回归）
- [x] `delegation-regression.test.ts` / `delegation-persist.test.ts` 跑通（mock settings 默认值需补 failover 字段，默认 enabled: false 保持既有用例行为）
- [x] `electron/main/agents/delegation-test-mocks.ts`：mockSettings 默认加 `failover: { enabled: false, chain: [] }`；可加 setMockFailover 辅助
- [x] 文档同步：`docs/codebase-map.md`——delegation-resume 条目改述（findFallbackModel → findNextFailover 走全局 failover 链）、settings-types/settings-service 条目补 failover、新增 model-failover.ts 条目、tipc/agent.ts broadcaster 补 failover 钩子
- [ ] 记忆更新（主会话回填时做）：`delegation-dispatcher-design` 记忆中「profile 列表顺序即降级链」标注已被本设计取代；新增/更新 model-failover 主题记忆
- [x] 验证：`bun test electron/main/agents/` 全 pass；lint / build:electron / 前端 tsc 零新增；dev 手动——子会话用主供应商（假 key 触发 quota），观察自动降级到链下一家续跑、modelTried 含两家、再 quota 耗尽收终态通知

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「链上全为已试供应商立即通知」场景在集成层用「链只剩当前一家供应商」拓扑实现（等价耗尽，设计文档同语义）；「已试供应商」路径由「降级后仍 quota 即链耗尽」用例覆盖（tried 含两家后 findNextFailover 返 null）
  - 未新增 setMockFailover 辅助——quota 用例直接在 setMockSettings 内联 failover 拓扑更直读，避免无人使用的导出
  - delegation-terminal 无可降级措辞改为「降级链无可用供应商」，开关关闭与链耗尽共用同一文案（buildTerminalNotice 不区分关闭态，通知文案不额外分支）
  - 顺带更新 model-failover.ts 头注释（「子会话不经过本模块」改为「子会话只复用 findNextFailover」）
- 改动文件清单：delegation-resume.ts（删 findFallbackModel + 签名改 FailoverEntry）、delegation-bridge.ts（decideResume 走全局链 + import 换 findNextFailover + 头注释）、delegation-terminal.ts（耗尽文案）、model-failover.ts（头注释）、delegation-test-mocks.ts（默认 failover 字段）、delegation-resume.test.ts（failover.chain 拓扑 + 新增开关关闭用例、删 findFallbackModel 纯函数用例）、docs/codebase-map.md（6 处）、本计划文件回填
- 验证：`bun test electron/main/agents/` 48 pass 0 fail；`bun run lint` 0 errors（74 warnings 存量）；`bun run build:electron` 通过；`bunx tsc --noEmit` 12 errors 全存量（8 文件）；dev 手动项待主会话/用户验证

### 给下一步的接力棒
- 关键签名 / 数据结构：`decideResumeOnError(errorClass, retryCount, modelTried, fallback: FailoverEntry | null)`；bridge `decideResume` 内 `tried = modelTried.map(key => key.slice(0, key.indexOf(':')))` 解析 profileId 集合；`findFallbackModel` 已删除，全仓无引用
- 下个 step 该从哪里继续：主/子会话 failover 已全部接线（step1 设置层、step2 主会话、step3 子会话统一），剩余是记忆更新（主会话）与 dev 手动走查
- 待办或已知限制：见共享区 failover-step3-delivery.md
