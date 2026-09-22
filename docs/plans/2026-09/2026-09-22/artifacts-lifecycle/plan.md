# 沉淀物三层治理实施计划

**目标**：shared 工件命名规范化 + 归档话题批量清理入口；playbook 归入 memory 成为全局主题；笔记完成态流转（可降级）。

**架构思路**：三层分治（设计见 `../artifacts-lifecycle-design.md`）。删除机制复用现状语义（deleteTopic 全删）；playbook 归一走「全局 memory 主题」——memory-fs 增加 scope 路由，检索面合并全局 index，注入走既有 readBrowserPlaybook 接口换实现，pi-session 调用点零改动。排除了通用 inject 框架（当前只有 playbook 一个注入源，YAGNI）。

**涉及模块**：
- `electron/main/agents/tools/group-tools.ts`（SaveSharedNote）
- `electron/main/services/topic-lifecycle-service.ts` + `electron/main/tipc/group.ts` + `components/archive/`
- `electron/main/services/memory/`（memory-fs / memory-service / memory-recall / memory-types）
- `electron/main/services/browser/browser-playbook-service.ts` + `electron/main/agents/pi-session/pi-session.ts:52`
- `electron/main/services/notes/`（仅核实+轻改）

## 步骤索引

- [x] [Step 1: shared 命名规范化](./step1-shared-naming.md) — SaveSharedNote 写入自动补日期前缀
- [x] [Step 2: 归档话题批量清理入口](./step2-batch-cleanup-archived.md) — 归档视图一键清理超 N 天话题（全删语义）
- [ ] [Step 3: playbook 归入 memory 全局主题](./step3-playbook-into-memory.md) — scope 路由 + 检索合并 + 注入源切换 + 存量迁移
- [ ] [Step 4: 笔记完成态流转](./step4-notes-archive-flow.md) — 核实状态机后定做/降级

## 全局决策

- 确认弹窗一律 `showConfirm()`（confirm-store），禁 window.confirm/prompt
- 主进程改动后必须 `bun run build:electron` 验证编译；工具改动保持 zod 校验 + `registerTools()` 元数据注册
- 批量清理阈值 N=30 天，固定值不做设置项（YAGNI）
- 迁移一律幂等：目标已存在则跳过，不重复执行
- 不写注释；单文件 >300 行考虑拆分
