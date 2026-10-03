---
step: 6
title: sessions 备份拆分（全局会话单独归类）
status: pending
---

## 目标
sessions 分类不再把全局 `conversations/` 并入每个工作区的 zip：全局会话单独备成 `backups/global/sessions`，工作区 sessions zip 只含 `workspaces/{id}/sessions` 自己的会话。

## 依赖上下文（接力棒输入）
- 前置产出：无硬依赖（独立于 step1-5，可并行实施）；现状参考共享区 20261003-investigate-backup.md「用户疑点」第 2 条
- 当前关键文件状态：`electron/main/services/data-registry.ts:147-148`——分类没有 global 去处时全局条目并入每个 workspace zip（sessions 即此情况）；memory 分类是正确范例（`:143-148`，workspace/global 源分离）
- 关键决策回顾：避免跨工作区重复存储（全局 conversations 124MB × N 个工作区）；频率/keep 沿用 sessions 现有配置（monthly + keep 1）

## 计划改动
- [ ] `electron/main/services/data-registry.ts`：DATA_ITEMS 中 sessions 的全局 `conversations/` 条目改为归入 global scope（照 memory 的模式），使「分类有 global 去处时全局条目不进 workspace zip」逻辑生效
- [ ] 恢复链路（`electron/main/services/backup-service/index.ts` restoreBackup 及数据中心恢复 UI）：`global/sessions` 的恢复目标为 `{configDir}/conversations/`；工作区 sessions 恢复不再触碰全局目录
- [ ] 存量过渡：不做迁移——旧的工作区 sessions zip（含全局 conversations）保留，global/sessions 首次备份后自然接棒，旧 zip 到期由 keep 裁剪淘汰
- [ ] last-run.json 旧签名不兼容处置：scope 变化后 key 变为 `global:sessions`，旧 `{wsid}:sessions` 记录自然失效残留，无害

## 验证
- 手动触发全量备份后：`backups/global/` 出现 sessions zip（只含 conversations），工作区 sessions zip 不再含 conversations 条目；数据中心恢复列表能正确区分两种 scope

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
