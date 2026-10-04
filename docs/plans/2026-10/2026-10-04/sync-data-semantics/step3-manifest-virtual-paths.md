---
step: 3
title: 虚拟路径进清单与映射
status: done
---

## 目标
`__ws-external__/{wsid}/` 虚拟路径进同步清单生成侧与 wsid 映射侧；协议版本 +1 并对旧版本对端做条目过滤。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.3
- 前置 step 产出：[step1-registry-settings-model.md] registry 已有 tasks/articles 同步项与 userSyncPaths 模型
- 现状：`manifest.ts` buildManifest 只扫 configDir 固定清单；`workspace-map.ts` 已有 per-peer wsid 映射表（workspaces/ 子目录过滤用）；`protocol.ts` SYNC_PROTOCOL_VERSION 握手警告机制已有
- 清单条目来源：workspaces.json 注册表（复用 `data-registry.ts` `readRegisteredWorkspaces` 的思路，注意该函数私有，需导出或提公共）× registry 声明（tasks.json、articles/）× syncOptions.userSyncPaths（勾选子树）

## 计划改动
- [x] `electron/main/services/sync/protocol.ts`：`SYNC_PROTOCOL_VERSION` +1
- [x] `electron/main/services/sync/manifest.ts`：`buildManifest` 新增虚拟路径收集——每个注册工作区收 `__ws-external__/{wsid}/.dogear/tasks.json`（存在时）与 `.../.dogear/articles/` 子树 walk + userSyncPaths 勾选子树 walk；`isExcluded` 加规则：disabledSyncItems 含 `'tasks'` 时排除 tasks 虚拟条目、含 `'articles'` 时排除 articles 子树；userSyncPaths 变更项不在 disabledSyncItems 体系（勾选即开）
- [x] `electron/main/services/sync/workspace-map.ts`：wsid 翻译扩展到虚拟路径条目（对端 `__ws-external__/{对端wsid}/rest` → 本端视角 `{本端wsid}`；映射表无此对端 wsid → 该条目跳过不进 diff）
- [x] `electron/main/services/sync/orchestrator.ts`：拉取前对对端清单做版本 gating（对端协议版本低于新版本时过滤其 `__ws-external__` 条目；本端推送给旧对端时同样不推虚拟条目）
- [x] 测试：buildManifest 虚拟条目（含勾选子树）、isExcluded 新规则、wsid 翻译与未映射跳过、版本 gating

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划外配套改动 4 处（均为必要防线或接线，详见交付文档）：① `server.ts` 响应侧按请求方协议版本过滤虚拟条目（orchestrator 单侧 gating 防不住旧端拉取方向）；② `apply.ts` applyIncoming 入口对 `__ws-external__` 条目 skip（同版本过渡态防 resolveWithinDataDir 落 configDir 垃圾目录，Step 4 替换为反解落盘）；③ `tombstoneCandidates` 加虚拟条目 enabled 守卫（否则取消映射 → 基线虚拟条目消失 → 误产墓碑 → 对端数据被删）；④ `lan-sync-service.ts` getManifestOptions 传 userSyncPaths（被动响应侧接线，与 enabledWorkspaceIds/excludes 同构）。
- 改动文件清单：`data-registry.ts`（导出 readRegisteredWorkspaces[+configDir 参数]/EXTERNAL_TASKS_REL/EXTERNAL_ARTICLES_REL/RegisteredWorkspace）、`sync/protocol.ts`（v3→v4）、`sync/manifest.ts`（ManifestOptions.userSyncPaths、isExcluded 虚拟规则、buildManifest→collectVirtualEntries、walkDir/statFile 拆 walkAbsDir/statAbs、tombstoneCandidates 虚拟 enabled 守卫）、`sync/workspace-map.ts`（toLocalView/toRemoteRelPath/isWorkspacePathSyncEnabled 虚拟分支）、`sync/orchestrator.ts`（拉/推双向 gating + userSyncPaths 传入）、`sync/server.ts`（响应侧 gating）、`sync/apply.ts`（虚拟条目入口守卫）、`sync/lan-sync-service.ts`（userSyncPaths 接线）、`sync/pairing-unpair.impl.ts`/`sync/tombstone.test.ts`（mock 对端协议版本 3→4 跟进）、新增 `sync/virtual-paths.test.ts`（12 用例）、`sync/workspace-map.test.ts`（electron mock + 动态 import，import 链拉起 settings-service）

### 给下一步的接力棒（Step 4）
- 关键签名 / 数据结构：虚拟条目 relPath 形态 `__ws-external__/{wsid}/...`，经 workspace-map 折算后 wsid 已是本端视角；`buildManifest(root, { userSyncPaths, enabledWorkspaceIds, excludes })`；`readRegisteredWorkspaces(configDir?)` 可注入目录；orchestrator `peerSupportsVirtual = 对端协议版本 >= SYNC_PROTOCOL_VERSION`；`isWorkspacePathSyncEnabled` 已支持虚拟路径 enabled 校验（push-guard 放行时直接可用）
- 下个 step 该从哪里继续：`apply.ts` 三处接管——applyIncoming 入口的 `__ws-external__` skip 守卫替换为反解落盘（resolveArchiveRelPath 同思路 + 工作区根前缀校验）；`hashEntries`/`pushOutgoing` 对虚拟条目读工作区真实路径（现状读 `<dataDir>/__ws-external__/` 不存在 → diff 中虚拟条目 skipped 'local file unreadable'、push 尝试失败、基线丢条目，这些过渡态噪音随 Step 4 接管消失）；`push-guard.ts` 拒绝分支改白名单放行（`isWorkspacePathSyncEnabled` 已就位）；MERGE_PATTERNS 加 tasks.json
- 待办或已知限制：① 虚拟条目与 userSyncPaths 勾选 `.dogear/articles` 重叠时会产出重复 relPath 条目（diff/baseline 的 Map 化天然去重，无害未处理）；② 版本 gating 判据 `>= SYNC_PROTOCOL_VERSION`，将来 v5 需重新评估（v4 对端认识虚拟条目但会被保守过滤）；③ deletePropagation/DELETE /file 对虚拟条目的对端落盘安全由 Step 4 guard 接管
- 测试：`bun test electron/main/services/sync/` 130 全过；全仓 `bun test` 566 全过；`bun run lint` 0 errors；`bun run build:electron` 通过
