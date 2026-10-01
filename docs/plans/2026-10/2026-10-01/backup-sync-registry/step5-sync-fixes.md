---
step: 5
title: 同步堵洞（轻量组）
status: done
---

## 目标
修四个独立小洞：D1 push 接收端校验、D3 冲突副本防覆盖、F1 stocks/feishu 接入排除体系、U6 required 项禁关。

## 依赖上下文（接力棒输入）
- （执行时回填 step4 接力棒；本步与备份侧重叠仅为 registry 消费）
- 现状关键文件：`sync/server.ts:303-334`（handleFilePush 零校验直写）、`sync/apply.ts:82-97`（conflictCopyRelPath 固定名）、`sync/manifest.ts:43,78-99`（OPTIONAL_DIR_FLAGS 不在 excludes 体系）、`settings-types.ts` normalizeSyncOptions（接受 settings.json 进 disabledSyncItems）

## 计划改动
- [x] D1/S1：handleFilePush 落盘前过与 applyIncoming 对称的校验：isExcluded（含 OPTIONAL_DIR_FLAGS）+ 工作区映射折算（对端路径 → 本端 wsid → enabled 检查）+ 禁写清单（sync-state.json、backups/、login-accounts.json 等 sensitiveRelPaths）；拒绝返回 4xx 带 reason
- [x] D3：conflictCopyRelPath 与 saveLocalConflictCopy 的副本名追加时间戳段（`.conflict-<短ID>-<YYYYMMDD-HHmmss>`）
- [x] F1：excludesFromSyncOptions 携带 OPTIONAL_DIR_FLAGS；isExcluded 尊重 stocks/feishu 本端 flag（diff remote-only 与 applyIncoming 两处生效，消除每轮全量重拉）
- [x] U6：normalizeSyncOptions 过滤/拒绝 required 项（settings.json）进 disabledSyncItems；更新 sync-options-merge.test.ts 断言
- [x] 单测：server push 校验（可用现有 delegation-test-mocks 风格 stub）至少覆盖「暂停工作区被推 → 拒绝」「禁写路径被推 → 拒绝」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. push 工作区映射不经过 toLocalView 折算：推来路径已是本端视角（发送端折算过），只需查 workspaces/<wsid>/ 键的映射 enabled（isWorkspacePathSyncEnabled 放 workspace-map.ts）；误用 toLocalView 会在非直通映射场景误杀
  2. 副本名在设计格式上多一段 4 hex 随机（防同秒双冲突），saveLocalConflictCopy 加 COPYFILE_EXCL 兜底不静默覆盖
  3. ManifestOptions 删除 syncStocksData/syncFeishu（口径统一进 excludes.optionalDirs，避免双事实源）；OPTIONAL_DIR_FLAGS 改 OPTIONAL_DIR_ITEMS
  4. 计划外可测性注入：sync-state +readSyncStateFrom/writeSyncStateTo(dataDir)，server +authorizeRequest 可注入（集成测试对进程级 DOGEAR_CONFIG_DIR 被其他测试改写免疫，生产行为等价）
  5. 新增 HTTP 端点级集成测试 push-receive.test.ts（审计「无 server 端点测试」缺口首例）
- 改动文件清单：新增 push-guard.ts、push-guard.test.ts、push-receive.test.ts、conflict-copy.test.ts；改 server.ts（guard 接入落盘前 + authorizeRequest/dataDir 注入）、workspace-map.ts（+isWorkspacePathSyncEnabled）、apply.ts（副本名时间戳+随机段+EXCL）、manifest.ts（optionalDirs 进 excludes，删两开关字段）、orchestrator.ts/lan-sync-service.ts（适配）、settings-types.ts（normalizeDisabledSyncItems 滤 required）、sync-state.ts（From/To 版）、exclude.test.ts/sync-options-merge.test.ts（增补）
- 验证：bun test 441 例 0 fail；build:electron + 前端 tsc 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `checkIncomingPushRelPath(relPath, {excludes, workspaceMap}): PushGuardVerdict`（禁写→敏感→锚点→isExcluded→enabled 五层）
  - `ManifestExcludes {conflictCopies, shadowGit, disabledItems, optionalDirs: {stocks, feishu}}`；isExcluded 是唯一判定入口（清单/diff/apply/push guard 四处对称）
  - `conflictCopyRelPath(relPath, winnerShortId)`：`<stem><ext>.conflict-<短ID>-<YYYYMMDD-HHmmss>-<rand4>`
  - `readSyncStateFrom/writeSyncStateTo(dataDir)`：F5 加锁建议锁在 From/To 层或封装 withSyncStateLock(dataDir, fn)；server 已走 dataDir 版，orchestrator/tipc/sync.ts 还在全局版（锁面一致）
  - push-receive.test.ts 是现成 HTTP 集成测试骨架（mock electron → 动态 import → 注入 authorize/getManifestOptions → fetch）
- 下个 step 该从哪里继续：D2 三方合并入口 apply.ts computeMergedSettings（pull 合并与 push 侧 mergeIncomingSettings 共用）；基线内容快照存 sync-state（per-peer settingsBaseline，改 From/To 数据结构）；锁与基线都在 sync-state.ts 动
- 待办或已知限制：
  - GET /file（pull 读侧）未收口（S1 读侧），需按 manifest 白名单+副本豁免设计，后续处理
  - 两端都不开冲突副本同步时，push/both 档「取本端」裁决内容推不过去（副本被 guard 拒收 → 跳过整条，保守不丢数据但同步不完成）；若要裁决胜方可覆盖需 orchestrator 区分副本/内容推送口径，未做
  - 构造 ManifestExcludes 的代码必须带全 optionalDirs（缺省视为 stocks/feishu 关闭）；全仓调用方已适配
  - 真机双端验证留用户（暂停工作区推送 403 可见、关 stocks 后不再重拉）
