# 应用数据布局调整与全局目录挂载 设计

**日期**：2026-09-15
**状态**：已与用户对齐方向，待实施

## 背景

1. **数据布局不透明、分类不一致**：notes/articles/memory 存 `<workspace>/.dogear/`（跟工作区走），会话/任务/配置存全局 config（`getConfigDir()`，生产 = `%APPDATA%\Dogear\.dogear`，开发 = `cwd/.dogear`）。实际按「内容资产 vs 应用状态」切分，但边界不严格（stocks 自选股、agent.md 是用户内容却在全局），用户与 agent 都难以建立稳定心智模型。开发工作区还因 `cwd/.dogear` 与 `workspacePath/.dogear` 同目录，两个概念叠加重叠。
2. **agent 找不到工作区数据**：`search-tools.ts:19` 的 `SKIP_DIR_NAMES`（node_modules/.git/.dogear）让 glob/grep 遍历跳过 `.dogear`，系统提示又从未告知数据目录，agent 对文章库全盲（read/write 按路径访问不受影响）。
3. **全局配置无访问通道**：settings.json（子会话预设/能力开关）、定时任务、`workspaces/{id}/config.json` 等无专用工具、生产环境在文件边界外，agent 无法读写；bash 无沙箱虽可绕行，但正路不通。

## 目标

1. 分层定死：**应用功能数据（notes/memory）→ 全局 config 的 `workspaces/{id}/` 下；用户内容产物（articles）→ 留工作区 `.dogear/articles`**（文章是 agent 处理后落工作区的产物，用户要在文件管理器直接可见）。
2. 全局 config 目录**默认挂载**进会话文件边界，配置类场景走文件直读直写，不做专用工具。
3. 认知补齐：动态注入段一行定位应用数据目录与配置文件；Glob/Grep 工具描述说明 `.dogear` 跳过行为。

## 架构（核心做法）

### 1. 存储迁移

- notes：`<workspace>/.dogear/notes` → `getConfigDir()/workspaces/{workspaceId}/notes`
- memory：`<workspace>/.dogear/memory` → `getConfigDir()/workspaces/{workspaceId}/memory`（含 core-profile.md、index.json、topics/ 及盘点中发现的附属目录）
- 服务层签名从 `workspacePath` 第一参数改为 `workspaceId`（或直接传 config 子路径），调用点（notes-tools、memory-tools、前端 data-center 事件）同步改。
- 存量懒迁移：服务初始化时检测旧目录存在则整体搬移 + 写迁移完成标记，参考 `migrate-notes-todos.ts` 既有模式；迁移后旧目录删除（不留双读歧义）。

### 2. 挂载 + 写排除（关键联动）

- `pi-session.ts` 的 `start()` 统一计算 `basePaths = [workspacePath, ...additionalPaths, getConfigDir()]`（去重），四处 roots 构造点（env :522、file tools :599、search tools :667/:781）与 `updateWorkspacePaths()` 热更新全部改用它。
- **写排除机制**：`WorkspaceExecutionEnv` 新增 `writeExcludedPaths`，guard 拆读写两态——read/append 放行、write/edit/remove/createDir 命中即拒。理由：notes/memory 迁入 configDir 后重新落回挂载边界内，若不排除，「工具成为唯一写通道」的索引一致性红利被挂载抵消。
- **禁写清单原则**：「有专用写工具的（notes/memory/tasks/plans）或 app 独占高频写的（conversations/sessions/groups/usage/logs/run-history/tmp）→ 禁写；纯配置与提示词文件（settings.json、config.json、site-knowledge/、skills/、*-prompt.md）→ 放开」。初始清单（顶层相对 configDir）：`notes/`、`memory/`、`tasks.json`、`plans.json`、`usage/`、`logs/`、`run-history/`、`tmp/`、`workspaces/`；其余放开。实施时按盘点校准。

### 3. 认知注入

- `session-append-templates.ts` 新增迷你动态段（main/sub 均注入，约 3 行）：应用数据目录绝对路径（运行时注入）+ 配置文件定位（settings.json、定时任务、`workspaces/{id}/config.json`）+ 禁写区一句话（运行时数据与笔记/记忆由应用工具管理，文件只读）+ 工作区 articles 位置与「默认搜索跳过 .dogear、显式 path 可搜」说明。
- `getSystemPromptSegments()` 注册新段（设置页可见，项目硬决策）。
- Glob/Grep 工具 description 各加一句 `.dogear` 跳过行为说明。

## 排除的选项及原因

- **配置类做 dogear__ 专用工具**：低频「看一眼/改一处」场景，挂载 + 一行定位性价比更高（YAGNI）。
- **articles 一并迁全局**：用户拍板文章属工作区产物，要文件管理器直接可见 + agent 直接文件读写。
- **configDir 整体只读挂载**：用户工作流包含让 agent 改配置（预设/提示词），整体只读挡正常路径；改用精确禁写清单。
- **session 长目录名改造**：pi-agent-core `JsonlSessionRepo` 按 cwd 转义命名（`jsonl-repo.js:5`）是内部持久化约定，恢复逻辑依赖，不动。
- **全局挂载加设置开关**：默认行为即合理，先不加（YAGNI）。

## 模块边界

- `electron/main/services/notes/*`：notes-store 路径函数、service 签名、索引与广播事件
- `electron/main/services/memory/*`：memory-fs 路径、service、state-card 等附属路径（盘点确认）
- `electron/main/agents/pi-session/pi-session.ts`：basePaths 统一 + 热更新
- `electron/main/agents/pi-session/workspace-execution-env.ts`：写排除机制
- `electron/main/agents/pi-session/search-tools.ts`：工具描述
- `electron/main/agents/session-append-templates.ts`：新动态段 + 注册
- 迁移逻辑：新文件（或并入既有 migrate 模式）
- 前端跟进：data-center 若展示 notes/memory 路径需同步

## 数据流

- 会话创建：`start()` 算 basePaths（含 configDir）→ env.allowedPaths + writeExcludedPaths → file/search 工具 roots → 系统提示注入动态段。
- notes/memory 读写：dogear__ 工具 → 主进程 service → config 新路径；agent 文件工具对这两处只读。
- 配置场景：用户指路 → agent read/write `settings.json` 等放开区 → app 下次加载生效。
- 迁移：应用启动/服务初始化 → 检测旧目录 → 搬移 + 标记 → 后续走新路径。

## 错误处理 / 边界情况

- 开发模式 `workspacePath` 与 `configDir` 前缀重叠（C:\dogear 与 C:\dogear\.dogear）：basePaths 去重；resolveWithinPaths 逐根尝试本身无害。
- 迁移半途失败：标记文件记录状态，下次启动幂等续迁；旧目录搬移成功前保持原路径可读兜底。
- `workspaces.json` 的 id 稳定性：工作区路径移动后 id 不变（既有机制），notes/memory 挂 id 下天然稳定。
- 索引一致性：memory/index.json 是否有 rebuild 兜底（notes 有），实施盘点时确认；无则禁写机制即唯一防线。

## 未决问题（实施时确认）

- memory 附属目录全集（topics-backup、state-card 存储、skill 引用中的硬编码路径）——step1 盘点产出。
- 动态段是否注入 executor 任务会话（先含，成本低）。
- 禁写清单精确边界（`workspaces/` 整目录禁写会把 config.json/agent.md 也禁掉——两者放开写与否待定，默认禁，后续有需要再放）。
