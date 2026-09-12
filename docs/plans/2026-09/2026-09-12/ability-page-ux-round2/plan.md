# 能力页 UX 二轮修正 实施计划

**目标**：能力页五条反馈落地——规则合并展示、渲染字号统一、详情页布局重划、系统行为三区重定位、工具归属修正（extension 并包 / reference 拆组 / 常驻工具搬家）。

**架构思路**：注册表仍是单一真源，常驻工具（不可关）不进 `ABILITY_PACKS`，数据走 tool-registry 按组名取；规则合并是前端展示层组合，`workspace-rules` / `global-rules` 两个包 key 不变；extension 归 browser 包（主会话受包总闸，子会话 = 包生效 ∩ Profile extension 细闸）；reference 拆出通用检索常驻组。设计全文见 [design.md](./design.md)。

**涉及模块**：`electron/main/agents/ability-registry.ts`、`agents/tools/reference-tools.ts`、`agents/pi-session/pi-session.ts`、`services/tool-packs.ts`、`tipc/ability.ts`、`app/settings/AbilityTab.tsx` + `ability/*`、`SkillDetailDialog` / `ToolDetailDialog`、`app/settings/page.tsx`、主界面顶部 WorkspaceRuleDialog 入口。

## 步骤索引

- [x] [Step 1: 后端工具归属修正](./step1-backend-ownership.md) — 注册表（profile-index 移除 / browser 并 extension）+ reference 拆组 + pi-session 注册条件 + 测试更新
- [x] [Step 2: 首页与规则编辑重构](./step2-rules-merge.md) — 规则合并卡 + 合并详情页 + RuleFileEditor 单栏态切换 + 移除顶部 WorkspaceRuleDialog 入口
- [ ] [Step 3: 详情页布局重划与系统行为三区](./step3-detail-layout.md) — skill chips 进左侧 + 右侧窄栏瘦身 + SystemBehaviorDetail 三区（常驻工具区含权限就地控制）+ 浮窗闪烁修复
- [ ] [Step 4: 渲染字号统一与收尾验证](./step4-style-unify.md) — 段全文 MarkdownRenderer + 全页清固定像素字号 + 全量验证与冒烟 + codebase-map 更新

## 全局决策

- **字号**：能力页范围内只用 Tailwind 标准档位（`text-xs` / `text-sm` 等），禁止 `text-[Npx]`；段全文一律 `MarkdownRenderer` + `text-sm`，只保留渲染态。
- **常驻工具不进包**：检索组 / dogear-tasks / 基础工具均不可关，不写入 `ABILITY_PACKS`；前端常驻区数据从 tool-registry（getAbilityPacks 视图）取，基础工具权限走 settings-store。
- **extension 语义**：主会话 = browser 包总闸（`enabledToolPacks` 残留 `extension` 静默忽略）；子会话 = `activeAbilities.has('browser') && profile.enabledAbilities.extension === true`。
- **规则合并**：展示层组合（AbilityTab 将 workspace-rules 渲染为合并卡、两 key 路由到同一合并详情组件），开关存储与拼装侧零改动。
- **权限即时保存**：基础工具权限从设置页草稿模式改为 `client.updateSettings` 即时保存（跟随既有 settingsChanged 广播热更新）。
- **commit**：每步一个 commit，排除工作区既有改动（package.json 版本号 bump、tmp/）。
