---
step: 2
title: 挂载矩阵补任务维度
status: done
---

## 目标

能力页挂载矩阵补「定时自定义任务 / 话题状态抽取 / 文章解析」三条固定行，功能 × 场景图谱完整。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 已完成术语替换（reason 文案里不再出现「细闸」）
- `electron/main/tipc/ability.ts`：`AbilityMountSceneKind = 'main' | 'sub-default' | 'profile' | 'executor'`（:82）加 `'scheduler'`；`getAbilityMounts(pack, workspaceId)`（:398 起）现读 config 的 abilityOverrides + subAgent profiles，需补读 `enabledToolPacks`（同一 config.json 字段）
- 装载真源对照：`electron/main/services/scheduler/custom-agent-tools.ts` `buildCustomToolSet`——基础集恒装（文件+Glob/Grep+memory，memory 不受包开关控制）；可选包按 `enabledToolPacks.has(name)`；browser 包只查 `browser` 条目（不装扩展通道）；无 skill 挂载、无规则/画像段注入
- 矩阵行结构：`AbilityMountSceneRow { kind, id, label, system, loaded, reason, profileDisabled? }`（:85-102），`MOUNT_GROUP_PLACEHOLDER` 占位组 ID 用于属组类条件放行（本次不适用：后台任务行不查组）

## 计划改动

- [ ] `electron/main/tipc/ability.ts`：`AbilityMountSceneKind` 加 `'scheduler'`
- [ ] `getAbilityMounts` 补读 `enabledToolPacks`，追加三条 `system: true` 固定行（在 executor 行之后）：
  - **定时自定义任务**（id: `custom-agent`）：
    - prompt-only 包（workspace-rules/global-rules/core-profile）→ false，reason「后台任务不注入规则与画像段」
    - notes → false「笔记与任务工具为主会话专属」；group-context → false「后台任务无会话组上下文」；agent-collab → false「后台任务无派遣与交付通道」
    - memory → **true**，reason「定时任务固定装载记忆工具（autonomous 契约），不受包开关约束」
    - code-workflow → false「定时任务无 skill 挂载机制」
    - skill-packs 包（stock/article/browser/web-mcp）→ `pack.toolGroups ∩ enabledToolPacks` 非空 = true；reason 列出实际命中的工具包名（如「已启用工具包：stock-quote、stock-analysis；skill 方法论文本不注入」）；全不命中 = false「工作区未启用该域任何工具包」；browser 包特判：extension 条目不算命中（`enabledToolPacks` 里 `browser` 才算），reason 注明「扩展通道不随定时任务装载」
  - **话题状态抽取**（id: `state-extract`）：全 false，reason「固定提示词 + emit_state_increment 单工具，不挂载能力包」
  - **文章解析**（id: `parse-article`）：全 false，reason「Claude Agent SDK 独立装配（SKILL.md 提示词），不经过能力包体系」
- [ ] `app/settings/ability/AbilityMountsSection.tsx`：展示适配——scheduler kind 三行追加在 executor 后；kind 徽标文案映射补「后台」或按行 label 展示（看现有行 label 渲染方式，样式对齐 system 行；不新起分组列，视觉密度高再调，见设计未决问题）
- [ ] `bun run build:electron` 编译通过 + 能力页任一包详情目视验证三行出现且 loaded/reason 合理（对照本工作区 enabledToolPacks 实际值）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① 前端按计划二选一取「kind 徽标映射」：system 徽标按 kind 分支（scheduler → 「后台任务」，其余「系统预设」），行顺序由后端 rows 决定追加在 executor 后，不新起分组；② web-mcp 无 skills 字段，命中 reason 不追加「skill 方法论文本不注入」（按 pack.skills?.length 条件追加）；③ schedulerCustomAgentCell default 分支对非 skill-packs 兜底「后台任务不加载该能力包」（当前 12 包全覆盖不可达，防未来新增包）；④ 目视验证无法启动 Electron UI，改为纯逻辑推演 15 项断言（含 extension 残留特判、web-mcp 无注记、空数组全 false）全 PASS，UI 目视留给 step4 验收。
- 改动文件清单：
  - `electron/main/tipc/ability.ts`：AbilityMountSceneKind 加 'scheduler'；新增 schedulerPackHitCell / schedulerCustomAgentCell；buildMountRows 加 enabledPacks（config.enabledToolPacks）并在 executor 后追加三条 system 行
  - `app/settings/ability/AbilityMountsSection.tsx`：system 徽标按 kind 映射（scheduler → 「后台任务」）

### 给下一步的接力棒
- 关键签名 / 数据结构：schedulerCustomAgentCell(pack, enabledPacks) → { loaded, reason }；定时任务行语义 = 只查 enabledToolPacks 不查 abilityOverrides（buildCustomToolSet 真源），与其它行的「包开关已关闭」分支语义不同；行 id：custom-agent / state-extract / parse-article，kind 均为 'scheduler'，system 均为 true
- 下个 step 该从哪里继续：step3（ProfileEditor 块化）按 plan.md 顺序继续；step4 验收时在能力页包详情目视三条后台行（本工作区 enabledToolPacks 空 → skill-packs 行均 false「工作区未启用该域任何工具包」，memory 行 true）
- 待办或已知限制：定时任务行不查包总开关是「以实际装载为准」的设计意图（buildCustomToolSet 不读 abilityOverrides），UI 上同一包可能出现主会话行 false（总开关关）而后台行 true（子开关开）的表面不一致，reason 已按事实陈述，若用户困惑可在 step4 验收后考虑补引导文案
