# 后台任务统一执行历史 设计

**背景**：数据中心「执行历史」目前只承载定时任务；话题状态卡抽取（STATE_EXTRACT）完全不可见且 token 用量丢失（runOnce 返回 usage 但未传出），文章 AI 解析散在独立「解析历史」tab，协作任务执行只有任务面板状态、无执行流水。目标：执行历史成为所有不在主会话中进行的后台 agent 任务的统一历史。

**目标**：
1. 四类任务统一入史：定时任务 / 状态抽取 / 文章解析 / 协作任务
2. 删「解析历史」tab（数据中心五 tab → 四 tab）；`history.jsonl` 写入保留（解析 agent 用 `dogear__ReadParseHistory` 看规律性失败，是诊断数据源）
3. 统一「正在运行」活动注册表（内存态）
4. 补 STATE_EXTRACT 用量采集

**架构**：
- 数据模型：`RunHistoryEntry` 加 `source: 'scheduler' | 'state-extract' | 'parse-article' | 'collab-task'`；旧 JSONL 条目读侧缺省 `'scheduler'`，无迁移。`planName` 字段名不动、语义泛化为任务名。`summary/error/tokens` 结构不动，各任务自己填「结果」，不引入摘要概念。
- 新建 `services/background-activity-service.ts`：内存单例注册表。`reportRunning({key, source, name})` / `reportDone(key)`，写历史由调用方在终态回调处自己做，注册表只管运行态；`getRunning()` 供 IPC 轮询。
- tokens 口径：无会话载体的后台任务（scheduler 现有 / state-extract 新补）记 tokens；协作任务执行会话用量已归会话维度统计、PARSE_ARTICLE 走 Claude SDK 无现成 usage 汇总，两者历史条目不带 tokens（避免双计与过度改动）。

**模块边界**：

主进程：
- `services/scheduler/types.ts` — RunHistoryEntry + source 字段与 RunHistorySource 类型
- `services/scheduler/run-history-store.ts` — queryHistory 加 source 筛选
- `services/scheduler/runtime/plan-runner.ts` — 写历史带 source='scheduler'；运行态改走统一注册表
- `services/scheduler/scheduler-service.ts` — missed 条目带 source；getActivity 改读统一注册表
- `services/background-activity-service.ts` — 新建（运行注册表单例）
- `services/memory/state-extract-trigger.ts` — 提交时注册运行、终态写历史（含 tokens）
- `agents/agent-worker.ts` — handleStateExtractTask 跨会话累加 runOnce usage 放进返回值
- `tipc/article.ts` — PARSE_ARTICLE 终态写历史 + 运行注册；删 getParseHistory 路由
- `services/task-service.ts` — interruptTask / rejectTask / reportTaskResult 状态迁移处写协作任务历史
- `tipc/scheduler.ts` — listRunHistory 加 source 参数；活动查询改读统一注册表

渲染层：
- `types/scheduler.ts` — 镜像类型
- `stores/scheduler-store.ts` — history 查询带 source 筛选
- `app/data-center/page.tsx` — 删解析历史 tab
- 删 `app/data-center/parse-history-panel.tsx`
- `app/data-center/history-panel.tsx` — 类型筛选下拉替换「按任务筛选」；运行区数据源换统一注册表
- `app/data-center/HistoryEntryCard.tsx` — 类型徽章
- `app/data-center/history-utils.ts` — SOURCE_META（label / 颜色）
- `lib/client.ts` — 删 getParseHistory 方法

**数据流**：
- 写入：任务提交时 reportRunning → 终态回调组装 RunHistoryEntry（source / planName / summary=结果 / error / tokens）→ appendHistoryEntry → reportDone
- 读取：HistoryPanel → scheduler-store → client.listRunHistory({source?}) → queryHistory
- 运行中：HistoryPanel 10s 可见轮询 → getActivity → background-activity-service.getRunning()

**错误处理 / 边界情况**：
- 写历史失败 catch + log，不影响任务本身
- app 重启运行中条目自然消失（内存态，与 scheduler 现状一致）；中断的 STATE_EXTRACT 不补记（无 cursor 概念）
- STATE_EXTRACT 读时同步超时后任务仍在后台跑：终态回调仍触发，历史正常写
- 协作任务 rejected 映射 failed 状态（详情注明拒绝原因），不扩状态枚举
- 协作任务多轮执行（中断后继续再申报）自然形成多条历史，符合执行流水语义
- 状态筛选五选项不变；类型筛选走后端 queryHistory 参数，非前端过滤

**未决问题**：无
