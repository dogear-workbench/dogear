---
step: 3
title: 详情页布局重划与系统行为三区
status: done
---

## 目标

详情页左右职责重划（skill chips 进左侧、右侧窄栏瘦身）、SystemBehaviorDetail 重构为三区（含常驻工具就地控制）、两个详情浮窗修复关闭闪烁。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-rules-merge.md] 的实施回填（RulesPackDetailPage 结构、RuleFileEditor 新接口）
- 关键现状：
  - `app/settings/ability/AbilityPackDetailPage.tsx`：左侧 flex-1 内容区（段型包专用）+ 右侧 `AbilityPackSidebar`（w-80：包开关 / skill 细开关列表 / 工具组折叠 / 挂载）
  - `app/settings/SkillDetailDialog.tsx`：`open={skill !== null}`，skill 置 null 即清内容（闪烁根因）；`ToolDetailDialog.tsx` 同构问题
  - `app/settings/BasicToolsSection.tsx`：props `{ local, setLocal }` 草稿模式，挂在 `app/settings/page.tsx:483`（基础 tab）
  - 常驻组数据：Step 1 后 tool-registry 有 `dogear-history`（跨会话检索）与 `dogear-tasks`；`tipc/ability.ts` 的 groupByServer 取组工具的现成链路（getAbilityPacks 内）
- 关键决策回顾：工具详情保持浮窗；skill 细开关挪到左侧选中 skill 标题旁；右侧保持固定窄栏不搞 3:2；权限改即时保存

## 计划改动

- [ ] `tipc/ability.ts`：getAbilityPacks 视图增加 `residentToolGroups`（从 tool-registry 按 `['dogear-history', 'dogear-tasks']` 组名取工具清单与组 label）；基础工具权限值不入此接口（前端 settings-store 直读）
- [ ] `AbilityPackDetailPage.tsx` 左侧内容区改造：
  - skill 型包（skillMetas.length > 0）：顶部 skill 切换 chips（横向排布，选中态高亮，skill 文件缺失标注），下方显示选中 skill 的 SKILL.md 渲染全文（复用 SkillDetailDialog 的加载逻辑抽 hook 或就地实现），细开关放选中 skill 标题旁
  - 段型包保持现状结构；`SkillDetailDialog` 不再由详情页触发（保留组件给常驻区/其他消费方，或若无消费方则内联渲染替代）
- [ ] `AbilityPackSidebar.tsx` 瘦身：移除 skill 细开关区，只剩能力总开关 + 配套工具组 + 挂载情况；宽度评估收窄（w-80 → w-72，以工具名不截行为准）
- [ ] `SystemBehaviorDetail.tsx` 三区重构：
  - 区一「会话组上下文」：group-context 段（只读渲染，字号标准档位，Markdown 渲染可留到 Step 4 但新代码直接写对）
  - 区二「主子会话协作」：sub-agent-contract 段 + 子会话固定协作组（group/delegation 子会话侧）说明 + 交叉引用一句（「主会话派遣规范与 Profile 索引归 Agent 协作能力包，受其开关控制」）
  - 区三「常驻工具」：基础工具 7 个（ask/allow 就地切换，即时保存 `client.updateSettings`，读 settings-store）+ dogear-history / dogear-tasks 组清单（点工具弹 ToolDetailDialog）+ 无工作区时标注「绑定工作区后可用」
  - `app/settings/page.tsx` 移除 `BasicToolsSection` 引用（基础 tab 留主题/浏览器配置）
- [ ] 浮窗闪烁修复（`SkillDetailDialog.tsx` / `ToolDetailDialog.tsx` 同法）：组件内 `const last = useRef/useState` 仅在 props 非空时更新；渲染用 last，open 用 `props != null`；SkillDetailDialog 用「content 对应 skill 名 !== 当前 skill 名」派生 loading，打开新 skill 不闪旧内容
- [ ] 验证：`bunx tsc --noEmit` + `bun run lint` + dev 人工核对（code-workflow 六 skill 切换、开关即时生效、浮窗开关无闪烁、常驻区权限切换即时保存并广播生效）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - SkillDetailDialog.tsx 删除而非修复：唯一消费方是详情页（skill 详情改就地渲染后无消费方），按计划「无消费方则内联渲染替代」清理；SKILL.md 加载逻辑抽为详情页内 useSkillContent hook，frontmatter 剥离正则随迁。浮窗闪烁修复仅剩 ToolDetailDialog。
  - BasicToolsSection.tsx 挪入 ability/ 目录并重写为无 props 组件：直接读 settings-store，ask/allow 切换即 client.updateSettings 保存（basicToolPermissions 属 snapshot 域，主会话标脏下轮重建生效，文案已注明）；保留全部放行/询问批量操作；原设置页表格风改为适配详情页的紧凑风。
  - AbilityTab 给 AbilityPackDetailPage 加 key={selectedPack.key}：切换包时重置内部 state（否则 selectedSkillName 残留到其他包）。
  - 首页系统行为卡描述文案与徽标同步更新为新语义（原文案「组上下文、子会话契约、Profile 索引」中 profile-index 已在 step 1 删除）；text-[10px] 存量字号未动（Step 4 范围）。
  - SegmentBlock 保持原样（含 text-[Npx] 存量），段型包结构零变化。
- 改动文件清单：
  - electron/main/tipc/ability.ts：新增 ResidentToolGroupMeta + RESIDENT_GROUP_IDS（['dogear-history','dogear-tasks']）；getAbilityPacks 返回值加 residentToolGroups；PACK_TOOL_MODULE_IMPORTS 加 task-tools.js（常驻区需要 dogear-tasks 工具明细）
  - app/settings/ability/AbilityPackDetailPage.tsx：skill 型包左侧重划——顶部 skill chips（选中态 primary 高亮、缺失标注徽标）+ 选中 skill 的 SKILL.md MarkdownRenderer 渲染全文（useSkillContent hook）+ 细开关移到选中标题行旁（含「包关闭时细开关禁用+预配置提示」）；段型包三段结构保持现状；移除 SkillDetailDialog
  - app/settings/ability/AbilityPackSidebar.tsx：移除 skill 细开关区与相关 props（isSkillEnabled/skillBusy/onToggleSkill/onSkillDetail），只剩能力总开关+配套工具组+挂载情况；宽度 w-80 → w-72
  - app/settings/ability/SystemBehaviorDetail.tsx：三区重构——区一「会话组上下文」（group-context 段 MarkdownRenderer + text-sm）；区二「主子会话协作」（sub-agent-contract 段 + 子会话固定注册 dogear-group/delegation 说明 + 交叉引用 agent-collab 包）；区三「常驻工具」（BasicToolsSection + residentToolGroups 组清单点工具弹 ToolDetailDialog，无工作区标注「绑定工作区后可用」）；props 增 residentToolGroups/workspaceId
  - app/settings/ability/BasicToolsSection.tsx（自 app/settings/ 挪入 + 重写）：读 settings-store + client.updateSettings 即时保存，无 props
  - app/settings/ToolDetailDialog.tsx：闪烁修复（lastTool 仅非空时更新，open 仍由 props 判定，关闭动画期间内容保留）
  - app/settings/SkillDetailDialog.tsx：删除（无消费方）
  - app/settings/page.tsx：移除 BasicToolsSection import 与使用（基础 tab 留主题/浏览器配置）
  - app/settings/AbilityTab.tsx：SystemBehaviorDetail 传 residentToolGroups/workspaceId；AbilityPackDetailPage 加 key；系统行为卡文案「框架固定行为总览：会话组上下文、主子会话协作、常驻工具，均不可关闭」+ 徽标「提示词段 N · 常驻工具」
- 验证：bunx tsc --noEmit 通过；bun run build:electron 通过；bun run lint 0 errors / 84 warnings（全部既有 any，比 step 2 少 3 个 = 删除的 SkillDetailDialog 自带 any）；新写文件零固定像素字号；dev 人工核对本环境无法执行跳过（skill chips 切换/细开关就地生效/浮窗无闪烁/权限即时保存待主会话冒烟确认）。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - getAbilityPacks 返回 { packs, systemBehaviors, residentToolGroups }；ResidentToolGroupMeta = { id, label, tools: ToolInfo[] }（id = server 名）
  - AbilityPackSidebar props 瘦身后：{ pack, packEnabled, disabled?, packBusy, onTogglePack, onToolDetail, configVersion }
  - SystemBehaviorDetail props：{ behaviors, residentToolGroups, workspaceId, onBack }
  - BasicToolsSection 无 props（读 useSettingsStore）；skill 详情加载：AbilityPackDetailPage 内 useSkillContent(name) → { content, error, loading }
- 下个 step 该从哪里继续：Step 4 存量清理——能力页残留 text-[10px]/text-[11px] 清单：AbilityMountsSection（8 处）、AbilityPackCard（3 处）、AbilityTab 系统行为卡徽标与两处 text-[10px]、AbilityPackDetailPage SegmentBlock（3 处）；SegmentBlock/SystemBehaviorDetail 段全文已是渲染态（后者 MarkdownRenderer 已完成，前者仍 pre，Step 4 统一换 MarkdownRenderer）。
- 待办或已知限制：
  - dev 人工核对未做（本环境无 GUI）：code-workflow 六 skill chips 切换、细开关就地切换后 enabledSkills 联动、浮窗开关无闪烁、常驻区权限切换即时保存并广播待冒烟
  - 权限快速连点存在理论竞态（read-modify-write 间隔小于 IPC 往返时可能覆盖），已用 useSettingsStore.getState() 取最新值缓解，未加队列（低频操作，不值得复杂度）
