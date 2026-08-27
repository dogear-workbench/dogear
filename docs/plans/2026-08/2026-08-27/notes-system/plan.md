# 笔记系统实施计划

**目标**：按 `docs/plans/2026-08/2026-08-27/notes-system-design.md` 落地卡片笔记系统——`.dogear/notes/` 文件存储 + 主窗口哨兵 Tab + 首页捕捉框 + dogear-notes Agent 工具面 + 待办实施队列。

**架构思路**：数据层（一卡一 md + frontmatter + index.json 缓存，文件为真源）→ IPC CRUD → 前端骨架（只读）→ 编辑能力 → 视图完善 → 捕捉框换血 → Agent 工具面。每步独立可验证，数据层先行让后续所有步骤有真实地基。

**涉及模块**：`electron/main/services/notes/`、`electron/main/tipc/notes.ts`、`electron/main/agents/tools/notes-tools.ts`、`electron/main/agents/session-append-templates.ts`、`types/note.ts`、`stores/notes-store.ts`、`stores/session-store.ts`、`app/page.tsx`、`components/notes/`、`components/dashboard/`（速记板拆除）。

**设计文档**：`docs/plans/2026-08/2026-08-27/notes-system-design.md`（数据模型、工具清单、执行纪律以它为准，本计划只管怎么拆步骤落地）

## 步骤索引

- [x] [Step 1: 数据地基——类型 + 服务层 + IPC 路由](./step1-data-foundation.md) — notes-store/notes-service/index.json/软删除 + tipc CRUD，冒烟脚本验证
- [ ] [Step 2: 前端骨架——notes-store + NOTES_TAB_ID + 时间流只读](./step2-frontend-skeleton.md) — 哨兵 Tab、固定 Tab 区、卡片列表
- [ ] [Step 3: 卡片详情与编辑](./step3-note-editor.md) — MDXEditor 正文 + 元数据/待办编辑 + 新建
- [ ] [Step 4: 视图完善——待办聚合/标签/回收站/搜索](./step4-views.md) — 待办视图按 hasPlan 分组、软删除恢复、内存搜索
- [ ] [Step 5: 首页捕捉框 + 老速记板链路清理](./step5-capture-box.md) — 速记板替换为捕捉框，删除全部旧链路
- [ ] [Step 6: Agent 工具面 + 聊完存卡纪律](./step6-agent-tools.md) — dogear-notes server 七工具 + 提示模板 + 端到端验证

## 全局决策

1. **类型放 `types/note.ts`**（前后端共享，参照 `types/article.ts` 惯例）：`NoteMeta`、`TodoItem`（`status: 'pending' | 'in_progress' | 'done'`，可选 `plan`）、`links: string[]`（格式 `article:<id>` / `stock:<code>` / `plan:<path>`）
2. **frontmatter 解析**：先查 `electron/main/services/memory/memory-fs.ts` 是否有可复用的通用 frontmatter 读写；有就复用/抽出，没有则在 notes-store 内实现（不用新依赖）
3. **存储路径**：`<workspacePath>/.dogear/notes/`（拿法参照 `article-service.ts:49` 的 `ARTICLES_DIR` 模式）；文件名 `<YYYYMMDD-HHmmss>-<shortid8>.md`；shortid 用 crypto 随机 8 位 base36，同时作为 frontmatter `id`
4. **老链路删除时机**：`tipc/notes.ts` 的 getNotes/saveNotes 与 `ScratchpadSection`、`dashboard-store` 的 notes 字段在 Step 5 统一移除（提前删会让速记板立即报错）
5. **变更广播**：写操作后参照 `dashboard-watcher.ts` 的模式广播事件，前端 store 订阅刷新（多窗口/多 Tab 一致性）
6. **错误处理**：tipc 路由 try/catch 返回 `{error}`（照抄现有 `notes.ts:6-27` 骨架）；Agent 工具 zod 校验 + `isError: true` 不抛异常
7. **不写单测**；每步验证方式在 step 文档内写明（bun 冒烟脚本用完即删 / `bun run build:electron` / 应用内手测）
8. **主进程改动每步都要 `bun run build:electron` 后再手测**；提交前 `bun run lint`
