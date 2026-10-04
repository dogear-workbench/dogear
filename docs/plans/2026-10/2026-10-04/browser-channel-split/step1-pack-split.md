---
step: 1
title: 后端能力包拆分与迁移
status: pending
---

## 目标

ABILITY_PACKS 拆三包（browser 收窄 / browser-extension / browser-methodology），extension 注册闸切换到新包，存量配置迁移三包默认全开，测试断言同步。

## 依赖上下文（接力棒输入）

- 设计定案：[design.md](./design.md)「能力包拆分」节 + plan.md「全局决策」
- 关键现状：
  - `electron/main/agents/ability-registry.ts`：browser 包 `toolGroups: ['browser', 'dogear-extension']`、`skills: ['browser-exploration']`（约 110-120 行）；`TOOL_PACK_TO_ABILITY` 由 ABILITY_PACKS flatMap 生成，拆包后自动跟随
  - `electron/main/agents/pi-session/tool-assembly.ts`：主会话 extension 独立分支 `if (activeAbilities.has('browser'))`（约 160 行后注释「extension 并入 browser 包」处）；子会话双闸 `activeAbilities.has('browser') && ab.extension === true`（约 300 行）
  - `filterSkillsForSubAgent`：`entry.name === 'browser-exploration'` 挂 `ab.browser === true` 判定——方法论包化后该判定要跟新包闸对齐
  - `electron/main/services/tool-packs.ts`：头注释「extension 已并入 browser 能力包」需改写
  - `electron/main/services/settings-service.ts`：normalizeSettings 幂等迁移先例见 browser-parse Profile 缺键补齐（缺什么补什么，显式关闭不覆盖）
  - `electron/main/agents/ability-registry.test.ts`：既有断言 `packOf('browser').toolGroups` 等于 `['browser', 'dogear-extension']`，需同步
- 关键决策回顾：enabledToolPacks 残留 `'extension'` 维持静默忽略；Profile browser/extension 双字段语义不变。

## 计划改动

- [ ] `ability-registry.ts`：browser 包收窄（toolGroups: ['browser']，skills 移除，描述改内嵌单通道）；新增 browser-extension 包（toolGroups: ['dogear-extension']，描述含登录态/在场协作/tab group 定位）；新增 browser-methodology 纯 skill 包（skills: ['browser-exploration']，无 toolGroups——验证现有类型与消费方对无 toolGroups 包的兼容性）
- [ ] `tool-assembly.ts`：主会话 extension 分支闸改 `activeAbilities.has('browser-extension')`；子会话双闸改 `activeAbilities.has('browser-extension') && ab.extension === true`；`filterSkillsForSubAgent` 的 browser-exploration 判定与方法论包对齐（实施时确认 resolveAbilities 输出形态）
- [ ] `settings-service.ts`：normalizeSettings 迁移——存量 abilityOverrides/相关配置有 browser 开启记录时补 browser-extension / browser-methodology 开启键；缺键才写，幂等
- [ ] `tool-packs.ts`：头注释与 browser 包描述同步（双通道描述拆为单通道，扩展描述移至新包或 ability-registry）
- [ ] `ability-registry.test.ts` / `tool-registration-smoke.test.ts` / `permission-rules.test.ts`：包归属断言同步（browser toolGroups / 新包 key / extension 反查）
- [ ] 验证：`bun run lint` + `bun run build:electron` + `bun test`；冒烟：dev 起主会话确认关 browser-extension 包后无 dogear__extension__* 工具、browser-exploration skill 随方法论包开关挂载

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
