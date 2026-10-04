---
step: 1
title: 模型与判定原子改造
status: done
---

## 目标
`SnapshotSettings` 删 `excludeDirs` 换 `excludedPaths`，判定与 pathspec 消费端同步切换，一处不留旧字段引用（编译级原子变更）。

## 依赖上下文（接力棒输入）
- 当前关键文件状态：`electron/main/services/settings-types.ts:137` 起 `SnapshotSettings` 含 `excludeDirs: string[]`；`normalizeSnapshotSettings`（:415）按旧字段归一化；`SNAPSHOT_SETTING_DEFAULTS`（:148）内联 9 个名字
- `git-service/shadow.ts`：takeSnapshot 用 `settings.excludeDirs` 生成不带斜杠 pathspec
- `git-service/shadow-protection.ts`：`judgeSnapshotProtection` 按名字段命中判定，`shadow-protection.test.ts` 11 例基于名字级
- 关键决策回顾：全路径级（用户拍板废除名字级）；pathspec 必须锚定防语义漂移

## 计划改动
- [x] `settings-types.ts`：`SnapshotSettings` 删 `excludeDirs`，加 `excludedPaths: Record<string, string[]>` 与迁移标记 `exclusionScanDone?: boolean`；`SNAPSHOT_SETTING_DEFAULTS` 的 `excludedPaths: {}`；新导出 `DEFAULT_SNAPSHOT_DIR_NAMES = ['node_modules','out','dist','release','tmp','.dogear','.git','update-server','release2']`；`normalizeSnapshotSettings` 重写——excludedPaths 按工作区归一（值必须是 string[]、路径反斜杠转斜杠、去首尾斜杠、去重），单工作区非法回落空数组不丢弃其他键；读到旧 `excludeDirs` 字段忽略（迁移由 step2 消费旧 settings.json 原文，此处不承担转换）
- [x] `shadow-protection.ts`：判定改段前缀——`segments.startsWith(excludedSegments)` 语义（relPath 段数组前缀等于某条排除路径段数组即命中）；reason 仍 `'excluded'`
- [x] `shadow.ts`：takeSnapshot 的 exclude pathspec 改为 `excludedPaths[workspaceId]` 每条拼 `'./' + path`；删名字级拼装
- [x] `shadow-protection.test.ts`：改写用例覆盖段前缀（精确命中/子路径命中/段前缀不误伤同名前缀目录如 `data2` 不命中 `data`/反斜杠/根路径）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划列 4 文件，实际 6 文件——`shadow-slim.ts` / `shadow-slim.test.ts` 也引用 `settings.excludeDirs`（:264 构造 SlimContext），不一起改 build 必挂，为满足「编译级原子变更」纳入本次；
  - slim 判定改段前缀：`SlimContext.excludeDirs: Set<string>` → `excludedPaths: string[]`；`slimShadowRepo` 签名首位新增 `workspaceId`（excludedPaths 按工作区键控，取对应清单），调用方 `shadow.ts slimShadowRepoInQueue` 同步传参
  - 段前缀判定抽为共享辅助 `isExcludedRelPath`（shadow-protection.ts 导出），judge 与 slim 共用单一语义源
  - normalize 的路径清洗在计划要求（反斜杠转斜杠、去首尾斜杠、去重）基础上额外剥前导 `./`（否则 `./dist` 存库后段前缀判定永静默失效）
- 改动文件清单：settings-types.ts / shadow-protection.ts / shadow.ts / shadow-protection.test.ts / shadow-slim.ts / shadow-slim.test.ts
- 验证：`bun run build:electron` 通过；bun test 全量 537 pass / 0 fail

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SnapshotSettings { maxFileSizeBytes, excludedPaths: Record<workspaceId, string[]>, retention, disabledWorkspaces?, exclusionScanDone? }`；路径已归一（正斜杠、无 `./` 前缀、无首尾斜杠、去重）
  - `DEFAULT_SNAPSHOT_DIR_NAMES`（readonly 元组）：node_modules/out/dist/release/tmp/.dogear/.git/update-server/release2，经 settings-service `export *` 对外可见
  - `isExcludedRelPath(segments: string[], excludedPaths: string[]): boolean`——段前缀命中即整子树覆盖，顶层锚定
  - `slimShadowRepo(workspaceId, gitDir, workspacePath, settings)`
- 下个 step 该从哪里继续：step2 新建 `services/snapshot-exclusion-scan.ts`（scan/migrate/rescan 三函数），挂 `electron/main/index.ts` 启动序列与工作区注册钩子
- 待办或已知限制：
  - **step2 须注意**：`loadSettings()` 首次加载即 normalize 落盘，旧 `excludeDirs` 会在 step1 合入后的首次启动被洗掉；step2 迁移若需消费旧名单原文（对照出「用户曾主动删过的名字」），必须在首次 loadSettings 之前读取，否则只能走纯磁盘对照扫描（step2 文档主语义即后者，风险有限）
  - 前端 `app/settings/SnapshotConfigSection.tsx:65,66,70,174` 仍引用旧字段（vite 不查类型不阻塞，step5 收口）；`WorkspaceManagementTab.tsx` 仅 spread 默认值无需改
