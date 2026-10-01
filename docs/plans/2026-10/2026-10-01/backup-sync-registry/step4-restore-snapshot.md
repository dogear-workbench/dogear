---
step: 4
title: 恢复升级快照还原
status: done
---

## 目标
恢复语义从覆盖解压升级为时点快照还原（I-3），补防护（I-4）与预备份 keep 尊重（I-5）。

## 依赖上下文（接力棒输入）
- （执行时回填 step3 接力棒）
- 现状关键文件：`backup-service/index.ts:131-152`（restoreBackup：先预备份后校验、keep 恒 10、无会话防护）、:168-186（extractZipTo 覆盖解压）、`electron/main/agents/pi-session/pi-session-repository.ts:42`（metadataCache 不失效）、`CategoryCard.tsx:94-95` 恢复确认文案

## 计划改动
- [x] 顺序修正（I-5 ②）：restoreBackup 先校验目标 zip 存在再跑预备份；预备份 keep 用用户配置（resolveCategoryConfig）而非 defaultConfig
- [x] 快照还原（I-3）：解包写回后，枚举 registry 声明的该分类源路径下、现存但 zip 外的文件并删除——**删除仅限 registry 源边界内**（外部锚点按虚拟前缀对应真实目录）；`__ws-external__` 工作区注销场景跳过
- [x] 会话防护（I-4）：恢复 sessions 分类前查运行中会话（agent-manager 运行态），有则整体拒绝并返回明确错误；恢复完成后失效 pi-session-repository metadataCache
- [x] 旧 zip 兼容：无虚拟前缀的存量 zip 按现有规则恢复（不触发外部路径反解）
- [x] UI：恢复确认文案加「快照内不存在的新增文件将被删除」；被会话防护阻止时 toast 说明

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 快照删除逻辑独立成 snapshot-restore.ts（index.ts 已 ~380 行，避免超 300 行且可独立单测）
  2. 空 zip 拒绝点在预备份之后（用户总能先拿到恢复前状态的预备份再被拒绝，兜底更完整）
  3. 运行态查询封装为 pi-session-manager 新方法 getRunningConversationIds()（现有 getAliveConversationIds 存活≠运行中；遍历 conversationSessionMap 取 isRunning() 集合）
  4. 成功 toast 追加显示删除文件数；RestoreResult 增 deleted[]，restoreBackup 增第 5 参 opts {keep?}（tipc 层透传用户 keep）
  5. pi-session 依赖用动态 import（避免 services→agents 静态循环）
- 改动文件清单：新增 snapshot-restore.ts、snapshot-restore.test.ts（9 例）；改 index.ts（restoreBackup 重写：zip 存在校验前置/会话防护/预备份用户 keep/空 zip 拒绝/快照删除/缓存失效）、pi-session-manager.ts（+getRunningConversationIds）、pi-session-repository.ts（+invalidateMetadataCache）、tipc/backup.ts（keep 透传）、CategoryCard.tsx（文案+删除数 toast）
- 验证：bun test 420 例 0 fail；build:electron + 前端 tsc 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `deleteFilesOutsideSnapshot(sources, zipEntryNames): Promise<string[]>`（sources=backupSourcesFor 输出；空条目集会清空全部源，空包防护在 restoreBackup 层）
  - `RestoreResult {preBackupFileName, restored, deleted}`；`restoreBackup(category, scope, fileName, targetRoot?, opts?: {keep?})`
  - `getPiSessionManager().getRunningConversationIds(): string[]`；`getPiSessionRepository().invalidateMetadataCache(workspaceId?)`
  - restoreBackup 流序：文件名校验 → zip 存在校验（enqueue 外）→ [enqueue] 会话防护(sessions) → 预备份(用户 keep) → 空 zip 拒绝 → extractZipTo 写回 → deleteFilesOutsideSnapshot → 失效 metadataCache(sessions)
- 下个 step 该从哪里继续：step5 转同步侧（server.ts push 校验/apply.ts 副本时间戳/manifest F1/settings-types U6）；conversations/ 若有独立元数据缓存（conversation-service 侧）不在本次失效范围，step5 同步写 conversations 时注意；sync 模块要查运行态/失效缓存时沿用动态 import 模式规避 services↔agents 静态循环
- 待办或已知限制：
  - 真机验证留用户：运行中会话防护 toast、停止后恢复成功、notes-groups 快照外文件真被删
  - 旧 zip（源范围变更前的备份）恢复时 zip 缺的 registry 源文件按快照语义删除（如旧 sessions zip 无 conversations/ → 恢复会清空全局 conversations），预备份含全部新源可回退，UI 文案已提示
  - 运行中判定 = isRunning() 不含 idle 存活会话（idle 不写文件，防护按「正在写」设计）
  - 快照删除失败（占用/权限）整体抛错，错误消息带预备份文件名可回退；残留空目录不清理（与旧行为一致）
  - 预备份失败不写 last-run（recordCategoryRun 只在 runBackup），保持最小实施
