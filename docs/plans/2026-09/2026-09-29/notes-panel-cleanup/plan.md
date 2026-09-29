# 笔记面板整理：列表分组归档 + 引用可读化 + .bak 治理

> 2026-09-29 与用户对齐的方案。前置：删除无反应 bug 已单独修复（c516df61）。

## 背景与用户拍板

用户反馈笔记面板乱、没用起来。数据侧确认：

- 21 张存量卡全部无 `source` 字段（来源机制上线前创建），用户确认**历史卡都当自己写的，后面再分**——即现有判定逻辑（无 source = 手记）无需改动
- `source?: NoteSource` 机制现成：agent 存卡自动写入、用户手记不写
- 列表搜索/标签过滤结果未统一排序（服务端按 updated，主列表前端按 created）
- links 引用（`article:<id>` / `stock:<code>` / `plan:<path>`）原样展示 ID 和路径，用户看不懂——本次主诉之一
- notes 目录堆积 20+ 个孤儿 `.bak`：`safeFileWrite` 每次写生成滚动单代 .bak（不堆积），堆积根因是 `removeNote` rename 走 .md 后 **.bak 留在原目录**

用户拍板：agent 转存区默认折叠；7 天按**最近编辑（updated）**算；.bak 清理；**links 引用 UI 整体下线**，agent 引用改在正文写完整路径并渲染为可点链接。

## 改动清单

### A. 列表三段式分组 — `components/notes/NotesTimelinePane.tsx`

非搜索模式下，时间流改为三段（各自内部 created 倒序）：

1. **我的手记**（无 `source` 且 updated ≤7 天）— 平铺，默认视图主体
2. **Agent 转存**（有 `source`，不分 7 天）— **默认折叠**，段头显示条数，点击展开；区内卡片 meta 行显示来源会话名（`note.source.title`）
3. **更早的手记**（无 `source` 且 updated >7 天）— **默认折叠**，段头显示条数

- 7 天阈值：`Date.now() - new Date(note.updated).getTime() <= 7*24h`
- 折叠状态：组件 `useState`，不持久化（刷新回默认折叠）
- **搜索/标签过滤模式：三段合并平铺，统一 created 倒序**（搜索场景不该被折叠挡住）
- 段头样式参考 `TrashView.SectionHeader`（sticky 分组头 + 条数）

### B. 引用改为正文路径可点（frontmatter links UI 下线）

> 2026-09-29 用户改向：links 这套「article:<id>」黑话 UI 不要了；agent 引用统一在正文写完整路径，渲染成可点链接。

**下线 links 功能**：

- `NoteMetaSection.tsx`：删除 links 行 UI（LINK_PREFIXES、下拉+输入框+徽章、addLink/removeLink），只留 tags 行
- `notes-tools.ts`：CreateNote / UpdateNote schema 删 `links` 参数；工具描述补「引用 plan/文章/文件时，在正文写完整相对路径（如 `docs/plans/.../plan.md`），笔记内自动渲染为可点击」
- 数据层（frontmatter links 字段、service normalizeLinks）保留不动：存量 0 张卡有 links，无迁移需求，纯下线写入/展示入口

**正文路径可点（TiptapEditor）**：

- 自定义 ProseMirror 插件：识别文本节点中的「多段相对路径且末段带扩展名」（如 `docs/plans/2026-09/xx/plan.md`），排除 http(s):// 与纯数字日期段，加 Decoration class（primary 色+下划线，观感可点）——不改文档内容，保存的 md 保持原样
- 启用 `@tiptap/extension-link`（依赖已装）：标准 `[标题](相对路径)` md 链接也能识别；点击 handler 分流
- 点击行为（editorProps handleClick + workspaceId prop 从 NoteEditor 传入）：
  - `.md` 结尾 → `markdownPreviewStore.open(workspaceId, 相对路径, 文件名)` 应用内预览
  - 其他后缀 → `client.openFileInFolder`（工作区根拼绝对路径）

### C. .bak 治理 — `electron/main/services/notes/notes-service.ts` + 一次性清理

1. **根因**：`removeNote` 在 rename .md 到 trash 后，删除原目录同名 `.md.bak`（一行，防再堆）
2. **一次性清理**：删除 notes 与 trash 目录下所有 `*.bak`（执行时前后计数留证）

## 验证

- `bunx tsc --noEmit -p tsconfig.json` + `bunx tsc --noEmit -p tsconfig.electron.json` 无新增错误
- lint 无新增告警
- 构建后手测：分组三段渲染、折叠/展开、搜索合并平铺、links 可读显示与选择器添加、删除一张卡后 notes 目录不再残留 .bak

## 决策记录

- **不分步骤**：A/B/C 三块互相独立、均为 UI 层或单行 service 改动、单会话可完成，无依赖链
- 归档做成**视图分组**而非数据状态（不加 frontmatter 字段、不加 IPC）——最轻实现，规则变化时零迁移成本
- 跳转（点引用徽章打开文章/plan）随 links UI 下线一并作废，由正文路径可点替代
- links 数据层字段保留但入口全下线（工具参数 + UI）：存量 0 张卡有 links，无迁移成本；未来若需要可重启
