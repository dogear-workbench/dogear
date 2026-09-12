---
step: 3
title: 详情页布局重划与系统行为三区
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
