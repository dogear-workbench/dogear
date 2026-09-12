---
step: 4
title: 能力页两级重构
status: done
---

## 目标

AbilityTab 改两级结构：首页能力包卡片网格 + 详情页左右分栏（含挂载情况与规则文件编辑），删除旧硬编码组件。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-ipc.md] `getAbilityPacks()` / `getAbilityMounts(key)` / agent.md 读写 RPC 可用
- 现状参考：`app/settings/AbilityTab.tsx`（单页编排，expandedDomains/expandedPacks state、applySkillToggles 开关逻辑——skill 联动工具包的逻辑保留复用）；`app/data-center/scheduler/TaskEditorPage.tsx`（二级页形态参考：面包屑工具栏 + 左主区 + 右参数栏）；`app/settings/ability-types.ts`（本步删硬编码，保留或改写纯 UI 类型）

## 计划改动

- [x] `AbilityTab.tsx` 改两级 state：`selectedKey: string | null`（null = 列表态，'__system__' = 系统行为）；顶部工作区选择器保留（列表态）
- [x] 新建 `app/settings/ability/AbilityPackCard.tsx`：图标 + 名称 + 描述 + 开关 + 统计（段/工具组/skill 数）+ 类型徽标；「系统行为」卡在 AbilityTab 内联（虚线卡，只读无开关，徽标「系统」）
- [x] 新建 `app/settings/ability/AbilityPackDetailPage.tsx`：
  - 面包屑（能力 / 包名 / 工作区）+ 返回
  - 左主区：说明 + 大提示词区（段型多段只读展示；workspace-rules/global-rules 内嵌编辑器双栏 textarea+预览；core-profile 只读全文 + 跳数据中心入口）
  - 右参数栏（拆为 `ability/AbilityPackSidebar.tsx`，w-80）：主开关（写 abilityOverrides）+ 配套清单（skill 细开关 + 工具组折叠列表）+ 挂载情况（拆为 `ability/AbilityMountsSection.tsx`）+ 重启生效提示
- [x] 「系统行为」详情页：新建 `ability/SystemBehaviorDetail.tsx`，三个结构性段全文只读
- [x] 删除：`AbilityResidentSection.tsx`、`AbilityDomainCard.tsx`、`SegmentDetailDialog.tsx`、`ability-types.ts`（整体删除，无消费方残留）；skill→包联动映射改从 `getAbilityPacks()` 的 skillMetas[].toolPacks 派生
- [x] `SkillDetailDialog` / `ToolDetailDialog` 在详情页内复用保留
- [x] 验证：`bunx tsc -p tsconfig.json --noEmit`（前端类型）+ `bun run build:electron` + `bun run build` + `bun run lint` 全过；dev:renderer 启动无编译错（无法人工点验 UI，以构建+类型+lint 为准）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 详情页右参数栏拆出 `AbilityPackSidebar.tsx`，挂载情况再拆 `AbilityMountsSection.tsx`（自拉数据 + refreshKey 刷新），避免单文件超 300 行；规则文件编辑器独立为 `RuleFileEditor.tsx`（双栏 textarea+Markdown 预览，恢复模板沿用 WorkspaceRuleDialog 模式）。
  2. skill 细开关写入未走 setSkillEnabled 路由（该路由不联动工具包），保留原 applySkillToggles 经 updateWorkspaceConfig 原子双写 enabledSkills+enabledToolPacks（映射源换成 getAbilityPacks 的 skillMetas[].toolPacks）——与「applySkillToggles 保留复用」的范围约束一致。
  3. 主进程快照标脏：PiSessionManager 新增公开方法 `markWorkspaceSessionsDirty(workspaceId)`（sessions 为 private），tipc workspace-config 路由在 `input.config.abilityOverrides` 存在时调用；skill 细开关写（不携带 abilityOverrides）不标脏，维持「重启生效」现状。
  4. `ability-types.ts` 整体删除（纯 UI 类型也无消费方，新组件类型从主进程 tipc/ability import type）。
  5. `electron/main/tipc/ability.ts` 补 1 行 `export type { AbilityPackType }`（pack-meta.ts 图标映射的徽标文案键需要）。
  6. page.tsx 的 `<AbilityTab />` 改无 props（原 local/setLocal 未被使用）。
- 改动文件清单：
  - 新建：`app/settings/ability/{pack-meta.ts, AbilityPackCard.tsx, AbilityPackDetailPage.tsx, AbilityPackSidebar.tsx, AbilityMountsSection.tsx, RuleFileEditor.tsx, SystemBehaviorDetail.tsx}`
  - 重写：`app/settings/AbilityTab.tsx`（268 行，编排层）
  - 删除：`app/settings/{AbilityDomainCard.tsx, AbilityResidentSection.tsx, SegmentDetailDialog.tsx, ability-types.ts}`
  - 修改：`app/settings/page.tsx`（调用改无 props）、`electron/main/agents/pi-session/pi-session-manager.ts`（+markWorkspaceSessionsDirty）、`electron/main/tipc/workspace-config.ts`（abilityOverrides 写后标脏）、`electron/main/tipc/ability.ts`（re-export AbilityPackType）
- 验证结果：前端 tsc --noEmit 0 错、build:electron 0 错、`bun run build` 完整过、lint 0 errors（87 warnings 均存量 any 基线）、bun test 288 项 0 fail、dev:renderer 启动无编译错。

### 给下一步的接力棒
- 关键签名 / 数据结构：`AbilityTab()` 无 props；两级 key 用 `selectedKey: string | null`，'__system__' 表示系统行为详情；配置刷新用 `configVersion` 计数器透传给 AbilityMountsSection 触发重拉。
- 下个 step 该从哪里继续：Step 5（全局规则入口迁移 + cleanup）：设置页基础设置的「通用级 Agent 指令」入口迁到能力页 global-rules 详情（编辑器已就位，删旧入口即可）；getSystemPromptSegments 路由已无消费方可删；docs/codebase-map.md 的 AbilityTab 相关条目已过时需更新。
- 待办或已知限制：详情态无工作区切换入口（返回列表态再切，与 TaskEditorPage 形态一致）；挂载情况为读时快照，开关写入成功后靠 configVersion 触发重拉一次，他人并发改动不会自动反映。
