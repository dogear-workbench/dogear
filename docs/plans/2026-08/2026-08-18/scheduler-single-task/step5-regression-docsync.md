---
step: 5
title: 回归走查与文档同步
status: done
---

## 目标

完整走查改造后的定时计划功能，确认迁移/常驻/去链式/工具 override 全部符合设计，同步 `docs/codebase-map.md`，收尾。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1]–[step4] 全部完成（见各 step 实施回填的实际改动与已知限制）
- 走查前提：`bun run build:electron` + `bun run dev` 均可正常启动
- 关键决策回顾：历史文件不迁移（旧条目靠 planName 展示）；内置提示词是全局模板；工具 override 完全替代工作区包选择

## 计划改动

### 1. 迁移走查（用真实旧数据或手工构造 plans.json 旧格式）

- [ ] 旧「夜间维护」（2 任务）→ 拆 2 条，名称「夜间维护·组卡提炼」/「夜间维护·复盘报告」，触发器各带 3 个，链式触发器若手工注入旧数据应被过滤
- [ ] 多任务自定义计划同样拆条；空计划丢弃；迁移后 plans.json 有 `version: 2`
- [ ] 二次启动不再重复迁移/seed（幂等）

### 2. 内置任务走查

- [ ] 列表固定 4 条内置任务（categorize 两条默认停用无触发器）；无删除按钮；deleteTask IPC 直接调 builtin id 返回错误
- [ ] 编辑器可改提示词并落盘（检查 `<configDir>/group-digest-prompt.md` 内容变化）；恢复默认生效；工具清单展示
- [ ] 立即运行组卡提炼，行为与改造前等价（管线正常触发、历史正常记录）

### 3. 链式与队列残留检查

- [ ] grep 全库 `on_plan_done` / `pendingTasks` / `PlanEditor` / `TaskListEditor` 应无残留引用（文档与 dist 除外）
- [ ] 触发器编辑器无「链式」选项

### 4. 工具 override 走查

- [ ] 自定义任务初始显示「跟随工作区」且开关态 = 工作区当前包；拨动保存后任务条目 `toolPacksOverride` 落库；重置清掉
- [ ] （日志级验证）带 override 的任务运行时 worker 组装工具集用了 override 值——若日志不可观测，在 `buildCustomToolSet` 临时打点确认后移除

### 5. 边界

- [ ] 内置任务停用开关、窗口触发器、错过记录（missed）行为不变
- [ ] 执行历史侧滑：旧历史条目仍可读、筛选下拉只列现存任务

### 6. 文档同步

- [ ] 按 doc-sync skill 更新 `docs/codebase-map.md`（scheduler 相关条目：新文件 builtin-task-meta.ts / TaskEditor.tsx，删除 PlanEditor/TaskListEditor，路由改名）
- [ ] 在 `plan.md` 补「## 完成总结」（实际改动汇总、与原计划偏差）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① 子块 1 预期名称「夜间维护·组卡提炼」与实现不符——builtin 迁移取固定 label 是 step1 已定不变量（validate 强制 name === label），文档预期系规划笔误非 bug，验收认可按实际行为验证；② 迁移验证走 dist 编译产物 + DOGEAR_CONFIG_DIR 环境变量重定向（比提取逻辑到临时脚本更可信）；③ 子块 2「立即运行等价」/子块 4「override 运行时生效」/子块 5 边界行为为 GUI 级，无 GUI 会话无法验证，整理 12 条人工清单移交；④ 代码零改动——走查未发现问题
- 改动文件清单：docs/codebase-map.md（8 处 scheduler 条目同步，未触碰 sidebar 遗留段落）、docs/plans/.../plan.md（末尾完成总结）

### 给下一步的接力棒
- 关键签名 / 数据结构：无代码改动；IPC 全集 10 路由与数据格式见 step2/step3 交付文档
- 下个 step 该从哪里继续：无后续 step，计划完结。GUI 交互级验证 12 条清单见共享区 step5-delivery.md「C 层」，待人工走查
- 待办或已知限制：doGEAR_CONFIG_DIR 环境变量可重定向 config 目录（本次验证发现的机制）；lint 74 warnings / tsc 15 errors 均为未触碰文件历史基线；详细验证结果见共享区 step5-delivery.md
