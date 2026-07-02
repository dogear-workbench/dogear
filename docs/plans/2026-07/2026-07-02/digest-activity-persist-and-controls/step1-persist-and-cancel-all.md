---
step: 1
title: 服务层持久化 + cancelAll
status: done
---

## 目标
把 `group-digest-trigger.ts` 的 `recent` / `lastScan` 持久化到磁盘，启动加载；新增 `cancelAllGroupDigest()` 服务函数。

## 依赖上下文（接力棒输入）
- 当前关键文件状态：`electron/main/services/memory/group-digest-trigger.ts` 是 ~227 行单文件，`recent` / `current` / `lastScan` 是模块级 let 变量
- 关键类型：`GroupDigestRecentEntry` 已在文件内定义（含 workspaceId/groupId/finishedAt/outcome/tier/profileName/error/durationMs）
- 关键依赖：`mainLogger` from `../../agents/logger.js`；`getConfigDir` from `../settings-service.js`
- 已有 cancel 路径：`runOne` 内部通过 `getAgentManager().submitTask(task, callback)` 提交，回调收到 CANCELLED 时 resolve；外部中断靠 `getAgentManager().cancelTask(taskId)`

## 计划改动
- [x] `group-digest-trigger.ts` 顶部 import：`fsSync` from 'node:fs'、`fs` from 'node:fs/promises'、`path` from 'node:path'、`getConfigDir` from '../settings-service.js'
- [x] 新增 `DigestActivityDoc` 类型（`{ version: 1; recent; lastScan; updatedAt }`）
- [x] 新增 `getActivityPath()` 返回 `path.join(getConfigDir(), 'digest-activity.json')`
- [x] 模块加载时同步 readFileSync → parse → 灌入 `recent` / `lastScan`（catch 静默）
- [x] 新增 `schedulePersist()`：500ms debounce 写盘
- [x] 新增 `persistActivity()`：拼装 doc → `fs.writeFile`，catch warn
- [x] `pushRecent` 内调 `schedulePersist()`
- [x] `triggerScanAll` 内 `lastScan = ...` 后调 `schedulePersist()`
- [x] 新增 `cancelAllGroupDigest()`：清 queue + 清 inFlight + 如有 current 调 cancelTask + notify idleWaiters

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 用了同步 readFileSync 加载（文件小、让首次拉 activity 即拿到历史），不是 lazy load
  - cancelAllGroupDigest 额外手动 notify idleWaiters——pump 在 await runOne 时靠 cancelTask 触发回调链；pump 不在跑时 waiters 不会自动触发，所以手动 splice+call
- 改动文件清单：`electron/main/services/memory/group-digest-trigger.ts`

### 给下一步的接力棒
- 关键签名：
  - `cancelAllGroupDigest(): Promise<{ cancelledQueued: number; cancelledCurrent: boolean }>`
- 持久化文件 schema：`{ version: 1, recent: [...], lastScan: { at, dirtyCount } | null, updatedAt: number }`
- 落盘路径：`<configDir>/digest-activity.json`
- 下个 step 该从哪里继续：`electron/main/tipc/digest.ts` 新增 `cancelAllGroupDigest` RPC，import + 转发同名函数
- 待办或已知限制：

