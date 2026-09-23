# 数据中心域（data-center）

数据中心四面板（用量/定时计划/执行历史/记忆）、话题状态卡、主题记忆、会话用量采集。数据中心是主窗口固定 tab，可弹独立窗口。

## 面板（app/data-center/）

- `page.tsx` — 骨架：四 tab 下划线导航（用量/定时计划/执行历史/记忆）；scheduler tab forceMount（编辑草稿切 tab 不丢）；workspaces 由页面加载一次下传
- `usage-panel.tsx` — 用量面板：时间分页（今日/7天/30天/全部）；'all' 后端聚合+会话列表逐工作区拉取合并
- `history-panel.tsx` — 执行历史一级面板：类型/状态筛选（类型走后端 source 参数）、10s 可见轮询、分钟 tick 刷新；「正在运行」区显示四类后台任务
- `history-utils.ts` / `HistoryEntryCard.tsx` — 执行历史格式化与条目卡片（SOURCE_META 四类徽章，无 source 旧条目归 scheduler）
- `memory-section.tsx` — 记忆 tab 容器：筛选+重建索引按钮+两节 Tabs
- `version-backup/` — 版本与备份面板：VersionBackupPanel（tab 容器：状态加载 30s 可见轮询 + 分类配置写回 settings + 全部备份/打开目录 + 逐项运行 loading）、GitSummarySection（用户 Git 仓库/自动快照两卡按工作区聚合只读展示，卡片副标题名词解释，快照统计两行不截断，git 缺失降级「未安装 git」）、CategoryCard（开关/频率/保留份数 + 每 scope 状态行/到期徽标/立即备份 + 备份列表展开与恢复 showConfirm；scope 名 personal→临时会话区、未注册目录加徽标与 tooltip）、backup-meta（分类元数据与默认值、tipc client 类型推导、格式化）
- `core-profile-panel.tsx` — 核心画像编辑面板
- `topics-panel.tsx` / `topics-list.tsx` / `topic-editor.tsx` / `memory-types.ts` — 主题记忆列表+编辑器（slug 校验/覆盖确认/删除二次确认）
- `scheduler/` — 定时计划组件：SchedulerPanel（列表/编辑态切换）、TaskEditorPage（二级页：名称/提示词/模型/工作区/工具/触发器）、CustomToolPacksSection（生效集=toolPacksOverride ?? 工作区启用集）、TriggerListEditor/TriggerRow/TriggerControls、utils（describeTrigger 等）

## 用量（services/usage/）

- `usage-extractor.ts` — 从 result 提取 ConversationUsageEntry 纯函数（contextWindow 查目录表、模型缺失合成、工具/子代理聚合）
- `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，轻量扫描聚合 readUsageSince）

## 定时计划（services/scheduler/）

- `types.ts` — 数据模型（Trigger 八种含 on_task_done 任务链）
- `time-rule-engine.ts` — 时间规则纯函数（validateTrigger/nextDueAt/detectMissed/describeTrigger）
- `plan-store.ts` — `.dogear/plans.json` 读写（version:2 容器；旧数组自动拆条迁移；builtin 存量条目过滤隐藏）
- `plan-validate.ts` — 保存校验（on_task_done 目标存在性+环检测、toolPacksOverride 白名单清洗）
- `scheduler-service.ts` — 调度核心（分钟级 tick、窗口状态机、handleAppStart/handleSessionClose 入口、错过记 missed 不补跑）
- `run-history-store.ts` — `.dogear/run-history/YYYY-MM.jsonl` 按月追加+倒序分页+保留 3 个月；source 四类筛选（无 source 旧条目读侧归 scheduler）
- `custom-agent-prompt.ts` / `custom-agent-tools.ts` — CUSTOM_AGENT 提示词模板与工具集组装（toolPacksOverride 完全替代语义）
- `runtime/plan-runner.ts` — 单任务执行器（防重入、断点补记、requestStop 带来源）
- `runtime/task-executor.ts` — 提交 CUSTOM_AGENT 到 agent-manager Worker 池，用量提取入历史

## 统一运行注册表（services/）

- `background-activity-service.ts` — 内存单例：四类后台任务（定时/状态抽取/文章解析/协作）reportRunning/reportDone/getRunning；getSchedulerActivity 与执行历史「正在运行」区数据源；四类终态各自写 run-history（source 区分）

## 话题状态卡与记忆（services/memory/）

- `background-store.ts` — 话题状态卡读写（`<wsData>/groups/<groupId>/background.md`：topic 版本链+六类条目+sourcesSeen；旧结构读时迁移）；组目录结构唯一权威源
- `transcript-cleaner.ts` — 会话 JSONL 确定性去噪（剥工具结果/系统行/思考块，保留用户+助手文字）
- `source-fidelity.ts` — 状态卡引用保真度校验（uuid_not_found/wrong_session/session_missing 三类）
- `review-skill-service.ts` — 历史 no-op 遗留（空实现仅为启动序列兼容）
- `memory-service.ts` / `memory-recall` / `memory-fs` / `memory-indexer` / `memory-loader` / `memory-types` — 工作区主题记忆（检索/索引/文件层；存 config `workspaces/{id}/memory`，已从项目工作区迁入）

## Store 与类型

- `stores/scheduler-store.ts` — 定时任务前端（tasks/activity/history + RPC 封装失败 toast）
- `types/scheduler.ts` / `types/usage.ts` — 定时任务 / 用量数据模型（主进程镜像在各自 service）
- `hooks/use-visible-polling.ts` — 数据中心统一轮询钩子（可见才轮询，恢复可见立即拉齐）

## 注意

- 各 panel 只自持 `workspaceId: 'all' | id` 筛选状态，不读 workspace-store；轮询统一走 useVisiblePolling
- 版本与备份面板：配置写回走 settings-store saveSettings 整体写回（先读最新 settings 再改 backup 节）；备份状态行 scope 可能是非注册工作区目录（如 personal），显示时用 nameById 回退到 scope 原文；恢复操作必须 showConfirm 且恢复前主进程自动预备份
- getUsage 懒重算 usageSummary 后读 JSONL；'all' 模式逐工作区聚合每行带 workspaceId 归属
- source-fidelity 校验口径必须与 agent 所见一致：复用同一去噪函数建 uuid 索引，不用 JSONL 全量
- 状态卡抽取触发与未提炼列表一律排除调用者自身（excludeConversationId 链），自身内容由下一会话开局补抽
- 内置定时任务已全量下线：存量 builtin 条目由消费侧过滤隐藏、拒删；plan-store 读全量依赖（写路径需要）
- 四类后台任务接入统一历史时遵守顺序纪律：先写历史再 reportDone（UI 轮询视角 done 即历史可见）；写史 try/catch 失败不影响任务本身；解析历史的 history.jsonl 写入保留作 agent 诊断数据源

## 数据流

- 话题状态卡：会话开启时 state-extract-trigger 检测滞后会话起 STATE_EXTRACT 任务 → agent-worker pi runOnce → emit_state_increment 结构化增量 → 纯代码合并落 background.md；读取时 dogear__ReadGroupBackground 经 ensureGroupFresh 现场补齐滞后会话后返回唯一最新卡；跨话题检索动线 ListTopics → ReadGroupBackground → ReadReferenceSession
- 话题面板 UI（状态卡渲染/共享文件）见 chat.md TopicPanel；会话内用量徽章见 chat.md usage-badge
