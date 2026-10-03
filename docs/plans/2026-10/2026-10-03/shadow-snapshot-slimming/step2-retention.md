---
step: 2
title: 保留窗口裁剪
status: done
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
  - 重写机制选了 commit 对象段拼接（`cat-file commit` 原对象 → 保留 tree/作者/时间字节不变，仅换 tree 头/重建 parent 链 → `hash-object -t commit -w --stdin` 逐段重建），不用 filter-branch（Windows 上慢且弃用告警）
  - 边界补丁：最新一条无条件保留（锚点），否则链上全部超窗时 keep 集合为空、HEAD 悬空无解；代价仅是长期不活跃工作区多留 1 条 commit
  - 新增 `execGitInput` 之外的零 exec.ts 改动：裁剪全程用现有 `execGit`/`execGitCode`/`execGitInput`，git-dir 参数直传（cat-file/hash-object/update-ref/reflog/gc 均不触 work-tree）
  - 触发点按建议放在 takeSnapshot 的 enqueue 任务尾部（无变更早退改为 if 块，保证无变更快照也能触发当日裁剪）
- 改动文件清单：
  - `electron/main/services/git-service/shadow-prune.ts`（新）：`pruneSnapshotHistory()` / `maybePruneSnapshotHistory()` / `selectKeptHashes()` / `localDayKey()` / LOG_*_SEP 常量（原 shadow.ts 私有常量迁来导出）
  - `electron/main/services/git-service/shadow.ts`：takeSnapshot 任务尾部接 `maybePruneSnapshotHistory`（内存 Map<workspaceId, dayKey> 节流，try/catch 隔离）；LOG 常量改从 shadow-prune 导入
  - `electron/main/services/git-service/index.ts`：export shadow-prune（step5 瘦身可复用 `pruneSnapshotHistory`）
  - `electron/main/services/git-service/shadow-prune.test.ts`（新）：8 个用例（含真实 git 仓库集成：18 条多天链→10 条、链连续、时间保留、旧对象 gc 消失、体积降半、二次 no-op、空仓库/全保留/非快照 commit 防御）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `pruneSnapshotHistory(gitDir, workspacePath, retention): Promise<{ before; after }>`——按窗口重写快照链并 gc；调用方必须走 shadow.ts 的 `enqueue(workspaceId, task)` 串行队列
  - `maybePruneSnapshotHistory(workspaceId, gitDir, workspacePath, retention)`——每日首次快照顺带触发（内存节流不落盘），内部吞错只 console.warn
  - `selectKeptHashes(commits, retention, nowMs): Set<string>`——纯函数保留集合（近 recentDays 全留 → 每天留最新 → 超 totalDays 丢，最新一条锚点），commits 新→旧序
  - 保留窗口语义：本地日历日 age；age ∈ [recentDays, totalDays) 每天留最新一条，age ≥ totalDays 丢弃
- 下个 step 该从哪里继续：step3/4 UI 消费 `retention` 展示窗口；step5 存量瘦身可直接复用 `pruneSnapshotHistory`（同队列串行）或其底层段拼接手法
- 待办或已知限制：
  - 裁剪是逐 commit `cat-file` + `hash-object`（各一次进程调用），528 条 commit 的存量仓库首次裁剪约 1~2 分钟（在队列内、失败不影响快照本身）；step5 全量重写时若嫌慢可批量化
  - 裁剪后旧 hash 失效是预期（UI 刷新后自愈）；restoreFromSnapshot 拿旧 hash 会报 git-failed，前端已有错误兜底
