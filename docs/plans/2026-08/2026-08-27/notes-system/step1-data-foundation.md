---
step: 1
title: 数据地基——类型 + 服务层 + IPC 路由
status: done
---

## 目标

笔记系统的完整数据层：类型定义、文件 IO、CRUD 语义、index.json 缓存、软删除，以及暴露给渲染层的 tipc 路由。做完后用冒烟脚本验证全链路。

## 依赖上下文（接力棒输入）

- 无前置 step。设计定稿见 `docs/plans/2026-08/2026-08-27/notes-system-design.md`「数据模型」节
- 存储根：`<workspacePath>/.dogear/notes/`，workspacePath 的取法参照 `article-service.ts:49`（`ARTICLES_DIR = '.dogear/articles'` 相对工作区）
- 现有要替换的 IPC：`electron/main/tipc/notes.ts:6-27`（getNotes/saveNotes，**本步保留不删**，Step 5 统一清理），注册点 `tipc/index.ts:24,54`
- frontmatter 工具：先读 `electron/main/services/memory/memory-fs.ts`，有通用 frontmatter 解析就复用或抽公共；没有就在本步实现（零新依赖，手写 `---` 分隔 + 简单 yaml 子集解析即可，frontmatter 字段都是扁平标量/数组/对象数组）
- tipc 错误惯例：try/catch 返回 `{error}`，照抄现有 notes.ts 骨架

## 计划改动

- [x] `types/note.ts`：`TodoStatus`、`TodoItem`、`NoteMeta`（id/created/updated/tags/links/todos）、`Note`（meta + content）
- [x] `electron/main/services/notes/notes-store.ts`：纯 IO——readNoteFile/writeNoteFile/listNoteFiles/moveToTrash/restoreFromTrash/listTrash/rebuildIndex 的文件层原语
- [x] `electron/main/services/notes/notes-service.ts`：CRUD 语义
  - `create(workspacePath, {content, tags?, links?, todos?})`：生成 shortid8 + 时间戳文件名 + frontmatter，写文件，刷索引
  - `get(workspacePath, noteId)`：**永远读文件**（真源），同步刷新索引条目
  - `list(workspacePath)`：走 index.json；缺失/损坏时全量重建
  - `update(workspacePath, noteId, patch)`：patch 合并（tags/links/todos 深替换），updated 戳，写文件刷索引
  - `append(workspacePath, noteId, text)`：正文末尾追加
  - `remove(workspacePath, noteId)`：软删除移入 `.dogear/notes/.trash/`；`restore`；`purge`（彻底删）；`listTrash`
  - `search(workspacePath, {query?, tag?})`：索引过滤 tags/标题（frontmatter 无标题时取正文首行 ≤40 字），正文匹配按需读文件
  - `listTodos(workspacePath, {status?, hasPlan?})`：聚合所有卡 todos，返回 `{noteId, noteTitle, todo}[]`
- [x] `index.json` 结构：`{version: 1, items: NoteMeta[]}`（含文件名映射），写入走原子写（参照 `safe-json.ts` 惯例）
- [x] `electron/main/tipc/notes.ts`：新增 createNote/getNote/listNotes/updateNote/appendNote/deleteNote/restoreNote/purgeNote/listTrashNotes/searchNotes/listTodos 路由（与 service 一一对应），注册进 `tipc/index.ts`；**不动老 getNotes/saveNotes**
- [x] 写操作完成后参照 `dashboard-watcher.ts` 广播 notes-changed 事件（前端 Step 2 订阅）
- [x] 冒烟脚本：临时 `scripts/notes-smoke.ts`，用 bun 直接调 notes-service 跑 create→get→update→append→listTodos→search→remove→restore→purge 全链路断言，跑绿后**删除脚本**

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 主进程不能直接引根目录 types/（tsconfig.electron.json rootDir=./electron 限制），新增 `electron/main/services/notes/note-types.ts` 镜像类型；types/note.ts 保留为前端共享真源，两边互注同步（参照 article-service ↔ types/article.ts 既有惯例）
  2. frontmatter 未复用 memory-fs（其解析器只支持 string/string[]，不支持 todos 对象数组，且该文件不在本步清单内），在 notes-store 内自实现：标量/内联数组 + todos 块列表每行一个 JSON 对象（YAML 兼容子集）
  3. NoteMeta 增加 `file`（文件名映射，计划已要求）与 `title`（正文首行≤40 字）字段——search 按标题过滤、listTodos 返回 noteTitle 都要求索引里有标题，故写入时提取入库
  4. index.json 读取不回退 .bak：旧快照会引入已 purge 卡片的幽灵条目；主文件损坏直接返回空索引，由 listNotes 全量重建
  5. renderer-handlers.ts 加 `notesChanged` 事件类型（广播的必要配套，计划未列出但必须）
  6. 冒烟额外验证：非法 link 前缀抛错、restore 同名冲突抛错路径、todo id 缺省生成 t1 序号风格（显式 id 保留）、索引损坏重建
- 改动文件清单：
  - `types/note.ts`（新，前端真源）
  - `electron/main/services/notes/note-types.ts`（新，主进程镜像）
  - `electron/main/services/notes/notes-store.ts`（新，IO 原语 + frontmatter + 索引）
  - `electron/main/services/notes/notes-service.ts`（新，CRUD 语义 + notesChanged 广播）
  - `electron/main/tipc/notes.ts`（新增 11 路由，保留老 getNotes/saveNotes）
  - `electron/main/tipc/renderer-handlers.ts`（加 notesChanged 事件类型）
  - tipc/index.ts 未改（notesRouter 已注册，新增路由自动生效）
  - 冒烟 `scripts/notes-smoke.ts` 44 项断言全绿后已删

### 给下一步的接力棒
- 关键签名 / 数据结构、tipc 路由名清单、notes-changed payload：见共享区 `notes/step1-delivery.md`
- 下个 step 从哪里继续：`stores/notes-store.ts` 消费 client 路由（注意命名避开 electron 侧同名 store）+ 订阅 notesChanged 事件（payload 按 workspacePath 匹配工作区）
- 待办或已知限制：
  - searchNotes 返回 NoteMeta[]（无 snippet）；update 的 todos 为整体深替换，todo 级 patch 未做（agent 需先 get 再 update）
  - list 不校验索引条目对应文件是否存在（外部删文件会出现幽灵条目，get 详情时自然暴露）
  - 回收站保留时长/自动清理一期不做；restore 遇主目录同名文件抛错
