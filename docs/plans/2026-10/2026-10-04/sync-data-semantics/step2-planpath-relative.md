---
step: 2
title: task-store planPath 相对化
status: pending
---

## 目标
tasks.json 的 planPath 从绝对路径改为工作区相对路径存储（version 2→3 迁移），读写两侧 resolve，为跨设备同步扫清路径不可移植问题。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.4
- 现状：`task-store.ts` `TasksFile.version = 2`；planPath 存绝对路径（如 `C:\dogear\docs\plans\...`）；`ensureMigrated` 已有 1→2 迁移先例（migrations Map + withFileLock）；读侧 `getTaskDetail` 直接按 planPath 读文件
- 本步独立于同步协议，本端即可验证

## 计划改动
- [ ] `electron/main/services/task-store.ts`：`TasksFile.version = 3`；`ensureMigrated` 加 2→3：`path.relative(workspacePath, planPath)` 转相对，结果以 `..` 开头（工作区外）或转换失败的条目保持绝对不动；写侧（createTask / 状态变更回写）统一存相对路径（入参可能传绝对，store 层归一化）
- [ ] 读侧：`getTaskDetail` 等按 `path.isAbsolute` 分支——相对时 `path.join(workspacePath, planPath)`，绝对时原样（兼容未迁移成功的历史条目）
- [ ] 排查 planPath 的其他消费方（tipc 任务路由、执行会话 prompt 组装等，grep `planPath`）同步适配 resolve
- [ ] 测试：2→3 迁移（工作区内转相对 / 工作区外保持绝对）、create→read round-trip、绝对遗留条目读取不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
