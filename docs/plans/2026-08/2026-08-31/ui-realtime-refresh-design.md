# UI 实时刷新（后台数据变更 → 前端自动更新）设计

**日期**：2026-08-31
**状态**：设计已拍板，待写实施计划

## 背景

后台执行（agent 会话、任务队列跑实施、子会话交付、组卡提炼）修改数据后，UI 多处需要用户手动操作才刷新：会话列表、文件树、TopicPanel 最明显。盘点结论（全量调研见会话组共享区 `reports/ui-refresh-audit.md`）：

- 已闭环不用动：notes / tasks / usage / 会话运行状态 / dashboard.md 内容 / 智能分类列表
- 缺口域：会话与组元数据（后台新建会话、touchGroup、autoUpdateTitle 均无广播）、工作区文件树（零监听）、TopicPanel（共享区/背景/组卡写点纯写文件）
- 顺带发现 bug：30 天自动归档是死路径（唯一触发入口 `group-store.load` 无任何组件调用）

## 目标

1. 会话/组列表：后台任何写入后前端自动刷新
2. 文件树：文件/目录**增删改名**后自动刷新；内容修改不触发（不影响树结构）
3. TopicPanel：共享区文件、话题背景、组卡提炼完成后自动刷新
4. 修复自动归档死路径
5. 清理死事件与类型残留
6. **硬约束：刷新只替换数据字段，不触碰任何 UI 状态**（选中态 / 展开折叠态 / 运行态 / 滚动位置 / 输入草稿）

明确不做（用户拍板）：文章分区刷新、智能分类 activity 轮询、自动复盘 running 指示。

## 架构

### 决策 1：会话/组域 = service 层统一广播

conversation-service / group-service 所有写方法尾部调统一 helper `broadcastListChanged()`，helper 分两档：

- **立即广播**：create / delete / 归档 / 移动 / 改名等结构操作（多为用户主动触发，立即回环保证无延迟感）
- **去抖广播（500ms 尾部）**：touch / touchGroup / autoUpdateTitle / usageSummary 等高频元数据变化（agent 跑活时每条消息都可能 touch，不去抖会列表风暴）

前端删掉散落在十几个 action 里的手动 `loadConversations()`，统一走 `conversationListChanged` 事件回环。任务队列建执行会话（task-queue.ts:142）走 service.create 自动覆盖，无需单独补。

排除选项：只补后台路径广播——改动最小但双轨并存，新增写入点还会忘。

### 决策 2：文件树 = 主进程 fs.watch 递归监听（新建 workspace-watcher 模块）

- 每个工作区一个递归 fs.watch，跟随 workspaces.json 增删起停（不随前端切工作区切换）
- 只处理 `rename` 事件（创建/删除/重命名），忽略 `change`（内容修改）
- 路径任意段以 `.` 开头或为 `node_modules` 的事件直接丢弃（对齐 getFiles 扫描范围：tipc/workspace.ts:251、workspace-fs-service.ts:11）
- 尾部去抖 ~500ms → 广播 `workspaceFilesChanged {workspaceId}` → 各窗口 workspace-store 匹配当前工作区才重拉 `getFiles`（全量 scan + 全量替换树数据）

排除选项：工具层广播（Write/Edit 广播覆盖不了 Bash 产物与外部编辑器，Bash 是 agent 产物大头）；轮询（大工作区全量扫描浪费）。chokidar 备选：封装在 watcher 模块内，实测事件风暴扛不住再换，替换面一屏代码。

### 决策 3：TopicPanel = 写点广播

新事件 `groupDataChanged {workspaceId, groupId}`，三个写点：

- group-shared-service（writeNativeFile / deleteNativeFile）——覆盖 agent dogear__SaveSharedNote 与前端写删
- background-store（saveGroupBackground）
- group-digest-store（writeGroupDigest）——覆盖组卡提炼完成

TopicPanel 订阅，当前展示组 == 事件组才重拉三份数据；删掉 refreshKey 本地刷新机制，前端删除共享文件同样走事件回环。

排除选项：组目录 fs.watch——写入点已收口在三个 store，广播更精确且免过滤。

### 决策 4：自动归档触发点挪主进程

- 启动时 fire-and-forget 跑一次 + 之后每 24h 一次（setInterval，不进 scheduler 体系——30 天阈值场景这个频率足够，避免给 scheduler 加内部依赖）
- 归档走 group-service.archiveGroup → 结构操作立即广播 → 前端列表自动更新
- 删除 group-store.load 里的 autoArchiveStale 触发（死链）

### 决策 5：死事件清理

删 4 个「广播了没订阅」：wechatNewMessage（tipc/wechat.ts:167 + wechat-store.handleNewMessages 死代码）、conversationRunningStateChanged（wechat-bot-controller.ts:352）、agentTaskUpdate（tipc/agent.ts:145）、deliveriesAwaitChanged（delegation-bridge.ts:129）。

删 5 个纯类型残留：agentStreamChunk / agentSessionMessage / subAgentStarted / subAgentCompleted / sessionWindowReady（同步清理 app/page.tsx:304 与 WorkspaceTabBar.tsx:91 声称依赖 sessionWindowReady 的注释）。

## 模块边界

主进程：

| 文件 | 改动 |
|------|------|
| `electron/main/services/conversation-service.ts` | 广播 helper + 各写方法接线（immediate / debounced 分档） |
| `electron/main/services/group-service.ts` | 同上（touchGroup 走去抖档） |
| `electron/main/services/workspace-watcher.ts` | **新建**：每工作区 watcher 管理、rename 过滤、去抖、广播、error 降级、随 workspaces.json 增删起停 |
| `electron/main/index.ts` | 启动接线 workspace-watcher + 自动归档定时 |
| `electron/main/services/auto-archive-service.ts` | 触发点改造（主进程定时） |
| `electron/main/services/group-shared-service.ts` / `background-store.ts` / `group-digest-store.ts` | groupDataChanged 写点广播 |
| `electron/main/tipc/renderer-handlers.ts` | 新增 workspaceFilesChanged / groupDataChanged 类型；删死事件类型 |
| `tipc/wechat.ts` / `wechat-bot-controller.ts` / `tipc/agent.ts` / `delegation-bridge.ts` | 删死事件发送点 |
| `electron/main/services/task-queue.ts` | **不改**（service.create 广播自动覆盖） |

渲染层：

| 文件 | 改动 |
|------|------|
| `stores/conversation-store.ts` | 删写操作后的手动 loadConversations；保留事件订阅 |
| `stores/workspace-store.ts` | 订阅 workspaceFilesChanged，匹配当前工作区重拉 |
| `stores/group-store.ts` | 删 load 里 autoArchiveStale 死链 |
| `stores/wechat-store.ts` | 删 handleNewMessages 死代码 |
| `components/TopicPanel.tsx` | 订阅 groupDataChanged；删 refreshKey 机制 |
| `components/WorkspaceExplorer.tsx` | 展开态保留验证（见风险点） |

## 数据流

1. **会话域**：任意写入点（渲染层操作 / 任务队列 / 子会话 / touch）→ service 写文件 → broadcastListChanged（立即或 500ms 去抖）→ 全窗口 `conversationListChanged` → conversation-store.loadConversations（只换数据分片，syncGroups 不碰展开态）
2. **文件树**：fs 变化 → watcher rename 过滤（丢弃 change / 点开头段 / node_modules）→ 尾部去抖 → `workspaceFilesChanged {workspaceId}` → 匹配窗口 loadWorkspaceFiles → getFiles 全量 scan → 树数据替换
3. **TopicPanel**：写点 → `groupDataChanged {wsId, groupId}` → TopicPanel 匹配当前组 → 重拉 listSharedFiles / readGroupBackground / readGroupDigest
4. **自动归档**：主进程启动 + 24h 定时 → autoArchiveStaleGroups → archiveGroup（立即广播）→ 列表自动更新

## 错误处理 / 边界情况

- watcher error（工作区目录被删 / 网络盘断开）→ 关闭该工作区 watcher 静默降级，退回手动刷新按钮，不崩；workspaces.json 里该工作区删除时同步清理
- 编辑器原子写（tmp + rename 替换保存）→ rename 误触发一次重拉 → 幂等全量替换，无害
- 事件风暴（bun install / git checkout）→ 命中忽略规则（node_modules / .git）在回调 O(1) 丢弃，回调不做 IO 不分配大对象
- **headless-tree 展开态：全方案唯一无现成答案的风险点**——树数据全量替换后展开状态是否保留需实施时验证；不保留则按 path 集合恢复展开集
- TopicPanel 重拉只换数据不重置滚动（纯只读面板，无编辑态）
- 多窗口：广播发全窗口，各窗口 store 自行匹配 workspaceId / groupId；session-window 的文件树同样实时
- 平台：Windows/macOS 原生递归监听；Linux 依赖较新 libuv（当前 Electron 版本 OK）；网络映射盘事件不可靠 → 降级容忍

## 未决问题（留给实施）

- headless-tree 展开态保留的具体实现（验证后定）
- watcher 去抖窗口实测调优（500ms 起步）
- conversation-service 写方法广播接线的完整清单（以实施时逐方法过一遍为准，原则：结构操作 immediate、元数据高频 debounced）
