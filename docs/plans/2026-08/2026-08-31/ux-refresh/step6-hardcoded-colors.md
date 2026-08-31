---
step: 6
title: 硬编码色清理（核心区域）
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
