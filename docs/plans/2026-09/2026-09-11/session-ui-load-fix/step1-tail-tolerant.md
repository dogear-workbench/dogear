---
step: 1
title: reader 尾行容错
status: done
---

## 目标
getConversationHistory 读运行中会话的历史时，撞上「写到一半的 JSONL 尾行」不再整体失败，自动丢弃/重读末行返回其余完整历史。

## 依赖上下文（接力棒输入）
- 设计：`../session-ui-load-fix-design.md` 架构第 1 条
- 现状机制：electron/main/agents/pi-session/session-history-reader.ts:11-16 readSessionBranchEntries → repository.open() → JsonlSessionStorage.open（上游 node_modules/@earendil-works/pi-agent-core/dist/harness/session/jsonl-storage.js:78-105）全量读 + 逐行 JSON.parse，invalid_entry 直接 throw；文件头注释「JSONL 只能经共享 reader」
- 调用链上游：electron/main/tipc/agent.ts:396-408 catch 后返回 {status:'error'}
- 关键决策回顾：只在 reader 层容错不动上游；失败行必须是最后一行才丢弃（append-only 末行最新，丢弃不损历史正确性），非末行失败仍抛错（真数据损坏）

## 计划改动
- [x] session-history-reader.ts：捕获尾部 invalid_entry——识别失败位置是否文件末行，是则丢弃末行返回其余条目（或对末行做一次短退避重读再判）；非末行维持抛错
- [x] 若 reader 拿不到行级错误信息（上游只给 invalid_entry 异常），评估换实现：绕过 repository.open 直接 fs 读取 + 自行逐行 parse（仍限于此 reader 内，不违反共享 reader 决策）
- [x] 验证路径：对正在输出的会话连续调 getConversationHistory 不再返回 error；对人为截断的末行文件返回除末行外完整历史；对中间行损坏文件仍报错

## 实施回填（做完后填）

### 实际改动
- 与计划差异：走了计划第 2 条（上游 SessionError 无结构化行号，行号只在 message 字符串里，不可靠）——绕过 repository.open，reader 内 fs 读取 + 逐行 parse（校验规则、错误码、branch/compaction 语义均逐行复刻上游 jsonl-storage.js / session.js），文件路径仍经 repository.getSessionPath；末行损坏直接丢弃（未做退避重读）；header 行损坏不参与尾行容错（维持抛错，header 写入非 append 竞态面）
- 改动文件清单：electron/main/agents/pi-session/session-history-reader.ts（单文件）
- 验证：bun run build:electron ✅ / bun run lint ✅（0 error，本文件无告警）/ 临时 bun test 7 项全过（完整读取、header-only 空、截断普通尾行丢弃、截断 leaf 尾行 leaf 回退、仅 header+截断返回空、中间行损坏抛 invalid_entry 且带行号、compaction 截断语义与上游一致），临时文件已清理

### 给下一步的接力棒
- 关键签名 / 数据结构：readSessionBranchEntries(workspaceId, sessionId): Promise<SessionTreeEntry[]> 签名不变，三个调用方（history-adapter / transcript-adapter / agent-worker）零改动；内部新增 loadSessionEntries（fs 读 + 逐行校验，末行 invalid_entry 丢弃）与 resolveBranch（复刻 getPathToRootOrCompaction）；错误仍抛 SessionError（invalid_session / invalid_entry / not_found），tipc agent.ts catch 行为不变
- 下个 step 该从哪里继续：step2 useMessageHistory error 状态化（error 不再 loadHistory([])）；reader 侧已就绪，getConversationHistory 撞半行尾行现在返回完整历史而非 error
- 待办或已知限制：getSessionPath 仍走 list() 全量扫目录（既有行为，性能项不在本期）；resume/getLiveSnapshot 走上游 repository.open 不经本 reader，撞半行仍会炸（设计文档已列为后续性能项）
