---
step: 6
title: 硬编码色清理（核心区域）
status: done
---

## 目标
核心界面在墨蓝暗下无刺眼亮块、文字可读：清理 agent-chat 工具块、状态徽章、消息区、列表的硬编码调色板类。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填，含 Step 5 最终生效的暗色变量）
- 当前关键文件状态：全项目 284 处硬编码调色板类（`grep -rEo '(text|bg|border)-(red|emerald|sky|amber|...)-[0-9]+' components/ app/` 可重新统计）；重点浅底类 `bg-amber-50`/`bg-sky-50`/`bg-teal-100` 等在暗色下为刺眼亮块
- 关键决策回顾：口径=核心区域一期必须清，边角（数据中心深处、设置页低频项）分批不阻塞；策略=成对补 `dark:` 变体为主（亮色保持现值），跨组件复用的语义色（成功/警告/错误/信息）可提升为 CSS 变量。Step 2/3 已双写的不欠债。

## 计划改动
- [ ] 核心区域清单逐一过（按目录）：
  - `components/ToolBlock.tsx`（TOOL_ICONS 各 text-*-600 暗色下校验，必要时 dark: 亮一档）
  - `components/agent-chat/`（StatusPulse、StreamingIndicator、MessageItem 徽章、AskUserQuestionCard、PermissionRequestCard、CitationBadge、path-link 胶囊）
  - `components/agent-chat/tool-renderers/`（ReadRenderer/GlobRenderer/GrepRenderer/SkillRenderer 的底色与高亮色）
  - `components/ConversationList.tsx` + `conversation-list/` + `group-list/`（状态点、徽章）
  - `components/notes/`（TaskPanel 状态徽章、TagFilterMenu）
- [ ] 每处判断：浅底（50/100）补暗色对（如 `dark:bg-amber-950/40`）；深字（700/800/900）补 `dark:text-*-300`；状态语义一致的跨组件色若 ≥3 处可升 CSS 变量（`--status-success` 等），否则就地双写
- [ ] 暗色全界面走查：主窗口（列表/对话/笔记/首页报告）+ 设置页 + 数据中心，标记剩余刺眼点；**边角遗留列入待办不阻塞本步完成**
- [ ] 回填时更新剩余硬编码色统计数，作为后续批次基线

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **范围收窄**：任务约束下 `components/notes/` 仅校验未改——TaskStatusBadge.tsx 已在 Step 2/3 双写（不欠债）；NotesPanel/TaskDetail/TaskPanel/TiptapEditor/TableToolbar 为其他任务未提交改动禁改，其状态徽章暗色适配列入遗留待办。
  2. **语义色未升 CSS 变量**：状态色（blue/orange/emerald 成功/警告/信息）跨组件 ≥3 处，符合升变量条件，但涉及 globals.css + @theme 映射 + 全量替换类名，改动面大风险高；本步统一采用「同型双写模式」（浅底 50/100→dark:*-950/40、深字 600/700/800→dark:*-300/400）保证视觉一致，升变量列入后续批次建议。
  3. **计划未列但同属核心目录、一并处理的**：ChatInputArea（35 处，引用胶囊+状态框 focusRing）、SlashCommandMenu（来源徽章）、AgentChat（子会话状态框/归档提示/failover 提示条）、CollapsedHistoryBanner/CollapseControlBar（gray 系折叠条）、highlight.ts（搜索高亮 bg-yellow-200 亮块）、ToolDetailShell（OutputBox 错误红底）、PermissionRequestCard、ContentBlockItem、TodoListBlock。
  4. **400/500 中色判定保留不改**：StatusPulse（blue/orange 400/500 脉冲点）、状态点 dot bg-*-500、UsageBadge 用量条、各处 500 色图标——墨蓝底（#1E242C）上可读性与区分度足够，非亮块风险。
  5. 暗色全界面走查以静态审查替代（对照 .dark 变量表逐一核对），人工走查列入遗留。
- 改动文件清单（17 文件，+68/-68 行，纯类名字符串双写）：
  components/ToolBlock.tsx、agent-chat/{AgentChat,MessageItem,ChatInputArea,SlashCommandMenu,ContentBlockItem,ToolGroupBlock,CollapsedHistoryBanner,CollapseControlBar,TodoListBlock,PermissionRequestCard,path-link,highlight}.tsx(.ts)、agent-chat/tool-renderers/{ToolDetailShell,GlobRenderer,GrepRenderer}.tsx、conversation-list/ConversationRow.tsx

### 给下一步的接力棒
- 关键签名 / 数据结构：无新增签名；纯样式改动。双写模式约定：浅底 `bg-x-50` ↔ `dark:bg-x-950/40`、边框 `border-x-200` ↔ `dark:border-x-800/60`、深字 `text-x-600/700/800` ↔ `dark:text-x-300/400`、hover 同步翻倍（`hover:bg-x-100` ↔ `dark:hover:bg-x-900/40`）。
- 下个 step 该从哪里继续：按 step7 计划继续；若后续批次继续清硬编码色，边角区域仅剽 16 处真孤儿（ArticlePreview 7、MarkdownRenderer 2、BasicToolsSection 2、debug 页 2、WorkspaceTabBar/TopicPanel/AdditionalFilesPanel 各 1）。
- 待办或已知限制：
  1. 禁改五文件（NotesPanel/TaskDetail/TaskPanel/TiptapEditor/TableToolbar）的状态徽章暗色适配未做。
  2. 边角 16 处孤儿类未清（列表见上）。
  3. 语义状态色升 CSS 变量（--status-*）未做，后续批次可评估。
  4. 剩余硬编码色基线（grep 总出现口径）：全项目 404（开工）→ 527（完工，+123 均为新补 dark: 配对变体，双写策略下总数上升是预期）；无 dark: 配对的孤儿类全项目仅剽 16 处。
  5. 暗色人工走查未做（静态审查替代）。
