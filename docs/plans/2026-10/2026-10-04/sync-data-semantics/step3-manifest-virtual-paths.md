---
step: 3
title: 虚拟路径进清单与映射
status: pending
---

## 目标
`__ws-external__/{wsid}/` 虚拟路径进同步清单生成侧与 wsid 映射侧；协议版本 +1 并对旧版本对端做条目过滤。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.3
- 前置 step 产出：[step1-registry-settings-model.md] registry 已有 tasks/articles 同步项与 userSyncPaths 模型
- 现状：`manifest.ts` buildManifest 只扫 configDir 固定清单；`workspace-map.ts` 已有 per-peer wsid 映射表（workspaces/ 子目录过滤用）；`protocol.ts` SYNC_PROTOCOL_VERSION 握手警告机制已有
- 清单条目来源：workspaces.json 注册表（复用 `data-registry.ts` `readRegisteredWorkspaces` 的思路，注意该函数私有，需导出或提公共）× registry 声明（tasks.json、articles/）× syncOptions.userSyncPaths（勾选子树）

## 计划改动
- [ ] `electron/main/services/sync/protocol.ts`：`SYNC_PROTOCOL_VERSION` +1
- [ ] `electron/main/services/sync/manifest.ts`：`buildManifest` 新增虚拟路径收集——每个注册工作区收 `__ws-external__/{wsid}/.dogear/tasks.json`（存在时）与 `.../.dogear/articles/` 子树 walk + userSyncPaths 勾选子树 walk；`isExcluded` 加规则：disabledSyncItems 含 `'tasks'` 时排除 tasks 虚拟条目、含 `'articles'` 时排除 articles 子树；userSyncPaths 变更项不在 disabledSyncItems 体系（勾选即开）
- [ ] `electron/main/services/sync/workspace-map.ts`：wsid 翻译扩展到虚拟路径条目（对端 `__ws-external__/{对端wsid}/rest` → 本端视角 `{本端wsid}`；映射表无此对端 wsid → 该条目跳过不进 diff）
- [ ] `electron/main/services/sync/orchestrator.ts`：拉取前对对端清单做版本 gating（对端协议版本低于新版本时过滤其 `__ws-external__` 条目；本端推送给旧对端时同样不推虚拟条目）
- [ ] 测试：buildManifest 虚拟条目（含勾选子树）、isExcluded 新规则、wsid 翻译与未映射跳过、版本 gating

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
