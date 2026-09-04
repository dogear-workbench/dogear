# 文章 Tab 与导入入口重构 设计

**日期**：2026-09-04
**状态**：已拍板（与用户对齐）

## 背景

1. **文章预览回归 bug**：2026-08-11 commit `ff6a11a`（右栏改「文件/附加/共享区」三 tab）删掉了主窗口的文章预览分支且未接回。此后主窗口点击文章条目无任何展示（`ArticlePreview` 仅存在于独立会话窗口右侧栏），「选中语句引用到对话」（`components/ArticlePreview.tsx:83` SelectionTooltip）随之不可达。
2. **导入入口语义错位**：「导入文章」是工作区级动作（`parseArticle` 只接收 workspaceId），却放在会话工作台的顶栏，语义与位置不匹配。
3. **AI 兜底模型无专属配置**：管线第 4 层 AI 兜底用全局默认模型（`agent-worker.ts:217` `payload.modelSelection ?? appSettings.ai.defaultModelSelection`），无法单独指定便宜模型；digest/review/categorize 均有专属模型项，唯文章解析缺失。

## 目标

- 主窗口恢复文章阅读能力：文章做成**标签页**（与笔记/数据中心同模式的非会话 sentinel tab）
- 导入入口挪到文件树「文章」分组头部，顶栏 Globe 按钮移除
- 新增「文章解析模型」设置项（不配置时跟随全局默认模型）
- 修复后「选中语句引用到对话」「右键引用整篇」自动恢复可用

## 架构

### 1. 文章 Tab（sentinel tab 模式）

- 新增 sentinel id `ARTICLE_TAB_ID`，与 `NOTES_TAB_ID` / `DATA_CENTER_TAB_ID` 并列
- **挂载条件**：`selectedArticle !== null`（复用 article-store 现有状态，不新增 articleTabOpen；关闭 tab = `clearSelectedArticle()`）
- **tab 标题**：`selectedArticle.title` 截断显示
- **tab bar**：`WorkspaceTabBar` 增加条件渲染的文章 tab（有选中文章才显示，可关闭）
- **中间区域**：`app/page.tsx` 中间 tab 容器增加文章分支，渲染 `<ArticlePreview />`（按需挂载，切换 display 的现有模式）
- **打开时机**：
  - 文件树点击文章条目 → `selectArticle` + `setActiveTabId(ARTICLE_TAB_ID)`
  - 导入解析成功 → `submitArticleUrl` 成功路径已有 `selectArticle`，补 `setActiveTabId`
  - need_login 重试成功 → 同上（`retryAfterLogin` 路径）

### 2. 导入入口（文件树文章区）

- `WorkspaceExplorer` 文章 section-header 现有「+ 新建文件夹」按钮旁增加「导入文章」图标按钮（Globe）
- 点击 → 文章区头部下方展开**内联 URL 输入框**（复用 article-store 的 `showArticleUrlInput` / `setArticleUrlInput` / `submitArticleUrl`，交互对齐「新建文件夹」内联输入模式：Enter 提交 / Esc 取消）
- **空态引导**：文章分组无条目时显示「导入第一篇文章」引导按钮
- **顶栏移除**：`app/page.tsx` 的 Globe 按钮 + URL 输入框分支删除；`parsingArticle` 提交后立即收起输入框，进度靠文章条目状态（解析中/ai_parsing 渐进状态）与文章 tab 反馈

### 3. 文章解析模型设置项

- `settings-types.ts`：`ai.parseModelSelection: ModelSelection | null`（默认 null）
- 设置页 AI 区新增「文章解析模型」下拉，样式与 digest/review 一致；`clearIfMatch` 清理链同步
- `agent-worker.ts` `handleParseArticleTask`：`selection = payload.modelSelection ?? appSettings.ai.parseModelSelection ?? appSettings.ai.defaultModelSelection`

## 模块边界

| 文件 | 改动 |
|---|---|
| `stores/article-store.ts` | 保持现有 action；`selectArticle` 开头 workspace 为空时 console.warn（原静默 return） |
| `components/WorkspaceTabBar.tsx` | 文章 tab 条件渲染 + 关闭按钮 |
| `app/page.tsx` | 中间区域文章分支；顶栏 Globe 按钮与输入框移除 |
| `components/WorkspaceExplorer.tsx` | 文章 section-header 导入按钮、内联 URL 输入框、空态引导 |
| `components/ArticlePreview.tsx` | 不动（SelectionTooltip 引用功能随挂载恢复） |
| `electron/main/services/settings-types.ts` | `parseModelSelection` 字段 |
| `app/settings/page.tsx` | 「文章解析模型」下拉 |
| `electron/main/agents/agent-worker.ts` | 模型选择三级 fallback |

## 数据流

```
导入：文件树文章区输入框 → submitArticleUrl → parseArticle IPC
     → 成功 → loadWorkspaceFiles + selectArticle + 切到文章 tab
阅读：文件树条目点击 → selectArticle + 切 tab → ArticlePreview
引用：文章 tab 内选中文字 → SelectionTooltip → reference-store（现有逻辑不动）
AI 兜底：worker → parseModelSelection ?? defaultModelSelection
```

## 错误处理 / 边界

- need_login 文章在 tab 内展示锁状态 + 重试按钮（ArticlePreview 现有能力）
- 解析失败 stub（failed 状态）在 tab 内如实展示
- 文章被删除时 selectedArticle 已有清空逻辑，tab 随之消失
- `parseModelSelection` 指向的 profile/模型被删 → `clearIfMatch` 兜底回 null（跟随默认）
- 选中文章后用户切到会话 tab：文章 tab 保持挂载（display:none 模式），切回不重新加载

## 明确不做（记二期）

- 动作流面板（伴随面板「浏览器」tab）的归属重构——双源（工作区任务/Agent 工具）混合挂会话面板的语义问题
- 会话与浏览器的流式联动（贴 URL 自动入库回聊）
- 定时浏览器抓取（接 scheduler）
- 登录墙登录完成自动检测、toast 时序优化
- 导入重复 URL 去重

## 未决问题

- 文章 tab 与笔记 tab 的视觉排序（放笔记前还是后）——实施时按 tab bar 现有排布取自然位
