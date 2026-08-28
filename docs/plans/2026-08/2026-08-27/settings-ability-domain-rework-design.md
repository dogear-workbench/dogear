# 能力页按域分块重构 设计

**背景**：2026-08-27 双胶囊重构（8e5713e）删除了域卡片与域总开关，skill 与其关联工具包被拆到两个视图，工具包还带独立开关（与 skill 联动逻辑冲突），且 `max-w-3xl` 布局过窄、全屏两侧大量留白，整体不明了。

**目标**：
- 恢复域级「整体开关」，skill 与其工具包在同一域块内呈现
- 工具包不再有独立开关，挂载状态完全由 skill 联动驱动
- 布局自适应：默认 1000px 窗口到全屏 1920px+ 均饱满不挤不空
- 分层渐进披露：域块默认展开（skill 可见），工具包明细默认收起

**架构**：
- 单视图按能力域分块，废除「提示词+Skill / 工具组」双胶囊切换
- 域定义硬编码常量（`ability-types.ts` 的 `ABILITY_DOMAINS`）：股票分析、文章解析、代码工作流；templates 中未归类的落入兜底「通用 Skill」域；自定义 skill 独立域；常驻能力只读域
- 域块内左右分区：左 skill 控制层（定宽 ~300px），右工具浏览层（弹性）；窄于 md 断点堆叠
- 域内 skill 数 >1 才显示整体开关（避免与单 skill 开关重复）；整体开关 = 域内 skill 全开/全关，pack 联动逻辑复用现有 `handleToggleSkill` 规则，一次 `updateWorkspaceConfig` 批量提交
- 排除：不恢复旧版提示词段按 category 拆到记忆/协作域的做法，常驻信息统一收进常驻域块

**模块边界**：
- `app/settings/ability-types.ts`：新增 `ABILITY_DOMAINS`、兜底域工具函数
- `app/settings/AbilityDomainCard.tsx`（新）：可选域块组件（skill 栏 + 工具包折叠列表 + 整体开关 + 跳转定位高亮）
- `app/settings/AbilityResidentSection.tsx`（新）：常驻能力块（提示词段 + 常驻工具组，默认收起）
- `app/settings/AbilityTab.tsx`：重写渲染层，数据加载逻辑保留
- 删除 `AbilitySkillView.tsx`、`AbilityToolGroupView.tsx`
- 三个详情弹窗（Skill/Tool/Segment）保留不动

**数据流**：沿用现状——`getRegisteredTools`（工具明细，会话启动后才有）、`listToolPacks` + `getWorkspaceConfig`（按工作区）、`getSystemPromptSegments`、`listSkills`、`listSkillTemplates`；开关操作 → `updateWorkspaceConfig` → 响应合并回本地 state。

**响应式断点**：
- 容器 `w-full max-w-[1600px] mx-auto`
- 域块内 `md:grid-cols-[300px_1fr]`（约 1000px 窗口即左右分区）
- 小域块（文章/代码/自定义）`xl:grid-cols-2` 并排，股票块与常驻块全宽
- 无工具包的域（代码工作流）skill 走 `grid-cols-2 xl:grid-cols-3` 网格，不占右栏

**错误处理 / 边界情况**：
- 无工作区：可选域显示引导文案
- 工具明细缺失（会话未启动）：显示包级 fallbackCount + 提示
- 包徽标跳转：点击后切到对应域块并展开目标包 + 高亮 2s
- 未归类 template 兜底进通用域，不丢内容

**未决问题**：无（默认值已拍板：域块默认展开、工具包默认收起、常驻块默认收起）。
