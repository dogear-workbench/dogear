---
step: 3
title: 能力 tab 重构
status: pending
---

## 目标

AbilityTab 重构为：顶部工作区 Select + 「提示词 + Skill」/「工具组」双胶囊视图；skill 开关主控联动工具包；工具组徽标跳转定位；删除域卡片与域总开关。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - [step1] skill-service custom 目录已全局化，`client.listSkills({ workspaceId })` 签名不变；cross-session-review 模板已删（`listSkillTemplates()` 不再返回它）
  - [step2] AbilityTab 外层容器已是 `max-w-3xl mx-auto py-6 px-6`
- 当前关键文件状态：
  - `app/settings/AbilityTab.tsx`（将被重构）— 现有可用资产：`ToolInfo/ToolGroup/ToolPack/SkillEntry/SkillTemplate` 类型、`SegmentList`（提示词段子组件）、`SkillRow`（skill 行）、三个 Dialog（`SkillDetailDialog` / `ToolDetailDialog` / `SegmentDetailDialog`）；将废弃：`AbilityCard` 引用、`PackGroupList` / `ToolGroupList`（重构进视图 B）、`DomainToggle`、域常量（`MEMORY_SERVERS` 等部分保留改用）
  - 数据接口（均为现有 IPC）：`client.getAll()`、`client.getDefault()`、`client.getRegisteredTools()`（ToolGroup[]，活跃会话才有）、`client.listToolPacks({ workspaceId })`（ToolPack[]，含 mcpServer/toolCount/enabled）、`client.listSkillTemplates()`（{templates:[{name,description}]}）、`client.listSkills({ workspaceId })`（{skills:[SkillEntry]}，source: builtin|custom|user）、`client.getSystemPromptSegments()`、`client.getWorkspaceConfig({ workspaceId })`、`client.updateWorkspaceConfig({ workspaceId, config })`
  - 常驻工具组 server 名：`dogear-memory`、`dogear-delegation`、`dogear-group`、`dogear-reference`（`getRegisteredTools` 返回的 server 字段）
- 关键决策回顾（plan.md 全局决策）：SKILL_PACK_MAP 映射、开关联动规则、workspaceId 本地 state、文件拆分成 AbilitySkillView / AbilityToolGroupView、胶囊自绘样式、highlightServer 跳转高亮。

## 计划改动

- [ ] 新建 `app/settings/AbilitySkillView.tsx`（视图 A「提示词 + Skill」）
  - 三段：`内置 · 全局生效`（SegmentList 渲染 4 段提示词，标题旁标注「动态注入」）→ `可选 Skill · 按工作区挂载`（listSkillTemplates 全部，即股票×2 / 文章×1 / 代码工作流×6）→ `自定义 Skill · 按工作区挂载`（listSkills 里 source==='custom'，排除与模板重名的）
  - skill 行（改造 SkillRow）：名称 + 描述 + 来源徽标（可选/自定义）+ 挂载开关 + 关联工具组徽标（`SKILL_PACK_MAP[name]` 查 packs 得 mcpServer + label，`groupByServer` 得工具数；无映射不显示）+ 详情按钮
  - 工具组徽标为 button：显示 `label ×N` + 该包 enabled 状态色（未启用用警示色），点击回调 `onJumpToGroup(mcpServer)`
- [ ] 新建 `app/settings/AbilityToolGroupView.tsx`（视图 B「工具组」）
  - 上段 `常驻 · 全局`：四个常驻 server（固定列表常量：server + label + 注入条件描述——memory「主会话且绑定工作区」、delegation/group「会话属于组」、reference 按现状）无开关，组行点击展开工具列表（getRegisteredTools 数据），工具行点击开 ToolDetailDialog；无注册数据时显示「会话启动后才有工具明细」
  - 下段 `可选 · 按工作区挂载`：listToolPacks 的 5 个包，每包独立开关（只写 enabledToolPacks）+ 组行展开工具列表
  - 组容器加 `data-server` 属性 + 接收 `highlightServer` prop，命中时 `ring-2 ring-primary` + `rounded-md`，配合 `scrollIntoView`
- [ ] 重写 `app/settings/AbilityTab.tsx`（编排层）
  - 状态：`workspaces` / `workspaceId`（getAll + getDefault 初始化，default 为 null 选第一个；无工作区 workspaceId=null）、`view: 'prompt' | 'tools'`（默认 'prompt'）、`highlightServer`（string|null）、数据六件套（toolGroups / packs / segments / templates / skills / workspaceConfig）+ busy
  - 加载：workspaceId 变化 → 重拉 packs / skills / config；segments / templates / toolGroups 与工作区无关只拉一次
  - 联动开关（skill 行）：按全局决策规则计算下一组 `{enabledSkills, enabledToolPacks}` → `updateWorkspaceConfig` → 用返回 config 更新 workspaceConfig state（packs 的 enabled 标注同步刷新——重拉 packs 或本地合并均可）
  - 包独立开关（视图 B）：只改 enabledToolPacks
  - 跳转：`onJumpToGroup(server)` → `setView('tools')` + `setHighlightServer(server)`，视图 B 渲染后 `requestAnimationFrame` 内 `scrollIntoView`，2s 后清 highlight
  - 零工作区：视图 A 可选/自定义段显示「请先在工作区管理创建工作区」、开关禁用；提示词段与视图 B 常驻段正常
  - 顶部：标题说明 + 工作区 Select（shadcn Select，参考 data-center 面板用法）+ 胶囊 segmented
- [ ] 删除 `app/settings/AbilityCard.tsx`
- [ ] 清理 `AbilityTab` 旧域常量：`MEMORY_SKILL_NAMES` / `DELEGATION_CATEGORIES` / `STOCK_PACK_NAMES` / `STOCK_SKILL_NAMES` / `ARTICLE_PACK_NAMES` / `ARTICLE_SKILL_NAMES` / `CODE_WORKFLOW_TEMPLATES` / 域开关 useMemo（stockDomainOn 等）全部废弃；常驻 server 列表保留为新常量

## 验证

- `bun run dev` 打开设置窗口 → 能力 tab：
  - 工作区 Select 默认选中默认工作区；切换后开关状态跟随该工作区 config（对照生产 config：挂 stock-analysis 的工作区该 skill 显示已挂载）
  - 开 stock-analysis skill → config.json 里 enabledSkills 有它且 enabledToolPacks 含 stock-quote/stock-analysis/stock-announcement；关掉后包一并移除
  - 代码工作流 skill 开关不写 enabledToolPacks
  - 点 skill 行的「股票分析 ×7」徽标 → 切到工具组视图、滚动到 dogear-stock-analysis 组并高亮
  - 提示词段 4 条可开详情；工具组视图常驻组无开关、可选包有开关
  - 零工作区场景（可临时改本地代码模拟）不崩溃
- `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
