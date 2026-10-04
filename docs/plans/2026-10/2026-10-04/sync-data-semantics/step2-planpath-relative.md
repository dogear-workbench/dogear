---
step: 2
title: task-store planPath 相对化
status: done
---

## 目标
tasks.json 的 planPath 从绝对路径改为工作区相对路径存储（version 2→3 迁移），读写两侧 resolve，为跨设备同步扫清路径不可移植问题。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.4
- 现状：`task-store.ts` `TasksFile.version = 2`；planPath 存绝对路径（如 `C:\dogear\docs\plans\...`）；`ensureMigrated` 已有 1→2 迁移先例（migrations Map + withFileLock）；读侧 `getTaskDetail` 直接按 planPath 读文件
- 本步独立于同步协议，本端即可验证

## 计划改动
- [x] `electron/main/services/task-store.ts`：`TasksFile.version = 3`；`ensureMigrated` 加 2→3：`path.relative(workspacePath, planPath)` 转相对，结果以 `..` 开头（工作区外）或转换失败的条目保持绝对不动；写侧（createTask / 状态变更回写）统一存相对路径（入参可能传绝对，store 层归一化）
- [x] 读侧：`getTaskDetail` 等按 `path.isAbsolute` 分支——相对时 `path.join(workspacePath, planPath)`，绝对时原样（兼容未迁移成功的历史条目）
- [x] 排查 planPath 的其他消费方（tipc 任务路由、执行会话 prompt 组装等，grep `planPath`）同步适配 resolve
- [x] 测试：2→3 迁移（工作区内转相对 / 工作区外保持绝对）、create→read round-trip、绝对遗留条目读取不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 「状态变更回写统一存相对」实际无需处理：transition 类写操作不触碰 planPath 字段，回写时已是存储值——归一化收口点仅 createTask 单处
  2. 顺带修正 createTask 存在性检查原按 CWD 解析相对入参的隐性问题，统一按「相对=相对工作区根」resolve 后 access
  3. 存储用 posix 分隔符（`docs/plans/...`），跨设备可移植关键（Win 存 `\` 到 Mac 解析失败）
- 改动文件清单：`electron/main/services/task-store.ts`、`electron/main/services/task-queue.ts`（executeOne/prompt 组装消费 resolve 后绝对路径，2 处）、`electron/main/services/task-store.test.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：导出 `resolvePlanPath(ws, planPath): string`（绝对原样/相对 join 根）；内部 `toStoredPlanPath(ws, planPath)`（path.relative 后 `..`/跨盘保持绝对，否则转 posix 相对）；`TASKS_FILE_VERSION = 3`；getTaskDetail 返回绝对 planPath（前端 baseDir 零改动），listTasks 返回存储值（相对）
- 下个 step 该从哪里继续：Step 3（虚拟路径进清单）与 Step 4 的 mergeArrayFile(tasks, id) 合入的条目天然相对同格式，无需转换；工作区外绝对条目跨设备后 planError 降级（设计 §5 预期）
- 待办或已知限制：task.planPath 仍 optional（存量缺省），resolvePlanPath 调用方已先判空；planPath 消费方全量排查结论见共享区 20261004-step2-delivery.md（tipc/task-service/task-tools/前端均零改动）
