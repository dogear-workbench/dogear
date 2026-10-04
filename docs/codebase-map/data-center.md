# 数据中心域（data-center）

数据中心七面板（用量/定时计划/执行历史/记忆/版本与备份/浏览器数据/设备同步）、话题状态卡、主题记忆、会话用量采集。数据中心是主窗口固定 tab，可弹独立窗口。

## 面板（app/data-center/）

- `page.tsx` — 骨架：七 tab 下划线导航（用量/定时计划/执行历史/记忆/版本与备份/浏览器数据/设备同步）；scheduler tab forceMount（编辑草稿切 tab 不丢）；workspaces 由页面加载一次下传
- `usage-panel.tsx` — 用量面板：时间分页（今日/7天/30天/全部）；'all' 后端聚合+会话列表逐工作区拉取合并
- `history-panel.tsx` — 执行历史一级面板：类型/状态筛选（类型走后端 source 参数，下拉不含协作任务；协作任务状态可见性走任务列表与会话列表）、10s 可见轮询、分钟 tick 刷新；「正在运行」区显示三类后台任务
- `history-utils.ts` / `HistoryEntryCard.tsx` — 执行历史格式化与条目卡片（SOURCE_META 徽章，含 collab-task key 保留作旧数据条目渲染兜底；无 source 旧条目归 scheduler）
- `memory-section.tsx` — 记忆 tab 容器：筛选+重建索引按钮+主题记忆面板
- `version-backup/` — 版本与备份面板：VersionBackupPanel（tab 容器：状态加载 30s 可见轮询 + 分类配置写回 settings + 全部备份/打开目录（打开 backups/ 根目录）+ 逐项运行 loading + 调度级最近失败红字行）、GitSummarySection（用户 Git 仓库/自动快照两卡按工作区聚合只读展示，卡片副标题名词解释，快照统计两行不截断，git 缺失降级「未安装 git」）、CategoryCard（开关/频率/保留份数 + 每 scope 状态行/到期徽标/无变化跳过浅色提示/最近失败红字/立即备份 + 备份列表展开与恢复 showConfirm（快照还原语义：确认文案明示「快照内不存在的新增文件将被删除」，成功 toast 追加删除计数）；scope 名 personal→临时会话区、未注册目录加徽标与 tooltip）、backup-meta（五分类元数据，默认值从主进程 BACKUP_CATEGORY_DEFAULTS 导入、tipc client 类型推导、格式化）
- `sync-panel.tsx` + `sync-peer-card/sync-pair-requests/sync-settings/sync-workspace-card/sync-result/sync-utils` — 设备同步面板：本机状态卡（启停/端口/设备 ID）、配对请求卡、「寻找设备」按钮（scanNow 手动扫描，scanning loading）、设备卡（已配对常驻：在线/离线 Badge、离线也可发起同步、下拉解除配对 confirm）、同步范围设置三分组——应用数据（同步项开关含 tasks/articles+冲突副本+stocks/feishu 可选目录+工作区启停）/用户文件（per-workspace 目录树勾选 userSyncPaths，sync-user-paths + sync-user-paths-tree 组件，勾选时异步统计子树规模防巨型误勾，有 .git 提示「走你自己的 git」）/生成物（置灰，自动识别二期）、结果卡（pull/push/skip/conflict 计数与明细，删除计数与删改冲突独立分区展示，冲突可取对端/留本端裁决）；主进程服务见下方设备同步节
- `browser-data-panel.tsx` — 浏览器数据面板：全局分区（persist:dogear-browser）概览（磁盘占用/HTTP 缓存/登录站点数）+ 常驻准确性提示（误报可移除）+「我的登录」区（login-observer 检测的登录清单：证据徽章/最近登录时间，每条登出=本地清全量数据不通知服务器/清除数据/移除误报）+「其他站点数据」折叠区（仅清除数据）+ 面板级清缓存/全部清除；全部 showConfirm 含 agent 风险提示；30s 可见轮询；主进程服务与路由见 browser.md
- `topics-panel.tsx` / `topics-list.tsx` / `topic-editor.tsx` / `memory-types.ts` — 主题记忆列表+编辑器（slug 校验/覆盖确认/删除二次确认）
- `scheduler/` — 定时计划组件：SchedulerPanel（列表/编辑态切换）、TaskEditorPage（二级页：名称/提示词/模型/工作区/扩展能力/触发器）、CustomAbilityMatrix（扩展能力矩阵：五 extension 包，四包整包开关跟随/固化 toolPacksOverride、code-workflow 开关+6 skill 勾选写 skillsOverride；getAbilityPacks+listToolPacks 取数）、TriggerListEditor/TriggerRow/TriggerControls、utils（describeTrigger 等）

## 用量（services/usage/）

- `usage-extractor.ts` — 从 result 提取 ConversationUsageEntry 纯函数（contextWindow 查目录表、模型缺失合成、工具/子代理聚合）
- `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，轻量扫描聚合 readUsageSince）

## 定时计划（services/scheduler/）

- `types.ts` — 数据模型（Trigger 九种：daily_at/monthly_at/interval/window/once/on_window_close/on_app_start/on_session_close/on_task_done 任务链）
- `time-rule-engine.ts` — 时间规则纯函数（validateTrigger/nextDueAt/detectMissed/describeTrigger）
- `plan-store.ts` — `.dogear/plans.json` 读写（version:2 容器，只认新格式，旧数组格式已不支持）
- `plan-validate.ts` — 保存校验（on_task_done 目标存在性+环检测、toolPacksOverride 白名单清洗、sanitizeSkillsOverride 去重过滤非索引内名字，空归一 undefined）
- `scheduler-service.ts` — 调度核心（分钟级 tick、窗口状态机、handleAppStart/handleSessionClose 入口、错过记 missed 不补跑）
- `run-history-store.ts` — `.dogear/run-history/YYYY-MM.jsonl` 按月追加+倒序分页+保留 3 个月；source 筛选（无 source 旧条目读侧归 scheduler；存量 collab-task 条目原样保留，不再新增）
- `custom-agent-prompt.ts` / `custom-agent-tools.ts` — CUSTOM_AGENT 提示词模板与工具集组装（toolPacksOverride 完全替代语义）；文件读写工具在 agents/tools/workspace-file-tools.ts（Read/Write/Edit，Read 支持图片 png/jpg/gif/webp/bmp ≤5MB 转 ImageContent）；buildMountedSkillsSection 把挂载 skill 的 SKILL.md 全文按 `<mounted-skill>` 段拼进 systemPrompt（单个缺失/读取失败跳过告警不阻断）
- `runtime/plan-runner.ts` — 单任务执行器（防重入、断点补记、requestStop 带来源）
- `runtime/task-executor.ts` — 提交 CUSTOM_AGENT 到 agent-manager Worker 池（toolPacksOverride/skillsOverride 透传 payload），用量提取入历史

## 应用数据备份（services/backup-service/ + data-registry）

- `data-registry.ts` — 应用数据清单唯一事实源：DataItem 23 条全集（含 `{wsid}` 占位与 `__ws-external__` 外部锚点虚拟路径约定，ws-tasks/ws-articles 即虚拟条目且带 syncItemId）、`backupSourcesFor`/`sensitiveRelPaths`/`toArchiveRelPath`/`resolveArchiveRelPath` 派生；同步侧反解原语 `resolveExternalRelPath`+`externalWorkspaceIndex`（虚拟路径→工作区真实路径，未注册 wsid → null 由调用方 skipped 警告）；备份分类 scope（BACKUP_CATEGORY_SCOPES）与同步项（registrySyncItems）都从它派生；已下线文件（dashboard.md 等）不收录（测试锁定）
- `categories.ts` — 五备份分类（notes-groups/memory/tasks/sessions/app-config）；BACKUP_CATEGORIES 由 registry scopes × settings-types BACKUP_CATEGORY_DEFAULTS 派生，仅显示名本地
- `index.ts` — runBackup（enqueue 队列同 scope+category 串行互斥，成败均记 last-run）/runBackupAll（调度入口只跑到期分类，onlyDue 无变化跳过打 zip、记 skipped）/restoreBackup（快照还原：空 zip 拒绝、sessions 恢复前检查运行中会话、预备份用用户 keep、写回后删 registry 源边界内 zip 外文件）/getBackupStatus（行级 lastError/lastSkippedAt + scheduler 调度级状态）
- `zip-pack.ts` — 打包编排：主进程做锚点反解+stat 产出条目 → zip-pack-worker 线程纯打包（60s 超时）→ 失败/超时回退主进程分片 packEntriesSharded；zip 条目用虚拟前缀路径，恢复时反解写回真实位置
- `snapshot-restore.ts` — 快照删除：registry 源边界内 zip 外文件删除（锚点反解、symlink 不跟随、工作区注销跳过不误删）
- `last-run.ts` — `backups/last-run.json` 读写（分类级+调度级最近执行结果与错误，writeChain 串行防互踩）
- `schedule.ts` — 定时 tick（错过不补跑，失败不再吞错）

备份语义：分类×scope（global 或每工作区）一 zip（`key-YYYYMMDD-HHmmss.zip`，轮换 keep）；恢复=快照还原（非增量覆盖），预备份兑底可回退；backups/ 与 last-run.json 为 registry 排除项

## 设备同步（services/sync/）

- `protocol.ts` — 同步协议 v4（SYNC_PROTOCOL_VERSION）：v3 的 manifest 清单交换 + GET/POST /file + DELETE /file（墓碑删除传播，manifest 请求/响应可携 tombstones）+ 工作区数据虚拟路径条目（`__ws-external__/{wsid}/...`）；对端 <4 时虚拟条目收发整体过滤（防旧端把它当普通路径落到 configDir 成垃圾目录）
- `lan-sync-service.ts` — 服务生命周期：mDNS 发现（discovery）+ HTTP server 启停 + 状态/peers 快照广播
- `discovery.ts` — mDNS 设备发现（30s requery + 90s 剔除，仅未配对）+ scanNow 手动扫描（mDNS 窗口 ~2s + 已配对设备 lastHost 地址 fetchPeerInfo 3s 探测，并发防抖）+ getDeviceSnapshot 合并快照（mDNS 在线 ∪ 探测在线 ∪ 离线已配对常驻，deviceId 去重 mDNS 优先）；peersChanged 广播携合并快照（合帧防乱序）
- `pairing.ts` / `device.ts` — 配对码双端确认流程与设备身份；地址记忆（配对确认/runSync 收尾/探测成功写 lastHost·lastPort，仅成功路径）与 unpairDevice 解除配对（同步进行中拒绝，仅删 pairedDevices 条目，sync-state.peers 保留供重新配对续用）
- `workspace-map.ts` — per-peer 工作区映射（对端 wsid ↔ 本端 wsid，sync-state 持久化）：toLocalView/toRemoteRelPath 双向折算（虚拟条目同样翻 wsid）、learnReverseWorkspaceMap 反向学习、enabledWorkspaceIdsOf 映射开关、buildRemoteManifestView 折算视图（未映射虚拟条目进待映射清单驱动 UI 建映射）
- `manifest.ts` — 清单构建与 diff：`isExcluded` 唯一排除判定入口（冲突副本/shadowGit/disabledItems/stocks·feishu optionalDirs）；虚拟条目收集（registry ws-tasks/ws-articles 条目 + workspaces.json 注册表 + settings.syncOptions.userSyncPaths 勾选子树驱动，`__ws-external__` 形式；tasks/articles 开关关时不收）；hashEntries 虚拟条目反解后 hash（注册表快照一次预读复用）；`tombstoneCandidates` 墓碑候选（基线有现无，排除 settings/excludes/暂停工作区）
- `orchestrator.ts` — 主动同步编排：buildManifest → diff → pull/push/skip 执行 → SyncReport（含 deleted/deleteConflicts）；peerSupportsVirtual 版本 gating（对端 <4 虚拟条目不进收发流）；mergedFiles 基线重算走统一反解；对端协议 <3 时删除传播整体禁用（退 v2 行为）
- `server.ts` — 被动端点：/manifest（回清单+被动端墓碑落盘+响应携墓碑）/file pull/POST push（落盘前 push-guard 校验，guard 输入携注册 wsid 集与 userSyncPaths）/DELETE（expectedHash 二次校验防误删）；GET/DELETE /file 走统一反解，可定位工作区真实文件
- `push-guard.ts` — push 接收端校验链（403+reason）：引擎自身路径/敏感文件（login-accounts.json）全拒；`__ws-external__` 白名单放行（isRegisteredVirtualPath：注册 wsid × tasks.json 及其 `.conflict-*` 副本形态/articles 子树/userSyncPaths 勾选子树），其余虚拟路径（未注册 wsid/.dogear 其他文件/树外/穿越段/畸形）仍拒；放行后仍过 isExcluded 与映射 enabled 检查
- `apply.ts` — 文件写回与冲突处理（冲突留底副本 `.conflict-*` 带 rand4，COPYFILE_EXCL 防覆盖）；统一解析入口 resolveIncomingRelPath（虚拟前缀反解到工作区真实路径，其余限 configDir 内；写入/读取/副本/推盘/墓碑跟随全走此口）；tasks.json 条目级合并（mergeArrayFile 按 id，version 取大）；settings.json 字段级三方合并改白名单传播制（仅 SETTINGS_SYNC_FIELDS 逐字段与基线比，白名单外保本端）；syncOptions 重建时 userSyncPaths 走 rev-LWW 整组
- `merge-records.ts` — JSON 记录级合并原语（mergeRecordMapFile 键控挑新/mergeArrayFile 按 id 挑新/mergeWorkspacesFile 工作区注册表合并）；workspaces.json 先例，tasks.json 同构复用
- `sync-state.ts` — sync-state.json（deviceId/per-peer 基线与选项/地址记忆 lastHost·lastPort/全局 tombstones 90 天 TTL 上限 2000），withSyncStateLock 进程锁
- `tombstone.ts` — 删除传播执行单元：applyPeerTombstones（对端删本端跟随，虚拟条目经统一反解删工作区真实文件）/propagateLocalDeletes（本端删驱动对端）；删改冲突保守保留修改侧、不参与冲突裁决
- `ws-tree.ts` — 同步范围工作区目录树服务：单层懒加载 listWorkspaceDirForSync + 子树规模统计 statWorkspaceDirForSync（2 万文件上限截断）+ hasGitDir；段安全校验与 manifest 同规则，隐藏 .git/.dogear/dotfile，symlink 跳过，node_modules/dist 显示（一期无自动识别，靠 UI 大小提醒兜底）

不变量：settings.json 永不参与墓碑与覆盖删除（含配对密钥），且白名单外顶层字段（snapshot/backup/ui/profiles/browserProxyServer/migrated/webMcpApiKey 及未知新字段）一律保本端，syncOptions 内部走 rev 组 LWW 特判；墓碑生成两处对称（orchestrator 主动端 + server handleManifest 被动端，共用 tombstoneCandidates）；isExcluded 是清单/diff/apply/push guard 四处唯一排除判定；`__ws-external__` 落盘/读盘唯一入口 resolveIncomingRelPath（未注册 wsid skipped 警告不落垃圾目录）

## 统一运行注册表（services/）

- `background-activity-service.ts` — 内存单例：三类后台任务（定时/状态抽取/文章解析）reportRunning/reportDone/getRunning；getSchedulerActivity 与执行历史「正在运行」区数据源；各源终态写 run-history（source 区分）；协作任务已退出（执行会话与任务状态机自身即完整记录）

## 话题状态卡与记忆（services/memory/）

- `background-store.ts` — 话题状态卡读写（`<wsData>/groups/<groupId>/background.md`，条目化 schema；纯数据/合并逻辑在 state-card.ts，本文件负责 IO 与用户/管理入口）；组目录结构唯一权威源
- `state-card.ts` — 状态卡纯数据层：类型 + zod 增量 schema + 解析/序列化 + 合并函数（模型只产增量，合并全为纯代码；旧格式不再解析）
- `state-extract-trigger.ts` — 状态卡读时同步的抽取触发编排（submitTask + in-flight 按组去重 + ensureGroupFresh）；state-extract-prompt.ts 为抽取提示词
- `memory-service.ts` / `memory-recall` / `memory-fs` / `memory-indexer` / `memory-loader` / `memory-types` — 工作区主题记忆（检索/索引/文件层；存 config `workspaces/{id}/memory`，已从项目工作区迁入）；公开面经 index.ts barrel 导出

## Store 与类型

- `stores/scheduler-store.ts` — 定时任务前端（tasks/activity/history + RPC 封装失败 toast）
- `stores/sync-store.ts` — 设备同步前端（peers 恒为合并快照含离线已配对常驻/status/运行进度/scanning 寻找设备态/scan·unpair action，syncEvent 广播事件驱动 + 完成 toast 含删除/删改冲突计数）
- `types/scheduler.ts` / `types/usage.ts` — 定时任务 / 用量数据模型（主进程镜像在各自 service）
- `hooks/use-visible-polling.ts` — 数据中心统一轮询钩子（可见才轮询，恢复可见立即拉齐）

## 注意

- 各 panel 只自持 `workspaceId: 'all' | id` 筛选状态，不读 workspace-store；轮询统一走 useVisiblePolling
- 版本与备份面板：配置写回走 settings-store saveSettings 整体写回（先读最新 settings 再改 backup 节）；备份状态行 scope 可能是非注册工作区目录（如 personal），显示时用 nameById 回退到 scope 原文；恢复操作必须 showConfirm 且恢复是快照还原语义（快照外新增文件会被删，恢复前主进程自动预备份）
- 设备同步面板：同步项开关写 settings.syncOptions（disabledSyncItems 经 normalize 强制滤除 required 项，settings.json 不可关）；结果卡里删改冲突是「已保守保留」的既定结果、与可裁决的 conflicts 分开展示
- getUsage 懒重算 usageSummary 后读 JSONL；'all' 模式逐工作区聚合每行带 workspaceId 归属
- 状态卡抽取触发与未提炼列表一律排除调用者自身（excludeConversationId 链），自身内容由下一会话开局补抽
- 后台任务接入统一历史时遵守顺序纪律：先写历史再 reportDone（UI 轮询视角 done 即历史可见）；写史 try/catch 失败不影响任务本身；解析历史的 history.jsonl 写入保留作 agent 诊断数据源

## 数据流

- 应用数据备份：分类×scope → registry backupSourcesFor 取源 → 主进程锚点反解+stat → worker 线程打包写 `backups/<scope>/` → last-run 记录结果 → 面板红字/徽标可见；恢复反向：预备份 → 解压写回 → 快照外删除
- 设备同步：discovery 发现（mDNS ∪ 已配对地址探测，已配对设备常驻在线/离线态）→ pairing 配对（成功即记地址）→ runSync（orchestrator）：buildManifest → diff（含双向墓碑判定）→ pull（对端拉）/push（本端推、对端 push-guard 校验）/删除传播（DELETE /file 或本地 unlink）→ SyncReport 经 syncEvent 广播到结果卡；被动端 server 独立响应 /manifest 与 /file
- 话题状态卡：会话开启时 state-extract-trigger 检测滞后会话起 STATE_EXTRACT 任务 → agent-worker → tasks/state-extract-task（pi runOnce）→ emit_state_increment 结构化增量 → 纯代码合并落 background.md；读取时 dogear__ReadGroupBackground 经 ensureGroupFresh 现场补齐滞后会话后返回唯一最新卡；跨话题检索动线 ListTopics → ReadGroupBackground → ReadReferenceSession
- 话题面板 UI（状态卡渲染/共享文件）见 chat.md TopicPanel；会话内用量徽章见 chat.md usage-badge
