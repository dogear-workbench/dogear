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
- [x] [Step 3: playbook 归入 memory 全局主题](./step3-playbook-into-memory.md) — scope 路由 + 检索合并 + 注入源切换 + 存量迁移
- [x] [Step 4: 笔记完成态流转](./step4-notes-archive-flow.md) — 核实状态机后定做/降级（已核实，降级：任务已由 Task 系统承载，Note 为知识卡片）

## 全局决策

- 确认弹窗一律 `showConfirm()`（confirm-store），禁 window.confirm/prompt
- 主进程改动后必须 `bun run build:electron` 验证编译；工具改动保持 zod 校验 + `registerTools()` 元数据注册
- 批量清理阈值 N=30 天，固定值不做设置项（YAGNI）
- 迁移一律幂等：目标已存在则跳过，不重复执行
- 不写注释；单文件 >300 行考虑拆分

## 完成总结（2026-09-22）

四个 step 全部处理完毕，3 次 commit：

1. **step1**（6d09ec82）：SaveSharedNote 与 tipc writeSharedFile 统一过 `ensureDatedRelPath`，共享区文件名自动补 `YYYYMMDD-` 日期前缀（幂等不重补），工具描述与子会话契约模板同步告知，消除交付文件重名难辨识问题。
2. **step2**（544a38a3）：`batchDeleteArchivedTopics`（服务层 + RPC + store action + ArchivePage 头部清理按钮），复用 deleteTopic 全删语义逐组清理超 30 天归档话题，showConfirm 二次确认 + toast 汇总，刷新沿用 groups 引用变更通道。
3. **step3**（64dd5401）：memory 体系新增 global scope（config/memory/），SaveMemory/ForgetMemory 可选 scope、recall/list 合并全局索引；readBrowserPlaybook 改读全局主题 slug=browser-playbook（回退旧文件），启动时幂等迁移旧单文件为主题（.migrated 保留）；顺手修复 readIndex 空索引浅拷贝共享数组污染 bug。**真实环境迁移需应用启动一次后生效**。
4. **step4**：降级为不做（零代码改动）——回收站为纯删除语义，但任务类内容已由 Task 系统（TaskStatus 含 done、TaskPanel 已完成分区）承载，Note 实际定位是知识卡片，加 completedAt 属错对象；证据链见 step 文档与共享区 step4-delivery.md。

已知限制：step3 迁移要等下次应用启动；step1 的 claimOutputPath file_exists 检查对带前缀写入基本不命中（内存占用检查仍有效）；step2 批量清理为同步逐删，归档量大时耗时线性增长。
