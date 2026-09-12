---
step: 1
title: 后端归属重划
status: done
---

## 目标

注册表按功能归属重划（会话组独立成包、系统行为卡瘦身为纯常驻卡），拼装逻辑同步（reference 拆解、tasks 归笔记包、组上下文与协作包解耦、共享区引导文字迁移）。

## 依赖上下文（接力棒输入）

- 设计定版：`docs/plans/2026-09/2026-09-12/ability-ownership-redesign-design.md` §1
- 关键决策回顾：分类维度从「可不可关」改「功能归属」；ReadGroupBackground 跟组上下文段配套（指引第一句就教它）；「协作包关=裁剪纯组头」逻辑随共享区引导迁移而删除；reference 细闸退役不迁移

## 计划改动

- [x] `electron/main/agents/ability-registry.ts`：新增会话组包（key=group-context，segmentKeys=[group-context]，toolGroups=[ReadGroupBackground 所在组]，defaultEnabled=true，首页排 Agent 协作前）；协作包 toolGroups 去 reference、加 ListSiblingSessions 所在组、segmentKeys 加 sub-agent-contract；笔记包 toolGroups 加 dogear-tasks；SYSTEM_BEHAVIORS 退役（组上下文已入包），系统行为卡数据改为纯常驻（基础工具 + 跨会话检索组）
- [x] `electron/main/agents/tools/reference-tools.ts`：dogear-reference 组拆解——ReadGroupBackground 归会话组包组（组名可复用 dogear-reference 或新建，见未决），ListSiblingSessions 归协作包；dogear-history（ListTopics/ReadReferenceSession）保持常驻
- [x] `electron/main/agents/session-append-templates.ts`：GROUP_CONTEXT_EXAMPLE 删共享区引导两段文字；协作规范段/契约段补缺失句（「阶段总结可写共享区」语义）；组上下文 triggerDescription 更新（不含共享区教学）
- [x] `electron/main/agents/pi-session/pi-session.ts`：主/子会话工具构建 gate 调整——ReadGroupBackground 随会话组包（属组即有包内语义）、ListSiblingSessions 随协作包、tasks 随笔记包 + 执行会话派单保底；组上下文注入条件 = 属组 ∧ 会话组包开；删裁剪特殊逻辑；reference 细闸读取点删除
- [x] 相关测试与冒烟（ability-registry.test.ts / tool-registration-smoke.test.ts）同步更新断言
- [x] lint / build / bun test 全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 见未决定夺：ReadGroupBackground 新建组 dogear-group-context（不复用 dogear-reference，该名绑定已退役的 Profile.reference 语义）；ListSiblingSessions 新建独立组 dogear-sibling（不并入 dogear-group，避免跨文件搬工厂）；会话组包关时子会话组头不注入（含子会话，依据全局决策语义基线，唯一强制例外是协作包）
  - group-context-builder.ts 与 tipc/ability.ts 不在计划文件清单但为直接落点：前者物理承载「协作包关 = 裁剪纯组头」逻辑（删除），后者是 SYSTEM_BEHAVIORS 唯一消费方（systemBehaviors 字段恒返回空数组保留形状，前端兼容不破坏；RESIDENT_GROUP_IDS 去掉 dogear-tasks）
  - settings-types.ts 的 SubAgentEnabledAbilities.reference 字段保留（运行时读取点已删，静默忽略旧值；前端 SubAgentTab 仍 import 该类型，删除留给 step2 前端收尾）
- 改动文件清单：electron/main/agents/ability-registry.ts、electron/main/agents/tools/reference-tools.ts、electron/main/agents/session-append-templates.ts、electron/main/agents/group-context-builder.ts、electron/main/agents/pi-session/pi-session.ts、electron/main/tipc/ability.ts、electron/main/agents/ability-registry.test.ts、electron/main/agents/tool-registration-smoke.test.ts

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 新包：group-context（segment-tools，segmentKeys=[group-context]，toolGroups=[dogear-group-context]，触发 = 属组）
  - agent-collab：segmentKeys=[main-agent-delegation, sub-agent-contract]，toolGroups=[dogear-delegation, dogear-group, dogear-sibling]
  - notes：toolGroups=[dogear-notes, dogear-tasks]；executor 保底注册 dogear-tasks 组（pi-session buildMainAgentToolDefs 尾部）
  - getAbilityPacks 返回形状不变（packs/systemBehaviors/residentToolGroups），systemBehaviors 恒 []、residentToolGroups 只剩 dogear-history；前端能力页在本 step 后的现状：系统行为卡只展示常驻区、SubAgentTab「引用回溯」勾选无效，均为 step2/3 前端修正的输入
- 下个 step 该从哪里继续：step2（前端能力页修正）——按矩阵 IPC/包详情改造消化上述后端变化；SubAgentTab 的 reference 勾选项与 AbilitySystemBehaviorView 类型的清理也归前端 step
- 待办或已知限制：运行中会话不热更（重建链路已有 markSnapshotDirty 机制，无需新动作）；docs/codebase-map.md 相关条目未同步（非本 step 范围）
