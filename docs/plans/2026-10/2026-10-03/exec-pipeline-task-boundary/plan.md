# 执行管道对称化与任务边界重构 实施计划

**目标**：执行会话管道完全由任务类型查表决定（default=基础版零 skill，code-impl=staged-execution）；任务只收完全体（planPath 必传，占位任务机制删除）；笔记承载生命周期（未定型方案/待办/待议走笔记状态标签）；任务类型支持手动改口；笔记栏折叠分组默认展开。

**架构思路**：skillsOverride 从「code-impl 专属保证」对称化为「执行会话恒传查表清单」（default 传空数组 = 基础版，与工作区/场景配置彻底解耦）；占位任务机制整体删除（CreateTask upsert、占位文案、升格断点随之消失），未定型内容由笔记状态标签承接；手动改口走 store 新方法 + tipc 路由 + 面板徽章交互。

**涉及模块**：`electron/main/services/task-queue.ts`、`electron/main/agents/pi-session/pi-session.ts`（注释）、`electron/main/tipc/ability-scene.ts`（场景页文案）、`electron/main/agents/tools/task-tools.ts`、`electron/main/services/task-store.ts`、`electron/main/agents/session-append-templates.ts`、`electron/main/tipc/tasks.ts`、任务面板前端（TaskPanel/TaskDetail/TaskStatusBadge）、`components/notes/NotesTimelinePane.tsx`

## 步骤索引

- [x] [Step 1: 执行管道对称化](./step1-pipeline-symmetry.md) — EXEC_PROFILE_SKILLS 查表，default 传空清单，场景页文案同步
- [x] [Step 2: CreateTask 完全体化](./step2-no-placeholder.md) — planPath 必传、upsert/占位文案删除、同标题拒绝
- [x] [Step 3: 笔记生命周期纪律](./step3-notes-lifecycle.md) — 提示词模板改写（未定型进笔记状态标签）
- [x] [Step 4: 类型手动改口 + 笔记折叠展开](./step4-manual-profile-and-ui.md) — store/tipc/面板切换入口；NotesTimelinePane 默认展开

## 全局决策

- **查表装配**：`EXEC_PROFILE_SKILLS: Record<ExecProfile, readonly string[]> = { 'code-impl': ['staged-execution'], default: [] }`；task-queue attach 恒传 `skillsOverride: EXEC_PROFILE_SKILLS[task.execProfile ?? 'default']`。空数组在 pi-session 装配层天然成立（`config.skillsOverride` truthy → 空 Set → 全不挂）。`undefined`（跟随工作区）语义保留，仅非执行场景使用
- **提示词挂载行**：`mountedSkills` 仍按非空才加行（default 空清单自然无行，零改动）
- **planPath 必传**：CreateTask zod 去 optional；task-store `CreateTaskInput.planPath` 类型收紧；同标题 plan 态任务存在时**拒绝创建**（报错提示已存在，不再 upsert 补路径）
- **笔记状态标签**：待办 / 待议 / 已转入计划（示例集不穷举，agent 可按语义扩展，如 需求意向/调研）；纪律要点是「未定型进笔记、完全体进任务」
- **存量占位任务不自动迁移**：当前有 2 个（mfdelhd2 提交确认 UI 改造、hvszlply click 误报核查），新机制上线后无 planPath 任务无法入队执行，交付时提醒用户处置（补文档或转笔记），不代做决定
- **折叠默认展开不持久化**：保持组件内 useState，仅改默认值
- 每步独立 commit；主进程改动需 `build:electron`，前端改动 `build:renderer`

## 完成总结

全部 4 步完成（2026-10-03）：

- **Step 1（b00df0be）**：EXEC_PROFILE_SKILLS 查表恒传，default 基础版零 skill，与工作区/场景配置解耦；场景页文案与 JSDoc 同步
- **Step 2（b233888d）**：CreateTask 只收完全体（planPath 双层收紧必传），占位机制全删，同标题 plan 态拒绝；存量 2 个无 planPath 任务不迁移待用户处置
- **Step 3（be7d091b）**：笔记定位为生命周期池（未定型方案/待办/待议/调研底稿 + 状态标签流转），动线与完全体语义对齐
- **Step 4（cf953ad4）**：updateTaskExecProfile 全链路（store 校验 plan/backlog → service 广播 → tipc → 前端 store）；详情页徽章点击循环切换；笔记折叠组默认展开

验证：每步 build:electron 通过，Step 4 另过 build:renderer；全量 bun test 492 通过（46 文件）。目验（改口徽章交互、笔记栏默认展开）需 Electron 窗口，留用户冒烟。
