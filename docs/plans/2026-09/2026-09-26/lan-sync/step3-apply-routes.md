---
step: 3
title: 传输与应用
status: pending
---

## 目标
完整同步编排：清单交换 → diff → 双向传输 → 原子写入 + 冲突副本；tipc 路由齐备。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 `diffManifests` 签名、step2 server 的 HTTP 路由与设备密钥
- 关键决策回顾：LWW mtime 新者胜；旧方写 `.conflict-<对端短ID>` 副本；中断幂等

## 计划改动
- [ ] 新建 `electron/main/services/sync/apply.ts`：
  - `applyIncoming(root, entries, peerId)`——逐文件：临时文件写 + rename；冲突文件先落 `.conflict` 副本再覆盖
  - `pushOutgoing(root, entries, peer)`——流式读 + gzip + POST
  - 单文件失败（占用/权限）→ 记入 `skipped[]` 继续其余，不整体失败
- [ ] `electron/main/services/sync/orchestrator.ts`：`runSync(peer): Promise<SyncReport>`——握手版本检查（不匹配抛可确认警告）→ 双向清单 + hash → diff → 先拉后推（或按 mtime 交错，简单起见串行）→ 写 sync-state → 返回报告 `{ pulled, pushed, conflicts, skipped, durationMs }`
- [ ] 同步中防重入：进行中再次触发直接返回状态
- [ ] 新建 `electron/main/tipc/sync.ts` 路由（文件末尾 `registerTools()` 注册，遵守项目 tipc 规范）：`getPeers()`、`getSyncState()`、`runSync(peerId)`、`requestPair(peerId, code)`、`getPairCode()`、`setSyncOptions(opts)`、`syncEvent` 事件订阅（进度/完成推渲染层）
- [ ] settings 结构：`settings-service.ts`/`settings-types.ts` 增 `syncOptions: { deviceName, syncStocksData, syncFeishu, pairedDevices }`（默认值见 plan.md 全局决策）
- [ ] 验证：Windows 双实例 localhost 全流程——增量（改笔记→同步→对端可见）、冲突（双侧同文件各改→LWW+副本）、中断重试（同步中 kill 对端→重启→续传语义正确）
- [ ] `bun run build:electron` 通过 + Windows 主功能冒烟

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
