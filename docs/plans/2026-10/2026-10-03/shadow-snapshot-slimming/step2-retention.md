---
step: 2
title: 保留窗口裁剪
status: pending
---

## 目标
快照链按标准档窗口自动裁剪：近 7 天全留 → 7~30 天每天留最后一条 → 30 天外丢弃；体积上限可控。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-rules.md] SnapshotSettings 已就位（窗口参数字段名以 step1 回填为准）
- 当前关键文件状态：`shadow.ts` 已有按工作区串行队列；无任何裁剪逻辑
- 关键决策回顾：设计文档明确「第一版不做清理」是欠账，本步补上；裁剪与快照共用队列互斥

## 计划改动
- [ ] `electron/main/services/git-service/shadow.ts`：新增 `pruneSnapshotHistory()`——按窗口规则计算保留 commit 集合，重写快照链（实现取向：优先验证 `git commit-tree` 段拼接或 filter-branch 类重写，选最小风险方案；refs 与 reflog 必须同步清理，否则 blob 仍可达）
- [ ] 触发节流：每日首次快照时顺带触发（内存记录上次裁剪时间），或每 N 次快照后；不做定时器
- [ ] 只裁剪 `[snapshot]` 开头的 commit；非快照 commit（理论上不存在，防御）不动
- [ ] 裁剪后跑 `git gc --prune=now`（可在队列内异步）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
