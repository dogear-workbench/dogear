# 工作区 git 版本管理（双层）实施计划

**目标**：给工作区引入双层 git 版本管理——影子 git 全域自动快照（安全网，含 .gitignore 私人文件）+ 用户 git 仓库正式提交（人机共管），并配 agent 安全工具组与文件树「历史」UI。

**架构思路**：系统 git execFile 实现，影子仓库用 `--git-dir`/`--work-tree` 分离放 `<configDir>/workspaces/<id>/shadow-git/`；agent 工具面按只读/提交/破坏性三级分权（revert 走 ask），远端操作不提供；快照在 agent Write/Edit 成功后与 UI 文件操作后自动触发。设计全文见 `../workspace-git-design.md`。

**涉及模块**：
- `electron/main/services/git-service.ts`（新增，可拆分）
- `electron/main/services/workspace-fs-service.ts`（UI 快照挂钩）
- `electron/main/agents/pi-session/builtin-tools.ts`（agent 快照挂钩）
- `electron/main/agents/tools/git-tools.ts`（新增工具组）+ `tool-registry.ts` + ability-registry
- `electron/main/tipc/explorer.ts` 或新 tipc 路由（历史查询/恢复 IPC）
- `components/WorkspaceExplorer.tsx` + 历史面板组件

## 步骤索引

- [x] [Step 1: git-service 服务层](./step1-git-service.md) — execFile 封装、git 检测、影子仓库生命周期、快照队列、用户仓库操作、双源历史查询
- [ ] [Step 2: 快照触发挂钩](./step2-snapshot-hooks.md) — agent Write/Edit 成功后快照 + UI 文件操作后快照，队列串行
- [ ] [Step 3: agent 工具组与历史意识注入](./step3-git-tools.md) — 九个 dogear__Git* 工具、权限分级、registerTools、能力包挂靠、系统提示 git 历史意识段
- [ ] [Step 4: 文件树历史 UI](./step4-history-ui.md) — 右键「历史」入口、快照列表、简单 diff、恢复按钮

## 全局决策

- **工具命名**：`dogear__GitStatus` / `GitDiff` / `GitLog` / `GitShow` / `GitBlame` / `GitCommit` / `GitRevert` / `GitSnapshotList` / `GitSnapshotRestore`
- **错误约定**：工具 handler 一律 `isError: true` 返回，不抛异常；zod schema 严格校验
- **快照 message 格式**：`[snapshot] <source> <相对路径> (conv:<conversationId>)`，source ∈ `agent-write` / `agent-edit` / `ui-delete` / `ui-rename` / `ui-create` / `pre-restore`
- **影子仓库 ignore 规则**（Dogear 自有，不继承用户 .gitignore）：`node_modules/ out/ dist/ release/ tmp/ .dogear/ .git/` + 单文件 >10MB 跳过（`add` 前不预检，用 `.gitignore` 目录规则 + 不做大小预检，大文件交给 git 对象压缩，第一版简单化——若快照变慢再收紧）
- **路径语义**：工具入参相对路径一律 `path.resolve(workspacePath, arg)` 后再校验（踩过坑：主进程 cwd 不是工作区根）
- **execFile 纪律**：参数数组传递不经 shell；每次操作带 `-c core.quotepath=false`；Windows 中文路径直接传参
- **快照串行**：每个 workspaceId 一条内存 Promise 链，快照操作排队执行，避免 index.lock 冲突
- **git 缺失降级**：`hasGit()` 检测（`git --version`，结果缓存）——无 git 时工具 isError 返回明确提示、快照挂钩静默跳过、UI 入口不渲染
- **权限**：`GitRevert` 挂 permission ask；快照恢复放行（恢复前自动 `pre-restore` 快照保证可逆）
- **正式层保护**：`GitCommit` 前校验用户仓库存在且不在 rebase/merge/cherry-pick 进行态（探测 `.git/` 下 MERGE_HEAD/REBASE_HEAD 等），异常态 isError 返回状态说明
