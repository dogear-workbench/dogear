# 工作区 git 版本管理（双层）设计

**背景**：工作区文件目前是「人机共管但无版本管理」——人通过文件树（新建/重命名/删除）改文件，agent 通过 Write/Edit/bash 改文件，一旦改坏没有恢复手段，历史也无从追溯。另一痛点：agent 出方案时经常不探查现状（例：系统已有归档功能，agent 却提出新建软处理机制），如果用户自己也不清楚就会导致冗余方案或方向错误。git 历史是时间维度的「代码地图」，与 codebase-map（空间维度）互补，可让 agent 出方案前查「之前有什么、怎么演变的、当初为什么这么做」。

**目标**：
1. **安全网**：agent/人改坏文件后可回滚，覆盖范围含被 .gitignore 的私人文件
2. **历史感知**：agent 可查工作区文件的演变历史（commit message 搜索、diff、blame），出方案前先探查既有功能
3. **人机共管**：agent 的正式产出以规范 commit 进用户 git 仓库，与用户的 commit 同一条历史线；双方共用同一查询入口

**架构**：双层 git，按「存储位置 × 管辖范围」切分——

| 层 | 仓库 | 管辖 | 性质 |
|---|---|---|---|
| 安全网层 | **影子 git**：git-dir 在 `<configDir>/workspaces/<id>/shadow-git/`，work-tree 指向工作区（`--git-dir`/`--work-tree` 分离，系统 git execFile 实现） | 全部工作区文件**含 .gitignore 域私人数据**（影子层用自己的 ignore 规则：node_modules/out/dist/.dogear/大二进制等，不继承用户 .gitignore） | 自动快照，高频，纯本地，永不接触远端 |
| 正式历史层 | 用户 git 仓库（就地） | 项目文件，天然受用户 .gitignore 保护 | agent 显式 commit（message 规范），用户 review 后自行 push |

排除的选项及原因：
- **纯就地策略**（agent 只用用户仓库）：.gitignore 域的私人文件无版本保护，安全网有缺口
- **纯影子策略**：agent 查不到用户 git 的真实历史积累，历史感知核心价值丢失；割裂人机共管的历史线
- **非 git 方案**（自定义文件快照/内容寻址存储/数据库）：diff/log/blame/回滚全要自造，本质是造残缺版 git；文件系统快照平台不可控
- **isomorphic-git**：work-tree 分离支持不完整，不如系统 git 直接；用 execFile 传参即可

**agent 工具面**（细粒度多工具，zod 严格校验，`registerTools()` 注册元数据）：

| 级别 | 工具 | 权限 |
|---|---|---|
| 只读 | `dogear__GitStatus` / `GitDiff` / `GitLog`（支持按路径、按关键词搜 commit message）/ `GitShow` / `GitBlame`——操作用户仓库 | 无条件放行 |
| 正式提交 | `dogear__GitCommit`（内部自动 add 已改文件 + commit，message 必填） | 放行 |
| 恢复/破坏性 | 用户仓库 `dogear__GitRevert`（单文件/整仓回退）走权限 **ask**；影子层 `dogear__GitSnapshotList`（快照列表，message 内嵌来源与 conversationId）/ `dogear__GitSnapshotRestore`（恢复前自动打「恢复前快照」，操作永远可逆）放行 | ask / 放行 |
| 远端 | push / pull / fetch / remote | **完全不提供** |

**模块边界**：
- 新增 `electron/main/services/git-service.ts`（或按体量拆分）：系统 git execFile 封装、影子仓库 init/快照/查询、用户仓库操作、git 存在性检测（`git --version`，无 git 时整组降级）
- `electron/main/agents/pi-session/builtin-tools.ts`：Write/Edit 执行成功后异步触发影子快照
- `electron/main/agents/tools/git-tools.ts`：工具组定义 + registerTools
- UI 文件操作挂钩：workspace-store 的 deleteItem/renameItem 等经既有文件 IPC 落地后触发快照（挂钩点在主进程文件服务层，不在渲染层）
- UI：`components/WorkspaceExplorer.tsx` 右键「历史」入口 → 快照/提交列表（时间 + 来源）→ 恢复按钮 + 简单文本 diff（渲染级 diff 组件后置）
- 能力包组织：进 ability-registry（触发条件：有工作区即启用；git 不存在时工具返回明确错误），具体挂靠实施时定

**数据流**：
1. agent Write/Edit → 主进程执行成功 → 异步影子快照：`git add -A && git commit -m "[snapshot] <工具名> <路径> (conv:<conversationId>)"`（同一工作区快照操作队列化串行）
2. UI 删除/重命名/新建 → 主进程文件服务 → 同上（message 来源标 UI 操作）
3. 外部编辑器改动：不主动监听，下次任意快照 `add -A` 被动带上
4. agent `GitCommit` → 校验用户仓库存在且无 rebase/merge 冲突态 → add + commit
5. agent `GitLog`/`GitShow` 等 → 只读操作用户仓库；影子历史经 `GitSnapshotList`
6. UI「历史」→ IPC → git-service 查该文件双源历史 → 列表 + diff + 恢复

**错误处理 / 边界情况**：
- 系统 git 不存在：能力检测后工具返回 `isError: true` 明确提示，UI 入口隐藏
- 用户仓库处于 rebase/merge/冲突中：GitCommit 拒绝并返回当前状态说明
- 工作区不是 git 仓库（纯文档区）：影子层自动 init 照常；正式层工具返回「工作区无 git 仓库」
- 多会话并发写同一工作区：快照走内存队列串行执行，避免 index.lock 冲突
- Windows：core.quotepath=false、execFile 参数数组传递（不经 shell，无转义注入）、中文路径
- 快照历史膨胀：第一版不做清理，后置（gc/保留策略另议）

**未决问题**：
- 影子仓库 init 时机（工作区注册时 vs 首次快照时懒初始化）——实施时定
- UI diff 的具体形态（第一版纯文本对比，语法级 diff 后置）
- 快照 message 的会话/任务关联是否进一步结构化（便于后续 C 阶段完整面板做「改动来自哪个会话」）
- 能力包挂靠方式与 Profile 白名单联动细节

**UI 范围（第一版 = 方案 B 最小 UI）**：文件树右键「历史」→ 该文件快照/提交列表（时间 + 来源）→ 每条可看简单 diff、可恢复。工作区级时间线面板与「改动关联会话」视图后置。
