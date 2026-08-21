# 右侧面板与左侧列表 UX 改进 设计

**背景**：三个体验问题——① 左侧列表话题/会话名过长截断后无法看全；② 右侧「附加」tab 卡片样式让文件显得局促；③ 共享区只展示共享文件，话题组的背景与组卡提炼无处速览，md 文件在面板内部小框里预览看不清。

**目标**：
1. 截断标题 hover 显示 tooltip 全名
2. 「附加」tab 改为手风琴分节样式（与文件树行样式一致，去掉卡片包裹）
3. 「共享区」tab 升级为「话题」面板：话题背景 + 组卡提炼 + 共享文件三段；所有 md 内容改用 MarkdownFileDialog 二级浮窗展示

**架构**：
- Tooltip 用原生 `title` 属性（与项目现有用法一致，零新依赖）
- 附加面板去掉 `rounded-md border + bg-muted/30` 卡片壳，文件夹行改为树行样式（chevron + Folder 图标 + 名称），Switch/删除在行尾，展开后文件树占满面板宽度；多文件夹可同时展开，默认收起
- 话题面板：组件 `SharedAreaPanel.tsx` 重命名为 `TopicPanel.tsx`；三个可折叠小节——
  - 「话题背景」：内嵌结构化渲染（主题/当前进展/已拍板决策/待议问题），数据走新增 IPC `readGroupBackground`（`background-store.ts` 已有读取函数，只差路由）
  - 「组卡提炼」：内嵌显示更新时间 + 摘要（line-clamp），点击整节打开二级浮窗；浮窗内容走新增 IPC `readGroupDigestRaw` 读 digest.md 原文（比前端从 card 重组 markdown 保真）
  - 「共享文件」：保持现有列表；点击 .md → `readSharedFile` 后 `markdownPreviewStore.openInline()` 开浮窗；删除面板内 max-h-64 小预览框
- tab 键：ui-store `rightPanelTab` 字面量 `'shared'` → `'topic'`（纯内存 state 无持久化，仅 page.tsx 消费），tab 文案「共享区」→「话题」

**模块边界**：
- 前端：`components/conversation-list/ConversationRow.tsx`、`components/group-list/GroupCard.tsx`、`components/AdditionalFilesPanel.tsx`（样式重写）、`components/SharedAreaPanel.tsx` → `TopicPanel.tsx`（重构）、`app/page.tsx`（接线+文案）、`stores/ui-store.ts`（字面量改名）
- 主进程：`electron/main/tipc/group.ts`（+readGroupBackground）、`electron/main/tipc/digest.ts`（+readGroupDigestRaw）、`electron/main/services/memory/group-digest-store.ts`（+readGroupDigestRaw 原文读取）

**数据流**：切话题（groupId 变化）→ TopicPanel 并行拉 `readGroupBackground` + `readGroupDigest`（摘要内嵌）+ `listSharedFiles`；点击组卡/共享 md → 拉原文 → `openInline` 浮窗渲染。

**错误处理**：背景/组卡不存在显示「暂无」空态（正常情况不是错误）；IPC 失败 toast；浮窗打开失败 toast 不阻塞。

**未决问题**：无。
