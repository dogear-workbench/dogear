# 设置页布局对齐 + 能力 tab 重构 + 工作区 skill 配置修复 实施计划

**目标**：设置页改数据中心式顶部 tab + 居中布局；能力 tab 重构为「提示词 + Skill」/「工具组」双胶囊视图，skill 开关主控联动工具包；修复设置窗口 workspaceId=null bug；自定义 skill 全局化 + 清理死链路。

**架构思路**：数据层先行（skill 目录全局化、article-parser 运行时搬家、删 cross-session-review），再做设置页布局骨架，最后重构能力 tab 与修 SubAgentTab。设计详见 [design.md](./design.md)。

**涉及模块**：`app/settings/page.tsx`、`app/settings/AbilityTab.tsx`（重构拆分）、`app/settings/AbilityCard.tsx`（删）、`app/settings/SubAgentTab.tsx`、`electron/main/services/skill-service.ts`、`electron/main/agents/pi-session/pi-session.ts`、`electron/main/services/article-parser-skills-service.ts`、`electron/main/agents/pi-session/skill-loader.ts`、`resources/skill-templates/cross-session-review/`（删）。

## 步骤索引

- [x] [Step 1: 主进程数据层——skill 目录全局化 + 死链路清理](./step1-skill-paths.md) — custom skill 目录改 `.dogear/skills/`，article-parser 运行时搬家，删 cross-session-review
- [x] [Step 2: 设置页布局改造](./step2-layout.md) — 左侧竖排导航改顶部下划线 tab，各 tab 内容居中
- [x] [Step 3: 能力 tab 重构](./step3-ability-tab.md) — 双胶囊视图 + 工作区 Select + 联动开关 + 跳转定位
- [x] [Step 4: SubAgentTab 修复 + 收尾](./step4-subagent-cleanup.md) — 子会话派遣 workspaceId 本地初始化 + lint + doc-sync

## 全局决策

- **skill → 工具包映射**（Step 3 用，前端常量 `SKILL_PACK_MAP`）：

  ```ts
  const SKILL_PACK_MAP: Record<string, string[]> = {
    'stock-analysis': ['stock-quote', 'stock-analysis', 'stock-announcement'],
    'stock-picking': ['stock-picking'],
    'article-parser': ['article'],
    // brainstorming / codebase-map / doc-sync / staged-execution / staged-impl /
    // systematic-debugging：无关联包（复用基础工具），不进映射表
  };
  ```

- **开关联动**：开 skill → `enabledSkills ∪= {name}` 且 `enabledToolPacks ∪= 关联包`；关 skill → `enabledSkills -= {name}` 且 `enabledToolPacks -= (关联包 − 其他已启用 skill 的关联包并集)`。工具组视图的包开关只写 `enabledToolPacks`。
- **workspaceId 获取**：能力 / 子会话派遣 tab 用本地 state（`client.getAll()` + `client.getDefault()`，默认选中 default，null 时选第一个），不依赖 workspace-store（设置窗口无初始化链路）。
- **文件拆分**：AbilityTab 重构后拆 `app/settings/AbilitySkillView.tsx`（视图 A）+ `app/settings/AbilityToolGroupView.tsx`（视图 B），`AbilityTab.tsx` 只做编排（状态 + 数据加载 + Dialog）。单文件超 300 行即拆。
- **胶囊样式**：自绘 segmented（参考 page.tsx 里 effort 选择器：`inline-flex rounded-full bg-muted p-1` + 圆角按钮 active `bg-background shadow-sm`），不引新组件库。
- **跳转高亮**：`highlightServer` state，目标组容器加 `ring-2 ring-primary` 类，`scrollIntoView({ behavior: 'smooth' })`，2s 后 setTimeout 清除。
- **custom skill 全局目录**：`getConfigDir()/skills`（即 `.dogear/skills/`）；article-parser 运行时迁往 `.dogear/article-parser/`；`.dogear/skills/review/` 死遗留删除。
- **验证方式**：主进程改动后 `bun run build:electron`；前端改动跑 `bun run dev` 开设置窗口人工验证；每步结束跑 `bun run lint`。

## 完成总结

2026-08-27 四步全部完成：

- **Step 1**（`755ac9d`）：custom skill 目录全局化到 `.dogear/skills/`；article-parser 运行时迁往 `.dogear/article-parser/`（带存在性回退 + 一次性迁移）；删 cross-session-review 模板/特判及 review/stock-analysis 死遗留。
- **Step 2**（`5344e44`）：设置页左侧竖排导航改顶部下划线 tab，各 tab 内容 mx-auto 居中，纯样式无逻辑改动。
- **Step 3**（`8e5713e`）：能力 tab 重构为双胶囊视图（提示词+Skill / 工具组），拆出 AbilitySkillView / AbilityToolGroupView / ability-types；skill 开关联动 enabledSkills + enabledToolPacks（共享包保留）；工具组徽标跳转定位高亮；删 AbilityCard 与旧域常量。
- **Step 4**：SubAgentTab workspaceId 改挂载时本地解析（修设置窗口自定义 skill 列表拿不到的 bug）；doc-sync 同步 codebase-map。

遗留事项：
- 无 GUI 环境未人工冒烟，建议开发者跑 `bun run dev` 过一遍：设置页六 tab 切换、能力页开关读写与跳转高亮、Profile 编辑器 skill 列表。
- `review-skill-service.ts` 整文件 no-op + `index.ts:484` 启动调用待后续单独小步连删。
- WorkspaceManagementTab 的 currentWorkspace 在设置窗口恒 null 小瑕疵，待后续处理。
