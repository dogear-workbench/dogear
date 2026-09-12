# 能力包体系（Ability Pack）实施计划

**目标**：把分裂的能力体系（前端硬编码域/包映射/常驻组 + 主进程段模板 + 散落拼装 if）收敛为主进程能力注册表单一真源，能力页改两级结构（首页卡片+开关 / 详情左右分栏），详情页提供挂载情况反向索引。

**架构思路**：新建 `ability-registry.ts` 定义 AbilityPack（提示词段+工具组+skill 三件套任意组合），`WorkspaceConfig` 加 `abilityOverrides` 只存显式拨过的包；`pi-session.ts` 拼装与工具注册消费同一份 resolveAbilities 结果；前端全量数据驱动零硬编码。设计全文见 [../ability-pack-design.md](../ability-pack-design.md)。

**涉及模块**：`electron/main/agents/ability-registry.ts`（新建）、`session-append-templates.ts`、`pi-session/pi-session.ts`、`group-context-builder.ts`、tipc（ability 路由 + workspace config）、`app/settings/AbilityTab.tsx` 及周边组件、设置页全局规则入口迁移。

## 步骤索引

- [x] [Step 1: 能力注册表与配置扩展](./step1-registry.md) — 新建注册表（10 包 + 结构性段元数据 + resolveAbilities），WorkspaceConfig 加 abilityOverrides
- [ ] [Step 2: pi-session 接入注册表](./step2-session.md) — 拼装与工具组注册改查包生效结果，规则文件受开关，组上下文按协作包裁剪
- [ ] [Step 3: IPC 路由](./step3-ipc.md) — getAbilityPacks / getAbilityMounts，确认 agent.md 读写复用
- [ ] [Step 4: 能力页两级重构](./step4-ui.md) — 首页卡片网格 + 详情页左右分栏 + 挂载情况 + 规则文件内嵌编辑，删旧组件
- [ ] [Step 5: 入口收编与验证](./step5-cleanup.md) — 全局规则入口迁移、旧硬编码清理、build/lint/纯净模式冒烟

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
