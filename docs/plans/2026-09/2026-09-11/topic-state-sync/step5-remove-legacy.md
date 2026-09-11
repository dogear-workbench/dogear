---
step: 5
title: 旧轨下线
status: pending
---

## 目标
砍 group_digest/review 内置定时任务，删除 digest/review 生产模块与工具，前端组卡/报告展示移除，共享函数迁移——旧双轨整体退场。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step4-naming.md] 话题命名已迁入状态卡链路（旧联动 SaveGroupDigest→updateGroup 可安全删除）
- 当前关键文件状态：scheduler `types.ts:3` BuiltinTaskId 含 group_digest/review；`builtin-task-meta.ts:47-66` 两组元数据；`plan-runner.ts:78/83` cancel 分支；`task-executor.ts:69/83` 执行 case；`plan-store.ts:88` maintenance 引用。memory 下 group-digest-{trigger,scanner,store,prompt}.ts、review-{trigger,store,prompt,scanner}.ts。工具 `group-digest-tools.ts`（ReadGroupDigest/CleanTranscript/SaveGroupDigest/ListGroupFiles）、`review-tools.ts`（ListDigests/ReadDigest/TraceSource/ReadReport/WriteReport）。前端 `components/TopicPanel.tsx:167-201`「组卡提炼」区、`app/data-center/digests-panel.tsx`
- 关键决策回顾：磁盘 digest.md/报告数据保留不删；既有用户 plan 中两任务项过滤隐藏（数据保留）；共享函数 getGroupDir/mergeSourcesSeen/GroupDigestSourceSeen 迁出 group-digest-store；review 工具组中记忆/core-profile 工具是独立注册的不受影响（确认后处理）

## 计划改动
- [ ] 共享函数迁移：getGroupDir/getGroupsRootDir/mergeSourcesSeen/GroupDigestSourceSeen（getStaleConversations 等背景侧依赖）从 group-digest-store.ts 迁至 background-store.ts 或独立模块
- [ ] scheduler：types.ts BuiltinTaskId 删两项；builtin-task-meta 对应条目删除；plan-runner/task-executor 对应 case 删除；plan-store.ts:88 maintenance 集合更新；既有 plan 数据过滤（读取侧不展示 group_digest/review 项，文件数据不动）
- [ ] 删除文件：group-digest-trigger/scanner/store/prompt.ts、review-trigger/store/prompt/scanner.ts（先全仓 grep 引用确认无残留）
- [ ] 工具删除：group-digest-tools.ts 整组（确认 CleanTranscript 是否 STATE_EXTRACT 或其他链路复用——是则单独保留注册）；review-tools.ts 中 ListDigests/ReadDigest/TraceSource/ReadReport/WriteReport 删除（RecallMemory 等非 review 专属工具确认注册归属后保留）
- [ ] 前端：TopicPanel.tsx 删「组卡提炼」Section 与 digest 状态/加载；app/data-center 删 digests-panel.tsx 及 page.tsx 引用；grep 报告相关 UI（ReadReport 消费面）一并清理
- [ ] 全仓 grep group_digest / GroupDigest / digest 残留引用清理（docs 外）；`bun run lint` + `bun run build:electron` 过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
