# 会话分流能力包登记 + 临时会话加载行 设计

**背景**：随手问与分流功能（Step 5/6）实施时，ForkSession 工具与 shunt-guidance 段的运行时注册借用了 notes 包开关条件（`pi-session.ts` 中 `activeAbilities.has('notes')`），未登记进能力包注册表 `ABILITY_PACKS`——能力页任何包详情都看不到这段提示词与工具；`tipc/ability.ts` 的 `PACK_TOOL_MODULE_IMPORTS` 也缺 fork-session-tool 模块 import，工具组数据拉不到。加载矩阵（getAbilityMounts）缺「临时会话（personal）」场景行。

**目标**：
1. 新建独立能力包「会话分流」，登记 shunt-guidance 段 + dogear-shunt 工具组（ForkSession），能力页可见、开关可控
2. 加载矩阵补「临时会话」行，如实反映 personal 实际装配

**架构**（拍板决策）：
- 独立包，不并入 notes 也不并入 agent-collab：分流是独立功能，与现有包无重合（协作段教「派子会话→等交付」，分流段教「平级分出→不等待」，对照不重合）
- **不做跨包联动**：note 动作依赖 notes 包的 CreateNote，各包自管；笔记关时 note 动作 agent 做不了就如实回不了。防呆手段只在段内容加一行「建议卡 options 按当前可用工具裁剪（CreateNote 未注册时不再提供 note 选项）」——模型可见自身工具列表，从源头少给不可用选项
- **段瘦身**：删与 ForkSession description 重叠的执行细节（参数怎么传、回执带链接——工具 description 与 result 文本已覆盖），段只留建议块输出协议（前端渲染契约）+ 三动作执行总则
- **临时会话行**：kind='personal' 系统行，加在「主会话」行之后；各包 loaded 按 personal 自己的 config（`getWorkspaceConfig(PERSONAL_WORKSPACE_ID)`）+ `{ role: 'main', hasWorkspace: false, groupId: null }` 计算

**模块边界**：
- `electron/main/agents/ability-registry.ts`：ABILITY_PACKS 新增包条目；resolveAbilities 加 shunt 触发条件（role=main + hasWorkspace + groupId；executor 由拼装侧显式排除，同 notes-discipline 模式）
- `electron/main/agents/session-append-templates.ts`：shunt-guidance 段瘦身 + options 裁剪行；triggerDescription 更新（去「与存卡纪律同条件」表述）
- `electron/main/agents/pi-session/pi-session.ts`：ForkSession 注册条件与段注入条件从 `has('notes')` 改为 `has('shunt')`（保留 workspacePath + groupId + 非 executor 检查）
- `electron/main/tipc/ability.ts`：PACK_TOOL_MODULE_IMPORTS 补 fork-session-tool.js；buildMountRows / buildSystemMountRows 加 personal 行
- `app/settings/ability/AbilityMountsSection.tsx`：personal 行标签「临时会话」展示（如 kind 分组需扩展）

包定义草案：
```ts
{
  key: 'shunt',
  label: '会话分流',
  description: '岔题分流：岔题时输出建议卡，用户确认后平级分出新会话/新话题或记为笔记（note 动作依赖笔记卡片包的建卡工具）',
  type: 'segment-tools',
  segmentKeys: ['shunt-guidance'],
  toolGroups: ['dogear-shunt'],
  mainOnly: true,
  defaultEnabled: true,
}
```

**数据流**：能力页数据源 = ABILITY_PACKS（单一真源）→ getAbilityPacks 聚合段元数据（getSystemPromptSegments）+ 工具组（tool-registry，需模块 import 触发注册）→ 包详情页展示；加载矩阵 = getAbilityMounts 按场景调 resolveAbilities 快照。

**personal 矩阵行事实基准**（已按代码验证，矩阵如实展示）：
- 全局规则段：注入（包开即生效）
- 核心画像段：注入（主会话始终加载，`pi-session.ts:508`）
- 工作区规则段：机制生效（读 workspaces/personal/agent.md，大概率空）
- memory：包级不生效（hasWorkspace=false 被 resolveAbilities 排除）但工具兜底注册（`pi-session.ts:685`）→ loaded=false + reason 写明「工具兜底注册可用，纪律段不注入」
- dogear-history（常驻组矩阵）：放行（personal 只读话题工具辅助归置建议）
- notes/会话组/协作/分流/skill 包：不生效（无工作区路径、无组）
- 基础工具（read/write/edit/bash/Grep/Glob）：注册，basePaths 无工作区路径仅剩 config 挂载

**错误处理 / 边界情况**：
- 旧工作区 abilityOverrides 无 'shunt' key → 走 defaultEnabled: true，无需迁移
- notes 关 + shunt 开：段注入但 CreateNote 不在 → 段内裁剪行兜底（options 不含 note）；若模型仍输出 note 选项，agent 无工具时如实回复，可接受退化
- executor：shunt 显式排除（无人值守无分流场景）

**未决问题**：无。
