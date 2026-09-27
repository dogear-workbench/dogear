---
step: 1
title: 清单与 diff 核心
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
