# 能力页 UX 二轮修正 实施计划

**目标**：能力页五条反馈落地——规则合并展示、渲染字号统一、详情页布局重划、系统行为三区重定位、工具归属修正（extension 并包 / reference 拆组 / 常驻工具搬家）。

**架构思路**：注册表仍是单一真源，常驻工具（不可关）不进 `ABILITY_PACKS`，数据走 tool-registry 按组名取；规则合并是前端展示层组合，`workspace-rules` / `global-rules` 两个包 key 不变；extension 归 browser 包（主会话受包总闸，子会话 = 包生效 ∩ Profile extension 细闸）；reference 拆出通用检索常驻组。设计全文见 [design.md](./design.md)。

**涉及模块**：`electron/main/agents/ability-registry.ts`、`agents/tools/reference-tools.ts`、`agents/pi-session/pi-session.ts`、`services/tool-packs.ts`、`tipc/ability.ts`、`app/settings/AbilityTab.tsx` + `ability/*`、`SkillDetailDialog` / `ToolDetailDialog`、`app/settings/page.tsx`、主界面顶部 WorkspaceRuleDialog 入口。

## 步骤索引

- [x] [Step 1: 后端工具归属修正](./step1-backend-ownership.md) — 注册表（profile-index 移除 / browser 并 extension）+ reference 拆组 + pi-session 注册条件 + 测试更新
- [x] [Step 2: 首页与规则编辑重构](./step2-rules-merge.md) — 规则合并卡 + 合并详情页 + RuleFileEditor 单栏态切换 + 移除顶部 WorkspaceRuleDialog 入口
- [x] [Step 3: 详情页布局重划与系统行为三区](./step3-detail-layout.md) — skill chips 进左侧 + 右侧窄栏瘦身 + SystemBehaviorDetail 三区（常驻工具区含权限就地控制）+ 浮窗闪烁修复
- [x] [Step 4: 渲染字号统一与收尾验证](./step4-style-unify.md) — 段全文 MarkdownRenderer + 全页清固定像素字号 + 全量验证与冒烟 + codebase-map 更新

## 全局决策

- **字号**：能力页范围内只用 Tailwind 标准档位（`text-xs` / `text-sm` 等），禁止 `text-[Npx]`；段全文一律 `MarkdownRenderer` + `text-sm`，只保留渲染态。
- **常驻工具不进包**：检索组 / dogear-tasks / 基础工具均不可关，不写入 `ABILITY_PACKS`；前端常驻区数据从 tool-registry（getAbilityPacks 视图）取，基础工具权限走 settings-store。
- **extension 语义**：主会话 = browser 包总闸（`enabledToolPacks` 残留 `extension` 静默忽略）；子会话 = `activeAbilities.has('browser') && profile.enabledAbilities.extension === true`。
- **规则合并**：展示层组合（AbilityTab 将 workspace-rules 渲染为合并卡、两 key 路由到同一合并详情组件），开关存储与拼装侧零改动。
- **权限即时保存**：基础工具权限从设置页草稿模式改为 `client.updateSettings` 即时保存（跟随既有 settingsChanged 广播热更新）。
- **commit**：每步一个 commit，排除工作区既有改动（package.json 版本号 bump、tmp/）。

## 完成总结

四步全部实施完毕（2026-09-12），每步独立 commit：

1. **Step 1（5ec080eb）后端工具归属**：extension 并入 browser 包（主会话只受包总闸、旧 enabledToolPacks 残留静默忽略；子会话双闸 = browser 包 ∩ Profile extension）；reference 拆组——ListTopics/ReadReferenceSession 拆为 dogear-history「跨会话检索」常驻组（绑工作区即注册），ReadGroupBackground/ListSiblingSessions 留守 dogear-reference（协作条件不变）；SYSTEM_BEHAVIORS 删 profile-index（3→2）。
2. **Step 2（273772a5）规则入口收口**：首页「规则」合并卡（双状态徽标、无总开关）+ RulesPackDetailPage（左双编辑器、右双开关+双挂载）；RuleFileEditor 改单栏渲染/编辑态切换；移除主界面顶部 WorkspaceRuleDialog（组件删除）。
3. **Step 3（7e1e433d）详情页布局重划**：skill 型包左侧 chips 切换 + SKILL.md 就地渲染（细开关就近）；右栏瘦身 w-72；SystemBehaviorDetail 三区（会话组上下文/主子协作/常驻工具=基础工具权限即时保存 + dogear-history/dogear-tasks 清单）；ToolDetailDialog 关闭闪烁修复；SkillDetailDialog 内联替代后删除。
4. **Step 4（本次 commit）渲染统一与收尾**：SegmentBlock 换 MarkdownRenderer + text-sm；app/settings/ 全范围清固定像素字号（29 处，Grep 归零）；新建 tool-registration-smoke.test.ts 代码级冒烟（9 测试：纯净模式常驻组、browser 总闸 gate、子会话双闸、reference 拆组）；codebase-map 同步 7 小节。

**验证终态**：lint 0 errors（84 warnings 全既有 any）/ bun run build ✓ / tsc --noEmit ✓ / bun test 299 pass 0 fail。

**遗留（GUI 冒烟待人工）**：字体大小切换全页观感、skill chips 切换与细开关联动、浮窗开关无闪烁、权限切换即时保存广播生效——子会话环境无 GUI 未跑，建议用户开发模式抽查。data-center/ 下 5 处 text-[10px] 不在本计划范围未动。
