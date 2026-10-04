---
step: 1
title: 后端能力包拆分与迁移
status: done
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
  1. 迁移落点改在 `workspace-config-service.ts`（读时归一，内存态生效，UI 下次写回自然落盘，参照 personal 默认合并先例）：abilityOverrides/sceneOverrides 真身在 workspace config 不在 settings.json，计划写的 settings-service 归因不准；settings-service 只承担 Profile 侧迁移（browser:true 且 skills 键整体缺失 → 补 skills:['browser-exploration']）。
  2. browser-methodology 不设 subAutonomous（无对应 Profile 字段），沿 code-workflow 先例：包级随工作区闸，子会话 skill 级走 filterSkillsForSubAgent 通用 `ab.skills` 细选——浏览器解析/存量 browser:true Profile 由 normalize 补 skills 键兜底；用户清理过 skills 数组的视为显式意愿不回填（幂等）。
  3. `pi-session.ts` browserPlaybook 注入闸同步改 `browser-methodology`（原注释承诺与 browser-exploration skill 同条件，拆包后随方法论包）；WEB_RESEARCH_GUIDANCE 触发条件保持 `web-mcp || browser` 不动（内容提到 dogear__browser__* 与 browser-parse，扩展-only 会话注入反而误导，通道表述归 step 3）。
  4. `ability-scene.ts` PROFILE_FILTER 扩展字段映射与 skill 细选标签（挂载矩阵 reason 文案与新包归属对齐，loaded 值本身数据驱动无需改）。
  5. `eslint.config.mjs` 补 `release2/**` 忽略：存量问题——release2 构建产物不在 ignore 列表导致 `bun run lint` 报 5535 错，与本步改动无关，不修无法过验证门。
  6. 迁移不动 workspace enabledSkills：无法区分「从未勾过」与「显式取消」（数组无缺键态），且老版本主会话本就以 enabledSkills 为准——存量 browser 开且 UI 开过包的用户 enabledSkills 已含 browser-exploration（能力页开包联动写入），行为无损；其余场景子会话丢方法论 skill 可在派遣页重勾（step 2 加开关）。
- 改动文件清单：ability-registry.ts（拆三包 + SUB_AUTONOMOUS_SWITCH + SKILL_PACK_MAP 去 browser-exploration）、tool-assembly.ts（主/子会话 extension 闸 + filterSkillsForSubAgent 通用化）、pi-session.ts（playbook 闸）、tool-packs.ts（头注释 + browser 条目改内嵌浏览器）、settings-service.ts（Profile skills 迁移）、settings-types.ts（browser-parse 工厂补 skills）、workspace-config-service.ts（读时拆包迁移 + personal 默认补两键）、ability-scene.ts（Profile 过滤标签映射）、eslint.config.mjs、types/settings.ts（前端镜像工厂同步）、三个测试文件断言同步。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 包 key：`browser`（subAutonomous→ab.browser）/ `browser-extension`（subAutonomous→ab.extension）/ `browser-methodology`（非自治，工作区闸 + enabledSkills 细闸，子会话另加 Profile ab.skills 细选）
  - TOOL_PACK_TO_ABILITY：`browser→browser`、`dogear-extension→browser-extension`；browser-methodology 无 toolGroups 不进反查表
  - 迁移语义：`migrateBrowserPackSplit(overrides)`——browser===true 且新包键缺失才写 true；读时内存态生效，updateWorkspaceConfig 写回自然落盘
  - filterSkillsForSubAgent：browser-exploration 无特判，走 builtin 通用 `ab.skills?.includes`
- 下个 step（step 2 前端）从哪里继续：场景页三行数据已自动出（getSceneOverview 遍历 ABILITY_PACKS，extension 类包自动排除出 sub 行）；派遣页 SubAgentTab renderPackBlock 对 browser-extension/browser-methodology 目前 return null（SINGLE_FIELD_BY_PACK 无映射），需按本回填第 2 条的闸语义加双开关 + 方法论 skill 细选（写 ab.skills）；能力页三卡自动出，纯 skill 包详情空态需检查；PROFILE_FILTER 文案已就绪。
- 待办或已知限制：
  - 存量 enabledSkills 缺 browser-exploration 的工作区：子会话丢方法论 skill（主会话本来就无，非回归）；等 step 2 派遣页开关后用户可自行勾补
  - 调度任务（buildCustomToolSet）自读 config.json 不走 getWorkspaceConfig，但不消费新包键，无影响
  - schedulerCustomAgentCell 对 browser-extension 的 reason 文案（『工具包与 skill 在定时任务编辑页按任务配置』）与实际（定时任务不装扩展工具）不符，属展示细节待后续步顺带修
