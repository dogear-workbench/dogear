---
step: 1
title: 清单与 diff 核心
status: done
---

## 目标
纯函数核心：给定两份文件清单算出「拉取/推送/冲突」三类结果，可在 Windows 单机用真实 .dogear 数据验证。

## 依赖上下文（接力棒输入）
- 设计依据：`docs/plans/2026-09/2026-09-26/lan-sync-design.md`「同步协议」「同步范围」节
- 前置 step 产出：无（首步）

## 计划改动
- [ ] 新建 `electron/main/services/sync/manifest.ts`：
  - `buildManifest(root, options): Promise<FileEntry[]>`——按白名单递归遍历（options 含 syncStocksData/syncFeishu 开关），FileEntry = `{ relPath, size, mtimeMs }`
  - `hashEntries(root, entries): Promise<FileEntry & { hash }>`——仅对 diff 出的候选算 sha256（流式读）
  - `diffManifests(local, remote): DiffResult`——`{ pull: FileEntry[], push: FileEntry[], conflict: {local, remote}[], same: number }`；判定：单侧有/改 → 拉或推；双侧都有且 hash 异 → conflict（LWW 在 apply 层做，diff 只分类）
  - 排除规则集中在 `ignoreRules` 常量（`*.bak`、`*.lock`、`__pycache__`、browser-profile/、logs/、backups/）
- [ ] `electron/main/services/sync/protocol.ts`：类型定义——`SyncManifest`、`DiffResult`、握手包 `{ appId: 'dogear', protocolVersion: 1, appVersion, deviceId }`、清单交换与文件传输的消息 schema（zod）
- [ ] `electron/main/services/sync/sync-state.ts`：`readSyncState()/writeSyncState()`——记录对端设备 ID、上次同步时间、上次清单 hash（`<userData>/.dogear/sync-state.json`，注意自身加入排除规则防自同步）
- [ ] 验证：Node 脚本对真实 .dogear 目录跑 buildManifest + 自 diff（local==remote 应全 same）；手工构造改动/冲突场景验证三分类
- [ ] `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `diffManifests` 改为 async 且增加可选 `baseline` 参数（上次同步后的清单快照，含 hash）：设计文档「对端新/改→拉、本地新/改→推、双改→冲突」的分类需要基线才能区分单双侧修改；无基线时双侧内容异保守判 conflict（绝不静默覆盖）。无对端 hash 但基线显示本地未变时可直接判 pull
  - `DiffResult` 增加 `skipped: { relPath, reason }[]`（设计文档要求占用/消失文件跳过并在结果里报告）；diff 层同时拒绝对端清单中的路径穿越项（`..`、反斜杠、绝对路径）归入 skipped
  - 排除规则比计划多 `*.tmp`（safeJsonWrite 的临时文件不应搬运）与 `sync-state.json`（防自同步）；目录名排除（logs/backups/browser-profile/__pycache__）按任意层级生效，已验证真实数据中 conversations/backups（空备份目录）与 workspaces/*/shadow-git/logs（git reflog）排除无害
  - hash 计算时机：buildManifest 不算 hash（全量 900M 太重）；diff 中仅对「双侧都有且 size/mtime 异」的候选调 `hashEntries` 算本地 sha256；对端 hash 经清单响应的 `candidateHashes` 传入（协议上两端各自算候选 hash 后交换）
- 改动文件清单：
  - 新增 `electron/main/services/sync/protocol.ts`（类型 + zod schema + 协议版本常量）
  - 新增 `electron/main/services/sync/manifest.ts`（buildManifest / hashEntries / diffManifests / isSafeRelPath）
  - 新增 `electron/main/services/sync/sync-state.ts`（readSyncState / writeSyncState，DOGEAR_CONFIG_DIR > userData/.dogear > cwd/.dogear）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `buildManifest(root, options?): Promise<FileEntry[]>`；`ManifestOptions = { syncStocksData?, syncFeishu? }`；relPath 统一 posix `/` 分隔、按 relPath 排序
  - `hashEntries(root, entries): Promise<HashedFileEntry[]>`（读失败静默跳过，由 diff 报 skipped）
  - `diffManifests({ root, local, remote, baseline? }): Promise<DiffResult>`；`DiffResult = { pull, push, conflict: {local, remote}[], skipped, same }`；same 判定：快路径 size+mtime 全等，或候选 hash 相等；conflict 项含双侧 FileEntry（apply 层 LWW 比较双侧 mtimeMs）
  - 协议常量：`SYNC_APP_ID='dogear'`、`SYNC_PROTOCOL_VERSION=1`；握手 schema `HandshakeHelloSchema`；清单交换 `ManifestRequestBodySchema` / `ManifestResponseBodySchema`（含 candidateHashes）；文件传输 `FilePullRequestSchema` / `FilePushMetaSchema`（push meta 带 mtimeMs 供写入后 utimes 对齐）
  - `SyncState = { version: 1, peers: Record<deviceId, { deviceName?, appVersion?, lastSyncAt, lastManifestHash? }> }`
- 下个 step（apply/server）从哪里继续：
  - `apply.ts`：原子写（可复用 safe-json 模式）+ 冲突副本命名 `<name>.<ext>.conflict-<对端设备短ID>`；写入 pull/push 文件后必须 `utimes` 对齐对端 mtimeMs（否则下轮永远成候选）；apply 完成后把本次清单 hash 写入 sync-state（peers[deviceId].lastManifestHash），下次同步作为 diff 的 baseline 传入
  - `server.ts`/`discovery.ts`：握手校验 HandshakeHelloSchema（appId/protocolVersion/appVersion/deviceId）+ 设备密钥 header；首次全量（无 baseline）双端同名异内容会大量判 conflict，建议面板层提供「首次同步以某端为准」引导（基线全取该端后即精确分类）
- 待办或已知限制：
  - mtime 浮点精度跨机往返可能有 ±1ms 漂移导致候选反复触发（结果仍 same，幂等无损，仅多算 hash），v1 不处理
  - deviceId 的生成/持久化与配对设备列表属 settings 扩展，未在 Step 1 范围
  - 验证脚本为一次性（bun 临时脚本，已删），核心结论：真实目录 4026 条目 60ms，自 diff 全 same，三分类/跳过/穿越拒绝全部符合预期
