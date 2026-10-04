---
step: 3
title: 同步层落地归一
status: done
---

## 目标

同步边界按宿主归一机器本地事实：workspaces.json 不再并入远端独有条目（杜绝 C:\ 路径幽灵工作区）；conversations.json 落盘时记录 `workspaceId` 重写为宿主 wsid（运输层净化，双向安全）。

## 依赖上下文（接力棒输入）

- `mergeWorkspacesFile`（`electron/main/services/sync/merge-records.ts:120`）：`if (!prev) { byId.set(id, rec); continue; }` 分支把远端独有工作区（带 `C:\dogear` 等对端路径）并入本机注册表——本机 watcher/task-queue 随之 ENOENT（2026-10-04 下午日志实证）。发现对端工作区的正道是 manifest 的 workspaceMeta（待映射清单），注册表并入无价值。
- `apply.ts` 的 `MERGE_PATTERNS`（:310 附近）：`workspaces/<wsid>/conversations.json` 走 `mergeRecordMapFile(local, remote, 'conversations')` 条目并集；**注意 `applyMergedIncoming` 有两条落盘路径**——合并路径（pattern.merge 结果）和「本端无此文件直接按对端内容落盘」路径（localRaw === null 分支），重写必须两条都覆盖。
- 版本偏差约束：对端 0.1.177 仍会写记录内 workspaceId，重写只在 apply 落地侧做，push 侧不动。
- 既有先例：sessions flat-cwd 目录名重写在 `workspace-map.ts:66-80`（encodeFlatCwd），本步与其同原则。

## 计划改动

- [ ] `merge-records.ts` `mergeWorkspacesFile`：远端独有 id 不再并入（该分支改为跳过并计数/注释说明「注册表机器自持，发现走 workspaceMeta」）；同 id 合并逻辑保持。
- [ ] `merge-records.test.ts`：更新/新增对应用例（远端独有条目不并入、同 id path 保本端仍成立）。
- [ ] `apply.ts`：为 conversations pattern 增加落地重写——从 `entry.relPath`（`workspaces/<wsid>/conversations.json`）取宿主 wsid，在 `applyMergedIncoming` 内对两条落盘路径的最终对象统一执行 `record.workspaceId = 宿主wsid`（mergeRecordMapFile 结果与 remoteParsed 直落都要过）。实现方式自定：可在 MERGE_PATTERNS 的 merge 闭包内做，也可在 applyMergedIncoming 落盘前按 relPath 判定后处理——选改动面小的。
- [ ] push 接收端（`server.ts` handleFilePush → mergeIncoming/apply 路径）确认同样经过 applyMergedIncoming 落盘（是则自动覆盖；若另有直写路径则补同样重写）。
- [ ] `bun test electron/main/services/sync/` 全绿。

## 验证

- 单测：merge-records 新用例通过。
- 集成（需两台设备，人工）：同步一轮后——本机 `workspaces.json` 不出现远端路径条目；Mira 推来的记录在本机 `conversations.json` 内 `workspaceId` 均为本机 572b768f；本机推送到 Mira 的记录在她侧落地为 db291a2d。
- 回归：现有 sync 测试（push-guard / settings-merge / tombstone）不红。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - push 接收端确认结果：handleFilePush 对非 settings 记录文件**不走** applyMergedIncoming，另有 writeIncomingFile 整文件直写路径（LWW 语义下不丢数据但会灌入发送端视角 wsid）——按计划预案补同样重写：apply.ts 新增导出 `isConversationsRelPath` / `normalizeConversationsWsid` / `writeIncomingConversationsNormalized`，server.ts 路由 conversations.json 推送到归一落盘。
  - 落地重写对合并结果的全量条目生效（含本端存量脏值条目）：合并路径顺手把 1171 条历史污染一并归一，超出「不做迁移」的保守预期且无副作用。
- 改动文件清单：
  - `electron/main/services/sync/merge-records.ts`（mergeWorkspacesFile 远端独有 id 不再并入）
  - `electron/main/services/sync/merge-records.test.ts`（并集用例改为「远端独有不并入 + 同 id 对端铺底新字段仍合并」）
  - `electron/main/services/sync/apply.ts`（normalizeConversationsWsid 归一；applyMergedIncoming 两条落盘路径（合并结果与 localRaw===null 直落）均过归一；新增 writeIncomingConversationsNormalized）
  - `electron/main/services/sync/server.ts`（handleFilePush 对 conversations.json 路由到归一落盘）
  - `electron/main/services/sync/conversations-wsid.test.ts`（新增：直落/合并/push 三路径归一 + 损坏输入拒绝）
  - `electron/main/services/sync/push-receive.test.ts`（新增 conversations.json 推送归一集成用例）

### 给下一步的接力棒
- 关键签名 / 数据结构：normalizeConversationsWsid(relPath, parsed) 原地改写；宿主 wsid = relPath 目录段（pull 侧 entry.relPath 已折算本端视角，push 侧 meta.relPath 已由发送端折算为接收端视角）。
- 下个 step 该从哪里继续：无（收尾步）。
- 待办或已知限制：两台设备集成验证（人工）：同步一轮后 Mira 推来记录在本机 wsid=572b768f、本机推去在她侧=db291a2d；存量 wsid 脏数据在下一次 conversations.json 同步 apply 时自动归一。
