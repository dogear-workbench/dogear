# 体验优化四件套 实施计划

**目标**：落实 ux-refresh-design.md 四项——列表层级翻转、两套阅读主题、Edit 行级差分、dogear__ 成果卡片（含跳转）。

**架构思路**：纯前端为主（①③④），主题（⑤⑥）动全局 CSS 变量 + 设置链路（唯一涉及主进程的步骤）。Edit 差分零依赖自写（jsdiff 对中文失效，见设计文档③）；成果卡片复用 ToolBlock 既有路由/图标/previewAction 架构扩展，跳转动作统一在 ToolBlock 层产出（renderer 保持纯展示）。

**涉及模块**：`components/group-list/`、`components/agent-chat/tool-renderers/`、`components/ToolBlock.tsx`、`src/globals.css`、`types/settings.ts`、设置页基础 tab、主进程 nativeTheme（`electron/main/`）。

## 步骤索引

- [x] [Step 1: 列表层级翻转](./step1-list-hierarchy.md) — 话题标题升格主视觉，会话行不动
- [x] [Step 2: Edit 行级差分](./step2-edit-diff.md) — 零依赖 LCS 差分纯函数 + FileChangeRenderer 接入
- [x] [Step 3: 成果卡片渲染器](./step3-result-cards.md) — 四组 dogear__ 工具专属渲染 + 图标 + 摘要
- [ ] [Step 4: 卡片跳转动作](./step4-card-jump.md) — 笔记/任务/子会话三路深链
- [ ] [Step 5: 主题切换与变量重调](./step5-theme-toggle.md) — 暖纸亮/墨蓝暗变量 + 三态开关 + nativeTheme
- [ ] [Step 6: 硬编码色清理](./step6-hardcoded-colors.md) — 核心区域暗色适配

## 全局决策

- **顺序**：1→2→3→4→5→6。前四步相互独立可单独验收；5 依赖 2/3 已写完的样式（差分红绿底、卡片色需在暗色下成立），6 收尾全局。
- **不写注释**（项目规约）；样式沿用 Editorial 风格体系（lucide 简笔图标、细窄滚动条、燃烧橙主色）。
- **验证方式**：`bun run dev` 人工验收（项目无单测）；Step 5 涉及主进程改动需 `bun run build:electron`。
- **双态样式约定**：Step 2/3 新写的颜色一律同时写 `dark:` 变体（即使 Step 5 才改暗色变量，先双写不留债）。
- **接力纪律**：每步完成后回填 stepN.md「实施回填」+ 本索引打勾；下一步只读当前 step + 上一棒的「给下一步的接力棒」。
