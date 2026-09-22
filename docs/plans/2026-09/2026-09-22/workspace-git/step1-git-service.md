---
step: 1
title: git-service 服务层
status: done
---

## 目标
新增 `electron/main/services/git-service.ts`：系统 git execFile 封装与影子仓库/用户仓库全部操作，后续步骤只消费本层 API。

## 依赖上下文（接力棒输入）
- 无前置 step。参考：`electron/main/services/workspace-fs-service.ts` 的服务层风格；configDir 取法 `getConfigDir()`（settings-service）；影子仓库路径约定 `<configDir>/workspaces/<id>/shadow-git/`（workspaceId 由调用方传入）
- git 操作通过 `execFile('git', [args], { cwd, maxBuffer })`，全局决策见 plan.md「全局决策」节

## 计划改动
- [x] `electron/main/services/git-service.ts`（新增，>300 行则拆 `git-service/` 目录）：
  - `hasGit(): Promise<boolean>`（结果缓存）
  - `ensureShadowRepo(workspaceId, workspacePath): Promise<void>` — 懒 init（`--git-dir`/`--work-tree` 分离 + 写自有 .gitignore），幂等
  - `takeSnapshot(workspaceId, workspacePath, source, relPath?, conversationId?): Promise<void>` — `add -A` + `commit`（无变更时跳过），内部按 workspaceId 排队串行
  - `listShadowHistory(workspaceId, workspacePath, relPath?): Promise<SnapshotEntry[]>` — log 解析（时间、message、hash），按文件过滤用 `log -- <path>`
  - `restoreFromSnapshot(workspaceId, workspacePath, ref, relPath?): Promise<void>` — 恢复前自动 `pre-restore` 快照；relPath 单文件 `checkout <ref> -- <path>`，否则整仓 `checkout <ref> -- .`
  - `getUserRepoStatus/Diff/Log/Show/Blame(workspacePath, ...)` — 用户仓库只读操作（工作区不在 git 仓库时统一返回可识别错误）
  - `commitToUserRepo(workspacePath, message, paths?): Promise<string>` — add + commit，校验仓库存在与 rebase/merge 进行态
  - `revertUserRepo(workspacePath, ref, relPath?)` — 单文件 checkout 或整仓 revert
  - `getFileHistory(workspaceId, workspacePath, relPath)` — 双源合并：影子 log + 用户仓库 log，统一时间线（给 step4 UI 用）
- [x] 脚本验证：临时目录建假工作区 → ensureShadowRepo → 手改文件 → takeSnapshot → listShadowHistory / restoreFromSnapshot 全链路跑通

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 超 300 行，拆为 `git-service/` 目录 5 文件（exec/shadow/user-repo/history/index）
  - 「写自有 .gitignore」的载体改为 `add -A -f` + `:(exclude)` pathspec：info/exclude 挡不住用户 work-tree 内的 .gitignore 规则，写入用户工作区又会污染文件；`-f` 绕过全部 ignore 规则（安全网覆盖被用户 ignore 的私人文件），exclude pathspec 提供自有目录规则，二者组合才能同时满足「不继承用户规则」+「覆盖私人文件」
  - 影子仓库 local config 额外设 `core.autocrlf=false`（Windows 防恢复时 CRLF/LF 漂移）与固定 user.name/email（不依赖用户全局 git 身份）
  - `listShadowHistory` / `restoreFromSnapshot` 无 git 时抛 `GitServiceError('git-missing')`（工具层转 isError 明确提示）；仅 `takeSnapshot` 静默跳过（挂钩语义）
  - 新增 `assertSafeRef`：拒绝 `-` 开头的 ref，防参数注入（如 `--upload-pack`）
- 改动文件清单：
  - `electron/main/services/git-service/exec.ts`（新增）：hasGit（缓存）/ execGit / execGitCode / GitServiceError（code: git-missing / not-git-repo / repo-busy / invalid-ref / no-changes / git-failed）/ workspaceGitPath（resolveAndValidate + 正斜杠化）
  - `electron/main/services/git-service/shadow.ts`（新增）：影子仓库全部操作 + workspaceId 级内存 Promise 队列串行
  - `electron/main/services/git-service/user-repo.ts`（新增）：用户仓库 status/diff/log/show/blame/commit/revert + repo-busy 探测
  - `electron/main/services/git-service/history.ts`（新增）：getFileHistory 双源合并按时间倒序
  - `electron/main/services/git-service/index.ts`（新增）：统一导出
  - `tmp/step1-git-verify.ts`（新增，git ignore）：全链路验证脚本
- 验证：`bun run build:electron` 通过；`bun run lint` 无 git-service 相关告警；验证脚本 32/32 通过（快照/恢复/双源/中文路径/并发串行/repo-busy/非法 ref/被 ignore 私人文件覆盖）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `hasGit(): Promise<boolean>`（缓存）
  - `ensureShadowRepo(workspaceId, workspacePath): Promise<void>`（懒 init，幂等，内部排队）
  - `takeSnapshot(workspaceId, workspacePath, source: SnapshotSource, relPath?, conversationId?): Promise<void>`；SnapshotSource = 'agent-write' | 'agent-edit' | 'ui-delete' | 'ui-rename' | 'ui-create' | 'pre-restore'；无 git 静默 return
  - `listShadowHistory(workspaceId, workspacePath, relPath?): Promise<SnapshotEntry[]>`；SnapshotEntry = { hash, time(ISO), message }
  - `restoreFromSnapshot(workspaceId, workspacePath, ref, relPath?): Promise<void>`（自动 pre-restore）
  - `getUserRepoStatus(ws): Promise<{ branch, entries: {path, indexStatus, worktreeStatus}[] }>`；`getUserRepoDiff(ws, relPath?): Promise<string>`（diff HEAD 文本）；`getUserRepoLog(ws, {relPath?, keyword?, limit?}): Promise<UserLogEntry[]>`；`getUserRepoShow(ws, ref, relPath?): Promise<string>`；`getUserRepoBlame(ws, relPath): Promise<string>`
  - `commitToUserRepo(ws, message, paths?): Promise<string>`（返回 commit hash）；`revertUserRepo(ws, ref, relPath?): Promise<void>`
  - `getFileHistory(workspaceId, ws, relPath): Promise<FileHistoryEntry[]>`；FileHistoryEntry = { hash, time, message, source: 'shadow'|'repo', author? }
  - 错误：全部抛 `GitServiceError`（`.code` 可判别），工具层 catch 后 isError 返回 err.message 即可
- 下个 step 该从哪里继续：step2 工具层（electron/main/agents/tools/git-tools.ts）消费本层 API + builtin-tools.ts Write/Edit 挂快照钩子（takeSnapshot fire-and-forget + catch console.warn）
- 待办或已知限制：
  - getUserRepoDiff 对无 HEAD 仓库 fallback 到 `diff --cached`（无 HEAD 且无 staged 时返回空串）
  - commitToUserRepo paths 数量极大时可能触 Windows execFile 参数长度上限（第一版不处理）
  - 影子历史膨胀无 gc（设计已后置）
