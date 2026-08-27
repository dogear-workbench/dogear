# 笔记系统设计（速记 → 卡片笔记 + 待办实施队列）

**日期**：2026-08-27 · 状态：方案已拍板，待写实施计划

## 背景

现有「速记板」是首页右栏单个自由 Markdown 文件（config 根 `workspaces/<wsId>/notes.md`，`components/dashboard/ScratchpadSection.tsx`），无条目、无搜索、无标签、与文章/股票/Agent 零联动。用户需要「待办 + 思考 + 联动」的轻量记录系统，嫌 Obsidian 类工具功能过多且无法与 Dogear 联动。外部调研结论（Logseq/Joplin/思源/memos 对比）与草稿箱现状调研见会话组共享区 `draft-box-research.md`。

## 目标

1. 快速捕捉：待办、思考，摩擦最低（首页捕捉框 + 哨兵 Tab）
2. 联动：卡片可引用文章/股票（`links`），Agent 可读写笔记（基础 CRUD 工具面）
3. 待办实施队列：聊完的方案落盘 plan 后存卡，之后 agent 从待办里领取执行
4. 双链（`[[]]` + 反链面板）明确排除在一期外

## 架构

**借 memos/flomo 的形态（时间流卡片 + 标签）+ Obsidian 的开放文件格式（一卡一 md 文件）+ Dogear 独有的 Agent 工具面。**

- 存储：`<workspacePath>/.dogear/notes/`（与 articles/、memory/ 平级；笔记是工作区内容，引用文章、换机备份跟着走）
- UI：主窗口哨兵 Tab（`NOTES_TAB_ID`，紧挨 `HOME_TAB_ID`；固定 Tab 在前、动态会话 Tab 依次在后）+ 首页速记板降级为捕捉框
- Agent：新 MCP server `dogear-notes`，基础增删改查

**排除的选项及原因**：
- 外挂 Logseq/Joplin/memos：联动为零，割裂；且功能密度同样偏高
- 独立 BrowserWindow：多窗口 = 每窗口一个渲染进程（~80MB 进程税），跨窗口状态同步复杂（dashboard-watcher 那套）；Tab + display 切换架构现成（`app/page.tsx:283-300` 全挂载不卸载）
- 待办做独立任务实体/系统：变造 todoist；待办 = 卡片的结构化子实体，配聚合视图
- 正文 checkbox 与结构化待办双向同步：同步地狱，一份数据一个真相——待办只存在 frontmatter，正文 `- [ ]` 只是普通文本
- 双链：用户无既有习惯，一期不做

## 数据模型

一卡一文件：`.dogear/notes/<created_ts>-<shortid>.md`

```yaml
---
id: a3f2c1
created: 2026-08-27T19:30:00
updated: 2026-08-27T19:35:12
tags: [白酒, 估值]
links: [article:e7d1..., stock:600519, plan:docs/plans/.../plan.md]
todos:
  - id: t1
    text: 下周复核经销商库存
    status: pending          # pending | in_progress | done
  - id: t2
    text: 实施 WaitForMessage 校验
    status: pending
    plan: docs/plans/2026-08/2026-08-27/wait-for-message-validation/plan.md
---
（正文：自由 Markdown，不做结构约定）
```

- `links` 是结构化引用：`article:<id>` / `stock:<code>` / `plan:<path>`，跳转与反查靠它
- 待办是一等子实体：有 id（精确操作、幂等）、status、可选 plan；**「可实施待办」= 有 plan 字段**（数据判定，非文本理解）
- `index.json` 缓存全部 frontmatter：启动不逐文件解析；真源永远是 md 文件，`GetNote` 读文件，列表走索引，写入同步刷新，损坏全量重建
- 删除 = 软删除，移入 `.dogear/notes/.trash/`，笔记 Tab 内回收站入口

## 模块边界

| 层 | 位置（参照现有范式） |
|---|---|
| 主进程服务 | `electron/main/services/notes/`（notes-service + notes-store，参照 article-service「一目录一实体」与 memory「frontmatter + 索引」） |
| IPC | `electron/main/tipc/notes.ts` 改造（现有 getNotes/saveNotes 替换为 CRUD 路由，注册进 tipc/index.ts） |
| Agent 工具 | `electron/main/agents/tools/notes-tools.ts`，`registerToolGroup`（server: dogear-notes，zod 校验，错误返回 isError） |
| 前端 store | `stores/notes-store.ts` |
| UI | `app/page.tsx` 哨兵渲染区加 NotesPanel（display 切换）；`stores/session-store.ts` 加 `NOTES_TAB_ID`；`WorkspaceTabBar` 固定 Tab 区；`components/dashboard/` 速记板 → 捕捉框 |
| 提示模板 | `electron/main/agents/session-append-templates.ts` 加「聊完方案存卡」纪律 |

## Agent 工具面（一期基础 CRUD）

`dogear__CreateNote(content, tags?, links?, todos?)` · `dogear__GetNote(noteId)` · `dogear__SearchNotes(query|tag)` · `dogear__AppendNote(noteId, content)` · `dogear__UpdateNote(noteId, patch)`（改元数据/待办状态）· `dogear__DeleteNote(noteId)` · `dogear__ListTodos(status?, hasPlan?)`（跨卡片待办聚合，领任务入口）

**执行纪律（安全边界）**：agent 只自动执行带 plan 字段的待办（plan 是与用户讨论拍板的凭据）；普通待办只读不动。执行流程：ListTodos(hasPlan) → 按 staged-execution 纪律执行 → UpdateNote 勾选 + AppendNote 写结果摘要。语义化工具（领取锁定等协作原语）后置。

## UI 形态

- **笔记 Tab**：左侧视图栏（时间流默认 / 待办 / 按标签 / 回收站；后续视图在此扩展），右侧内容区。待办视图按 status、有无 plan、标签聚合渲染
- **首页捕捉框**：右栏原位，单行自动增高，回车成卡；提交时解析 `#标签`（一期无补全弹层）；下方最近 5 张卡缩略，点击切笔记 Tab
- **可弹出独立窗口**：复用 session-window 弹出机制，后置（真实双屏需求出现再做）；扩展窗口/面板系统是独立 backlog（见记忆 `extension-window-panel-system`），本期仅要求笔记面板组件写成可移植（数据走 store + IPC，不依赖主窗口特有上下文）

## 数据流（捕捉 → 卡片 → 执行）

1. 捕捉框/笔记 Tab/Agent 工具 → notes-service 校验 + 写 md 文件 + 刷 index.json → tipc 事件广播（参照 dashboard-watcher）→ store 更新 → UI
2. 聊完方案：落盘 plan.md → agent `CreateNote`（含 todos[].plan）→ 待办视图出现
3. 领取执行：用户说「把待办里能做的做了」→ `ListTodos(hasPlan)` → staged-execution 执行 → `UpdateNote` 置 done + `AppendNote` 结果摘要

## 错误处理 / 边界

- 索引与文件不一致：文件为真源，读详情必读文件；索引损坏全量重建
- 并发写：单机单人，文件级 last-write-wins，不加锁
- Agent 写入：zod 严格校验，错误 `isError: true` 不抛异常（项目规范）
- 迁移：不做。调研确认 `.dogear/workspaces/*/` 下无 notes.md 实文件，无数据可迁；老速记板链路（tipc getNotes/saveNotes、memory/notes-store.ts、ScratchpadSection）在实施中直接移除
- 搜索：一期内存全文搜索（frontmatter 索引 + 正文按需加载），千条级无压力，不引搜索引擎

## 未决问题（一期从简，实施时再看）

- 标签受控 vs 自由：一期自由标签
- 捕捉框 `#tag` 输入补全弹层：二期
- 待办「领取锁定」（防多 agent 重复领取）：一期用 status: in_progress 标记，不做强锁
- 回收站保留时长/自动清理：一期手动清空
- links 的 `session:<id>`（引用会话）要不要支持：待真实需求
