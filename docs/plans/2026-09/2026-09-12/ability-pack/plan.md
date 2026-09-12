# 能力包体系（Ability Pack）实施计划

**目标**：把分裂的能力体系（前端硬编码域/包映射/常驻组 + 主进程段模板 + 散落拼装 if）收敛为主进程能力注册表单一真源，能力页改两级结构（首页卡片+开关 / 详情左右分栏），详情页提供挂载情况反向索引。

**架构思路**：新建 `ability-registry.ts` 定义 AbilityPack（提示词段+工具组+skill 三件套任意组合），`WorkspaceConfig` 加 `abilityOverrides` 只存显式拨过的包；`pi-session.ts` 拼装与工具注册消费同一份 resolveAbilities 结果；前端全量数据驱动零硬编码。设计全文见 [../ability-pack-design.md](../ability-pack-design.md)。

**涉及模块**：`electron/main/agents/ability-registry.ts`（新建）、`session-append-templates.ts`、`pi-session/pi-session.ts`、`group-context-builder.ts`、tipc（ability 路由 + workspace config）、`app/settings/AbilityTab.tsx` 及周边组件、设置页全局规则入口迁移。

## 步骤索引

- [x] [Step 1: 能力注册表与配置扩展](./step1-registry.md) — 新建注册表（10 包 + 结构性段元数据 + resolveAbilities），WorkspaceConfig 加 abilityOverrides
- [x] [Step 2: pi-session 接入注册表](./step2-session.md) — 拼装与工具组注册改查包生效结果，规则文件受开关，组上下文按协作包裁剪
- [x] [Step 3: IPC 路由](./step3-ipc.md) — getAbilityPacks / getAbilityMounts，确认 agent.md 读写复用
- [x] [Step 4: 能力页两级重构](./step4-ui.md) — 首页卡片网格 + 详情页左右分栏 + 挂载情况 + 规则文件内嵌编辑，删旧组件
- [x] [Step 5: 入口收编与验证](./step5-cleanup.md) — 全局规则入口迁移、旧硬编码清理、build/lint/纯净模式冒烟

## 全局决策

- **包 key 命名**（kebab-case）：`workspace-rules` / `global-rules` / `core-profile` / `memory` / `notes` / `agent-collab` / `stock` / `article` / `browser` / `code-workflow`
- **abilityOverrides 语义**：只存显式拨过的包，缺省走 `defaultEnabled`；残留下线 key 静默忽略
- **生效语义**：`生效(包) = 工作区包开关 ∩ 触发条件 ∩ (子会话时 Profile 过滤)`；skill 型双闸 = 包总闸 ∩ enabledSkills 细闸
- **defaultEnabled**：规则文件型/段+工具型 = true（维持现状），skill 型 = false（维持现状）
- **协作包特殊性**：关闭后主会话无派遣工具（子会话不会被创建，自洽）；组上下文裁剪为纯组头；子会话契约段不受包开关影响
- **段提示词只读**：规则文件型（agent.md/核心画像）详情页可编辑，段型跟随代码版本
- **前端零硬编码**：能力元数据全量来自 `getAbilityPacks()`，`ABILITY_DOMAINS`/`SKILL_PACK_MAP`/`RESIDENT_GROUPS` 删除
- **两级态**：AbilityTab 组件内部 state 切换（同 SchedulerPanel editing 模式），不走路由
- **修改生效**：沿用「修改后需重启会话生效」链路（快照标脏），能力开关即时写 workspace config

## 完成总结

五步全部实施完毕（2026-09-12），能力体系从四处分裂收敛为注册表单一真源：

| Step | 交付 | commit |
|---|---|---|
| 1 | ability-registry.ts（10 包 + resolveAbilities + SYSTEM_BEHAVIORS）+ WorkspaceConfig.abilityOverrides | 3204dce2 |
| 2 | pi-session 拼装/工具注册统一查包，skill 型包 TOOL_PACK_TO_ABILITY 总闸消灭半开，组上下文按协作包裁剪 | ee4d168b |
| 3 | tipc/ability.ts（getAbilityPacks 四源聚合 / getAbilityMounts 三组反向索引）+ Profile 判定纯函数与 9 项单测 | f66af8b3 |
| 4 | 能力页两级重构：卡片网格 + 详情分栏（规则文件内嵌编辑/挂载情况/skill 细闸）+ 标脏接线 | 4028d7ff |
| 5 | 入口收编、死代码清理、三模式冒烟 28 断言、codebase-map 同步 | 本次 |

**行为变化（升级须知）**：skill 型包（股票/文章/浏览器/代码工作流）default false 为总闸，存量 enabledSkills/enabledToolPacks 已勾选的用户需在能力页拨包开关恢复（设计预期）。未拨开关时规则文件型/段+工具型行为与重构前一致（冒烟验证）。

**遗留**：无实施遗留；dev 环境 UI 人工点验未做（无 Electron 环境，以 tsc/build/lint/test/冒烟为准），用户可在应用里点验能力页两级交互与规则编辑。
