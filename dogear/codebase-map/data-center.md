# 数据中心域（data-center）

数据中心四面板（用量/记忆与资产/版本与备份/设备同步）、统一任务面板（定时任务/协作任务/解析记录）、主题记忆、会话用量采集。主窗口内以哨兵 tab 整页承载：数据中心入口 = ActivityRail（tab 常驻挂载 display 切换，可弹独立窗口）；任务面板入口 = ActivityRail「任务」项（常驻挂载）；`src/App.tsx` 的 /data-center 路由为独立窗口宿主（TitleBar 拖拽条）。

## 统一任务面板（app/tasks-panel/）

- `page.tsx` — 面板骨架：左栏三区（定时任务/协作任务/解析记录，宽度持久化 ui.tasksListWidth）+ 右栏（编辑器 > 只读历史 > 任务详情 > 空态 优先级）；哨兵 tab TASKS_TAB_ID 常驻挂载
- `ScheduledTaskSection.tsx` / `TaskRunList.tsx` — 定时任务区：任务行（名称/触发描述/开关/运行中徽标/下次运行）+ 展开运行记录（listRunHistory by planId，conversationId 条目点开只读历史，运行中实时）
- `CollabTaskSection.tsx` — 协作任务区：TaskCardItem 行 + 执行会话条目（openHistory）；已完成单层折叠；消费 task-focus-store 深链（选中+完成区展开+滚动定位）
- `ParseHistorySection.tsx` — 解析记录区：listRunHistory(source='parse-article') + 区头「解析文章」URL 输入行（submitArticleUrl 链路）；条目点击成功开阅读视图、否则开留痕 md（traceFile）
- `TaskDetailPanel.tsx` — 定时任务详情（触发器/下次运行/立即运行/编辑/启停）；`TaskEditorPage.tsx` + `CustomAbilityMatrix` + `TriggerListEditor`/`TriggerRow`/`TriggerControls` + `utils.ts` — 任务编辑器（从数据中心迁入，新建/编辑共用）
- `SessionHistoryView.tsx` — 右栏只读会话历史：meta 条（返回/运行中徽标/标题时间模型）+「引用到主会话」+ 内嵌 AgentChat（readOnly，可见时上报全局焦点防误标未读）
- `TaskDetail.tsx` / `TaskCardItem.tsx` / `TaskStatusBadge.tsx` — 协作任务详情与卡片渲染件（从 components/notes/ 迁入）
- `TasksSearchProvider.tsx` — 顶栏搜索 provider：定时任务名/触发描述、协作任务标题/结果、运行记录（任务名/状态/summary/时间）；命中任务选中、运行记录开只读历史
- `history-utils.ts` — STATUS_META 徽章元数据 + token 计数格式化（另见 data-center 通用格式化件）
- `stores/tasks-panel-store.ts` — selection（scheduled|collab）/editing/historyView/workspaces 快照 + resolveTaskWorkspaceId（undefined→默认工作区，与主进程 executeTask 同语义）

## 面板（app/data-center/）

- `page.tsx` — 骨架：四 tab 下划线导航（用量/记忆与资产/版本与备份/设备同步）；workspaces 由页面加载一次下传
- `usage-panel.tsx` — 用量面板：时间分页（今日/7天/30天/全部）；'all' 后端聚合+会话列表逐工作区拉取合并
- `history-utils.ts` — 通用时间/时长格式化件（formatDateTimeShort/formatRelativePast/formatDuration），数据中心各面板与任务面板共用
- `memory-section.tsx` — 记忆与资产 tab 容器：选择器（全部工作区/全局（跨工作区共享）/各工作区）+重建索引按钮+主题记忆面板+习得资产分区；空态引导选工作区或「全局」；消费 memory-focus.ts 的 memoryTopicReq（顶栏记忆搜索命中：切工作区范围+下传 focusReq 给 TopicsPanel）
- `learned-assets-section.tsx` — 习得资产分区（全局资产，不受上方 scope 选择器影响）：平台脚本列表（listPlatformScripts）+站点档案列表（listSiteKnowledge，含正式/探索两区条目计数），点击拉详情后走 markdown-preview-store openInline 进阅读 tab预览；数据中心弹窗场景（hash #/data-center）openInline 后 toast 提示去主窗口看
- `version-backup/` — 版本与备份面板：VersionBackupPanel（tab 容器：状态加载 30s 可见轮询 + 分类配置写回 settings + 全部备份/打开目录（打开 backups/ 根目录）+ 逐项运行 loading + 调度级最近失败红字行）、GitSummarySection（用户 Git 仓库/自动快照两卡按工作区聚合只读展示，卡片副标题名词解释，快照统计两行不截断，git 缺失降级「未安装 git」）、CategoryCard（开关/频率/保留份数 + 每 scope 状态行/到期徽标/无变化跳过浅色提示/最近失败红字/立即备份 + 备份列表展开与恢复 showConfirm（快照还原语义：确认文案明示「快照内不存在的新增文件将被删除」，成功 toast 追加删除计数）；scope 名回退原文、未注册目录加徽标与 tooltip）、backup-meta（五分类元数据，默认值从主进程 BACKUP_CATEGORY_DEFAULTS 导入、tipc client 类型推导、格式化）
- `sync-panel.tsx` + `sync-peer-card/sync-pair-requests/sync-settings/sync-scope/sync-workspace-card/sync-result/sync-utils` — 设备同步面板：本机状态卡（启停/端口/设备 ID）、配对请求卡、「寻找设备」按钮（scanNow 手动扫描，scanning loading）、设备卡（已配对常驻：在线/离线 Badge、离线也可发起同步、下拉解除配对 confirm）、同步范围四段式（sync-scope.tsx：①应用数据/②工作区数据两组 Collapsible 折叠默认收起，组头「N 项·全部开启/已关 M 项」，展开后每项名称+说明+路径+开关由 DATA_ITEMS 字典派生；stocks/feishu 走独立布尔键、workspaces 关闭二次确认、settings.json 必选置灰；③用户文件 per-workspace 目录树勾选 userSyncPaths，sync-user-paths + sync-user-paths-tree 组件，组头 hint 说明文章库（dogear/articles/）也是工作区文件走 git 或勾选，勾选时异步统计子树规模防巨型误勾，有 .git 提示「走你自己的 git」；git 仓库工作区分组折叠——外层只放 ignored 条目，其余收进默认收起的「git 管理的文件（N）」组，归类全集随根请求一次拉取、前端前缀索引 O(1) 归类，git 不可用/超时退化为单列表；④不参与同步的本机数据 = shadow-git/冲突留底两个专项开关 + 字典 never 条目只读清单含敏感徽章）、结果卡（pull/push/skip/conflict 计数与明细，删除计数与删改冲突独立分区展示，冲突可取对端/留本端裁决）；主进程服务见下方设备同步节
- `topics-panel.tsx` / `topics-list.tsx` / `topic-editor.tsx` / `memory-types.ts` — 主题记忆列表+编辑器（slug 校验/覆盖确认/删除二次确认）；props 带 scope（workspace/global），tipc memory 五路由 scope 透传，listTopics 省略 scope 时合并返回（agent 工具侧消费）；focusReq prop 响应顶栏记忆搜索命中定位（走 selectTopic 同链路，含草稿脏检查）
- `DataCenterSearchProvider.tsx` + `memory-focus.ts` — 顶栏记忆搜索 provider（进入数据中心页预拉当前工作区+全局主题内存副本同步过滤，不发 IPC；命中经 memory-focus 请求链路：page 订阅切 memory tab → MemorySection 切范围 → TopicsPanel 选中主题）

旧入口已退役：数据中心「定时计划」「执行历史」两 tab 移除（SchedulerPanel 列表壳与 HistoryEntryCard 已删），定时任务/协作任务/解析记录唯一入口为统一任务面板；存量 run-history 旧条目（missed/collab-task 等非面板覆盖类型）仅存 jsonl 无 UI 入口（可接受）

## 用量（services/usage/）

- `usage-extractor.ts` — 从 result 提取 ConversationUsageEntry 纯函数（contextWindow 查目录表、模型缺失合成、工具/子代理聚合）
- `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，轻量扫描聚合 readUsageSince）

## 定时计划（services/scheduler/）

- `types.ts` — 数据模型（Trigger 九种：daily_at/monthly_at/interval/window/once/on_window_close/on_app_start/on_session_close/on_task_done 任务链）；RunHistoryEntry 带 conversationId（headless 会话链路写入）+ parse 专用 articleId/workspaceId/traceFile
- `time-rule-engine.ts` — 时间规则纯函数（validateTrigger/nextDueAt/detectMissed/describeTrigger）
- `plan-store.ts` — `.dogear/plans.json` 读写（version:2 容器，只认新格式，旧数组格式已不支持）
- `plan-validate.ts` — 保存校验（on_task_done 目标存在性+环检测、toolPacksOverride 白名单清洗、sanitizeSkillsOverride 去重过滤非索引内名字，空归一 undefined）
- `scheduler-service.ts` — 调度核心（分钟级 tick、窗口状态机、handleAppStart/handleSessionClose 入口、错过记 missed 不补跑；schedulerTaskId 会话关闭不触发 on_session_close 防任务自触发环）
- `run-history-store.ts` — `.dogear/run-history/YYYY-MM.jsonl` 按月追加+倒序分页+保留 3 个月；source/planId 筛选（无 source 旧条目读侧归 scheduler；存量 collab-task 条目原样保留，不再新增）
- `custom-agent-prompt.ts` — 定时任务 user prompt 模板（buildCustomAgentPrompt：任务名+提示词拼装，无人值守纪律与产物落盘约束并入，末尾 200 字结果自述要求）
- `runtime/plan-runner.ts` — 单任务执行器（防重入、断点补记、requestStop 按 conversationId 取 PiSession interrupt、onConversationId 回调回填历史条目与 RunningInfo）
- `runtime/task-executor.ts` — executeTask headless 会话执行链（对齐 task-queue 先例）：resolve 工作区/模型 → getOrCreateHiddenGroup(工作区,'定时') → conversationService.create（role:main + executor + schedulerTaskId 双标记，标题「任务名 · MM-DD HH:mm」）→ attachConversation（skillsOverride/enabledToolPacksOverride 透传，能力包按 executor 场景裁决）→ takeOverForUnattended + runTurn 一轮 → 空闲超时 2h interrupt（60s 强制放行兜底）→ summary=末段 assistant 文本截 500、tokens 从 usage 事件累加 → 终态通知+未读标记；先写 run-history 再 reportDone 顺序纪律保留

## 应用数据备份（services/backup-service/ + data-registry）

- `data-items.ts` — 数据字典单一来源（纯模块，无 node/electron 依赖，主进程/Worker/渲染层同构引用）：DATA_ITEMS 28 条全挂条目（id/路径模式 `{wsid}` 占位/名称/说明/backupCategory/syncItemId/sensitive/syncName 组级覆盖）+ 派生函数（syncStatusOf 四态/syncItemMetas/registrySyncItems/sensitiveRelPaths）+ BACKUP_CATEGORY_KEYS/SCOPES + EXTERNAL_ANCHOR_PREFIX；settings-types 的 SyncItemId 类型与 SYNC_ITEM_IDS 值均从这里派生（渲染层导入点形状不变），同步页数据明细直接导入消费；备份覆盖：article-parser/site-knowledge 归 app-config（global zip）；ws-articles 已退役无条目（文章=工作区文件，不进应用同步/备份）
- `data-registry.ts` — node 侧路径引擎 + data-items re-export（backup-service/sync 等既有导入点零改动）：backupSourcesFor（分类×scope → 源绝对路径，不适用的 scope 组合抛错）/toArchiveRelPath/resolveArchiveRelPath（旧格式外部锚点 zip 条目按 workspaces.json 反解，存量 zip 兼容）/readRegisteredWorkspaces/externalWorkspaceIndex/resolveExternalRelPath（`__ws-external__/{wsid}/` 虚拟路径→工作区真实路径，未注册 wsid → null 由调用方 skipped 警告）；ws-tasks 实路径条目 `workspaces/{wsid}/tasks.json`，ws-articles 已退役无条目；已下线文件（dashboard.md 等）不收录（测试锁定）
- `categories.ts` — 五备份分类（notes-groups/memory/tasks/sessions/app-config）；BACKUP_CATEGORIES 由 registry scopes × settings-types BACKUP_CATEGORY_DEFAULTS 派生，仅显示名本地
- `index.ts` — runBackup（enqueue 队列同 scope+category 串行互斥，成败均记 last-run）/runBackupAll（调度入口只跑到期分类，onlyDue 无变化跳过打 zip、记 skipped）/restoreBackup（快照还原：空 zip 拒绝、sessions 恢复前检查运行中会话、预备份用用户 keep、写回后删 registry 源边界内 zip 外文件）/getBackupStatus（行级 lastError/lastSkippedAt + scheduler 调度级状态）
- `zip-pack.ts` — 打包编排：主进程 stat 源产出条目（zip 内路径 = 相对 configDir 实路径，恢复原位）→ zip-pack-worker 线程纯打包（60s 超时）→ 失败/超时回退主进程分片 packEntriesSharded；旧格式外部锚点 zip 条目恢复时仍按注册表反解（存量兼容，snapshot-restore 同）
- `source-signature.ts` / `zip-pack-core.ts` — 源内容签名（sha1(mtime|size)，无变化跳过判定）/ 打包条目收集与主进程分片打包（zip-pack 回退路径实现）
- `snapshot-restore.ts` — 快照删除：registry 源边界内 zip 外文件删除（锚点反解、symlink 不跟随、工作区注销跳过不误删）
- `last-run.ts` — `backups/last-run.json` 读写（分类级+调度级最近执行结果与错误，writeChain 串行防互踩）
- `schedule.ts` — 定时 tick（错过不补跑，失败不再吞错）

备份语义：分类×scope（global 或每工作区）一 zip（`key-YYYYMMDD-HHmmss.zip`，轮换 keep）；恢复=快照还原（非增量覆盖），预备份兑底可回退；backups/ 与 last-run.json 为 registry 排除项

## 设备同步（services/sync/）

- `protocol.ts` — 同步协议 v4（SYNC_PROTOCOL_VERSION）：v3 的 manifest 清单交换 + GET/POST /file + DELETE /file（墓碑删除传播，manifest 请求/响应可携 tombstones）+ `__ws-external__/{wsid}/` 虚拟路径条目（现仅 userSyncPaths 勾选子树；tasks/articles 已归位 workspaces/{wsid}/ 实路径）；对端 <4 时虚拟条目收发整体过滤（防旧端把它当普通路径落到 configDir 成垃圾目录）；摘除固定声明的动作未 bump 协议版本——旧声明路径由本端单侧退役防线处理，旧对端无感知
- `lan-sync-service.ts` — 服务生命周期：mDNS 发现（discovery）+ HTTP server 启停 + 状态/peers 快照广播
- `discovery.ts` — mDNS 设备发现（30s requery + 90s 剔除，仅未配对）+ scanNow 手动扫描（mDNS 窗口 ~2s + 已配对设备 lastHost 地址 fetchPeerInfo 3s 探测，并发防抖）+ getDeviceSnapshot 合并快照（mDNS 在线 ∪ 探测在线 ∪ 离线已配对常驻，deviceId 去重 mDNS 优先）；peersChanged 广播携合并快照（合帧防乱序）
- `client.ts` / `discovery-broadcast.impl.ts` / `discovery-scan.impl.ts` / `pairing-unpair.impl.ts` — 对端 HTTP 客户端（pull/push 请求封装）+ discovery 广播/扫描、解除配对的 impl 拆分实现
- `pairing.ts` / `device.ts` — 配对码双端确认流程与设备身份；地址记忆（配对确认/runSync 收尾/探测成功写 lastHost·lastPort，仅成功路径）与 unpairDevice 解除配对（同步进行中拒绝，仅删 pairedDevices 条目，sync-state.peers 保留供重新配对续用）
- `workspace-map.ts` — per-peer 工作区映射（对端 wsid ↔ 本端 wsid，sync-state 持久化）：toLocalView/toRemoteRelPath 双向折算（虚拟条目同样翻 wsid）、learnReverseWorkspaceMap 反向学习、enabledWorkspaceIdsOf 映射开关、buildRemoteManifestView 折算视图（未映射虚拟条目进待映射清单驱动 UI 建映射）
- `manifest.ts` — 清单构建与 diff：ALWAYS_SYNC_DIRS/FILES + stocks/feishu 可选目录常规收集 + userSyncPaths 勾选子树虚拟条目（`__ws-external__/{wsid}/` 形式，读工作区真实路径；未勾选不收）；tasks 实路径随 workspaces/ walk 收集，开关走 workspaces 子树排除（tasks.json 含冲突副本精确匹配，其余子树不牵连）；`isExcluded` 唯一排除判定入口，分两层——前置退役防线（三类：RETIRED_SYNC_DIRS 顶层目录恒排除 + isRetiredVirtualDeclRelPath 旧固定声明 `__ws-external__/{wsid}/.dogear/{tasks.json*,articles}` 拦截 + isRetiredConfigArticles 旧 configDir 实路径 `workspaces/{wsid}/articles` 拦截（含磁盘留档不进清单），均不受开关/存量残值影响）‖ isUserScopeExcluded 用户范围（冲突副本/shadowGit/disabledItems/子树开关/stocks·feishu optionalDirs）；hashEntries 虚拟条目反解后 hash（注册表快照一次预读复用）；`tombstoneCandidates` 墓碑候选（基线有现无）用 isUserScopeExcluded——关开关是开关状态而非删除事实不产墓碑，退役路径墓碑豁免靠三防线不在用户范围判定内 + diff 中 localTombstones 检查先于 isExcluded（退役条目遇墓碑 → deletePropagation 驱动旧对端删旧位置数据）
- `orchestrator.ts` — 主动同步编排：buildManifest → diff → pull/push/skip 执行 → SyncReport（含 deleted/deleteConflicts）；peerSupportsVirtual 版本 gating（对端 <4 虚拟条目不进收发流）；mergedFiles 基线重算走统一反解；对端协议 <3 时删除传播整体禁用（退 v2 行为）
- `server.ts` — 被动端点：/manifest（回清单+被动端墓碑落盘+响应携墓碑）/file pull/POST push（落盘前 push-guard 校验，guard 输入携注册 wsid 集与 userSyncPaths）/DELETE（expectedHash 二次校验防误删）；GET/DELETE /file 走统一反解，可定位工作区真实文件
- `push-guard.ts` — push 接收端校验链（403+reason）：引擎自身路径（sync-state.json/backups）/敏感文件（sensitiveRelPaths：login-accounts.json/sync-state.json）全拒；`__ws-external__` 白名单仅剩 userSyncPaths 勾选子树（isRegisteredVirtualPath：注册 wsid × 勾选子树），其余虚拟路径（未注册 wsid/旧 tasks·articles 固定声明退役路径/树外/穿越段/畸形）一律 403；放行后仍过 isExcluded（含三类退役防线 + 旧 configDir articles 实路径）与映射 enabled 检查
- `apply.ts` — 文件写回与冲突处理（冲突留底副本 `.conflict-*` 带 rand4，COPYFILE_EXCL 防覆盖）；统一解析入口 resolveIncomingRelPath（虚拟前缀反解到工作区真实路径，其余限 configDir 内；写入/读取/副本/推盘/墓碑跟随全走此口）；tasks.json 条目级合并（实路径 pattern `^workspaces/[^/]+/tasks\.json$`，mergeArrayFile 按 id，version 取大；旧虚拟声明不再命中）；settings.json 字段级三方合并改白名单传播制（仅 SETTINGS_SYNC_FIELDS 逐字段与基线比，白名单外保本端）；syncOptions 重建时 userSyncPaths 走 rev-LWW 整组
- `merge-records.ts` — JSON 记录级合并原语（mergeRecordMapFile 键控挑新/mergeArrayFile 按 id 挑新/mergeWorkspacesFile 工作区注册表合并）；workspaces.json 先例，tasks.json 同构复用
- `sync-state.ts` — sync-state.json（deviceId/per-peer 基线与选项/地址记忆 lastHost·lastPort/全局 tombstones 90 天 TTL 上限 2000），withSyncStateLock 进程锁
- `tombstone.ts` — 删除传播执行单元：applyPeerTombstones（对端删本端跟随，虚拟条目经统一反解删工作区真实文件）/propagateLocalDeletes（本端删驱动对端）；删改冲突保守保留修改侧、不参与冲突裁决
- `ws-tree.ts` — 同步范围工作区目录树服务：单层懒加载 listWorkspaceDirForSync + 子树规模统计 statWorkspaceDirForSync（2 万文件上限截断）+ hasGitDir；根请求附带 loadGitClassify git 归类全集（两条 ls-files 互补互斥：managed=tracked+untracked 未 ignore，ignored=未跟踪且被忽略 --directory 折叠；15s 超时+64MB buffer+10 万条上限三重防御，任一失败静默退化为不分组），仅根请求跑 git、子级懒加载零 git 调用；段安全校验与 manifest 同规则，隐藏 .git/.dogear/dotfile，symlink 跳过，node_modules/dist 显示（一期无自动识别，靠 UI 大小提醒兜底）

不变量：settings.json 永不参与墓碑与覆盖删除（含配对密钥），且白名单外顶层字段（snapshot/backup/ui/profiles/browserProxyServer/migrated/webMcpApiKey 及未知新字段）一律保本端，syncOptions 内部走 rev 组 LWW 特判；墓碑生成两处对称（orchestrator 主动端 + server handleManifest 被动端，共用 tombstoneCandidates）；isExcluded 是清单/diff/apply/push guard 四处唯一排除判定（三类退役防线在其内无条件排除：顶层退役目录/退役虚拟声明/退役 configDir 实路径 articles）；退役防线三不变量：isExcluded 恒排除 / tombstoneCandidates 豁免墓碑拦截 / diff 墓碑检查先于排除；`__ws-external__` 落盘/读盘唯一入口 resolveIncomingRelPath（未注册 wsid skipped 警告不落垃圾目录，现仅 userSyncPaths 虚拟条目）

## 统一运行注册表（services/）

- `background-activity-service.ts` — 内存单例：后台任务（定时/文章解析；source 枚举保留 state-extract/collab-task 历史值）reportRunning/reportRunningConversation（运行会话 id 回填）/reportDone/getRunning；getSchedulerActivity 与任务面板运行中指示数据源；各源终态写 run-history

## 主题记忆（services/memory/）

- `memory-service.ts` / `memory-recall` / `memory-fs` / `memory-indexer` / `memory-types` — 工作区主题记忆（检索/索引/文件层；存 config `workspaces/{id}/memory`，已从项目工作区迁入）；公开面经 index.ts barrel 导出
- `memory-similarity.ts` — 主题相似度（slug token Dice / 关键词 Dice / 标题 bigram Dice 取最大，阈值 0.5）：SaveMemory 写入查重与体检重复对检测共用
- `memory-usage.ts` — 召回使用统计（config `memory-stats.json`，sync 白名单外本机独占；RecallMemory 命中埋点，体检判死重用）
- `preferences-service.ts` — 用户偏好层（config `preferences.md`，全局单文件；一条一事单行准入、同主题相似拦截+replace 覆盖、100 行/60 条熔断拒绝写入；pi-session 与 agent.md 同级常驻注入，data-items preferences 条目随同步/备份）
- `memory-maintenance.ts` — 对账修复（checkConsistency 发现孤儿才 rebuild，无错不动；清 .bak/.tmp/.conflict-* 垃圾）：sync 拉取/删除后（orchestrator）+ push 接收端防抖（scheduleMemoryRepair）+ 应用启动兑底（repairAllMemoryDirs）三触发点
- `memory-checkup.ts` — 体检全链条（重复对/死重 60 天未召回/过时候选 90 天被覆盖，无歧义直接修、裁决归用户）+ 每周体检定时任务幂等补建（builtin-memory-checkup-weekly，周一 09:00）

## Store 与类型

- `stores/scheduler-store.ts` — 定时任务前端（tasks/activity + RPC 封装失败 toast；运行历史由任务面板按 planId 局部拉取不经此 store）
- `stores/sync-store.ts` — 设备同步前端（peers 恒为合并快照含离线已配对常驻/status/运行进度/scanning 寻找设备态/scan·unpair action，syncEvent 广播事件驱动 + 完成 toast 含删除/删改冲突计数）
- `types/scheduler.ts` / `types/usage.ts` — 定时任务 / 用量数据模型（主进程镜像在各自 service）
- `hooks/use-visible-polling.ts` — 数据中心统一轮询钩子（可见才轮询，恢复可见立即拉齐）

## 注意

- 各 panel 只自持 `workspaceId: 'all' | id` 筛选状态，不读 workspace-store；轮询统一走 useVisiblePolling
- 版本与备份面板：配置写回走 settings-store saveSettings 整体写回（先读最新 settings 再改 backup 节）；备份状态行 scope 可能是非注册工作区目录，显示时用 nameById 回退到 scope 原文；恢复操作必须 showConfirm 且恢复是快照还原语义（快照外新增文件会被删，恢复前主进程自动预备份）
- 设备同步面板：同步项开关写 settings.syncOptions（disabledSyncItems 经 normalize 强制滤除 required 项，settings.json 不可关）；结果卡里删改冲突是「已保守保留」的既定结果、与可裁决的 conflicts 分开展示
- getUsage 懒重算 usageSummary 后读 JSONL；'all' 模式逐工作区聚合每行带 workspaceId 归属
- 后台任务接入统一历史时遵守顺序纪律：先写历史再 reportDone（UI 轮询视角 done 即历史可见）；写史 try/catch 失败不影响任务本身；解析历史的 history.jsonl 写入保留作 agent 诊断数据源

## 数据流

- 定时任务执行：tick → plan-runner → executeTask（headless PiSession，会话落隐藏「定时」话题，schedulerTaskId/executor 双标记不出现在会话列表）→ 终态：run-history（含 conversationId）+ 通知未读 → 任务面板运行记录可见 → 点开只读历史 / 引用到主会话迭代
- 应用数据备份：分类×scope → registry backupSourcesFor 取源 → 主进程 stat 产出实路径条目（zip 内 = 相对 configDir 路径）→ worker 线程打包写 `backups/<scope>/` → last-run 记录结果 → 面板红字/徽标可见；恢复反向：预备份 → 解压写回（旧格式锚点条目按注册表反解） → 快照外删除
- 设备同步：discovery 发现（mDNS ∪ 已配对地址探测，已配对设备常驻在线/离线态）→ pairing 配对（成功即记地址）→ runSync（orchestrator）：buildManifest → diff（含双向墓碑判定）→ pull（对端拉）/push（本端推、对端 push-guard 校验）/删除传播（DELETE /file 或本地 unlink）→ SyncReport 经 syncEvent 广播到结果卡；被动端 server 独立响应 /manifest 与 /file
- 组共享区文件：agent 交付/报告写入 shared/（自动日期前缀+源会话指针），跨话题检索动线 ListTopics → SearchSessions（含共享文件结论层命中）→ ReadReferenceSession 深挖过程（详见 chat.md / agent-core.md）
- 话题面板 UI（共享文件）见 chat.md TopicPanel；会话内用量徽章见 chat.md usage-badge
