# 话题状态卡：读时同步与旧双轨清理 设计

**日期**：2026-09-11
**前置**：docs/plans/2026-09/2026-09-10/topic-state-card-design.md（已实施完毕，任务 sydrho9o）

## 背景

状态卡系统上线后，生产环境暴露出四个问题：

1. **开局同步等待阻塞输入**：`pi-session.ts start()` 上 `await triggerStateExtractForSessionStart()`，未提炼 ≤2 时同步等抽取封顶 10s。实测单会话抽取需 30s~1min+，10s 几乎必超时——该分支唯一作用是白等 10 秒再降级。期间输入框被 `isSessionReady` 锁住、新会话 UI 不出现（预 attach 在选中之前）。任务执行会话（task-queue.ts:221）与微信 bot 会话（wechat-bot-controller.ts:291）同吃等待税。
2. **条目无退休机制**：增量 schema 的 `resolved` 只做 inProgress→completed 迁移。生产卡中「待议：Step 5 待验收收尾」（legacy）与「已完成：任务已申报」（新抽取）矛盾并存；「已拍板」区 legacy 7 条与抽取 10 条大量重叠。卡片只长肥，新旧矛盾。
3. **双轨抽取重复成本**：STATE_EXTRACT 逐会话抽取与 group_digest 定时全量提炼读同一批逐字稿各抽一遍。
4. **话题命名挂在旧轨上**：话题标题由 SaveGroupDigest 顺带 `updateGroup(title)`（group-digest-tools.ts:139），砍旧轨后命名断粮。

## 目标

- 新会话秒开，零等待
- agent 拿到的第一份状态卡永远是读时同步后的最新版，且只拿一份（不读两遍）
- 条目可退休，卡片不积累矛盾
- 砍掉 group_digest、review 两个定时任务及报告体系，话题命名迁入状态卡链路

## 架构（核心做法）

**分工原则：systemPrompt 只负责「你是谁、在哪个话题」，工具负责「话题现在怎么样」。**

### 拍板决策

1. **砍开局同步等待**：`triggerStateExtractForSessionStart` 删除 sync 分支（≤2 同步等待），开局一律不触发抽取。stale 检查仅用于注入轻量头的标注。会话启动链回归亚秒级。
2. **开局注入统一轻量头**：不再直注完整状态卡。注入内容 = 话题一句话（topic）+ 未提炼会话标题列表（零模型派生，保留）+ 强指引「开局第一轮先调 dogear__ReadGroupBackground 获取话题最新状态」。fresh（零未提炼）也走此形态——完整卡不进 systemPrompt，省注入 token，换取 agent 一次本地工具调用（几百毫秒）。
3. **ReadGroupBackground 读时同步**：调用时查 staleness → fresh 直接返回现有卡；stale 触发抽取（复用按组 in-flight 去重，不重复提交）→ 等待完成返回最新卡。超时兜底 ~120s：返回现有卡 + 明示「以下为 X 时刻状态，N 个会话未提炼未能同步」。工具描述写明语义（可能等待 30s~2min），返回带提炼时间与未提炼列表。
4. **resolved 扩展跨类退休**：`StateIncrementSchema.resolved` 从「仅 inProgress→completed 迁移」扩展为跨类标记——被取代的旧条目（含待议/已拍板区）可标记解决。落盘形态：从原类移除，记入已完成区并注明「（已解决，被取代）」或直接移除（实施时定，倾向前者保留痕迹）。
5. **抽取提示词约束**：a) 只抽本话题内事实，跨话题稳定信息（长期偏好、身份）不抽——那是记忆系统职责；b) 引导模型标记被本次内容取代的旧条目进 resolved；c) 按条目格式，不写散文。
6. **话题命名迁移**：a) 首次命名——组 title 为空时，STATE_EXTRACT 抽取顺带产出话题名（一次性，title 非空不再碰，同 autoUpdateTitleFromFirstMessage 的「仅默认时执行」逻辑）；b) 后续改名——走已有 topicChange 待确认机制（用户原话带 quote → pendingTopicChanges → 用户在 TopicPanel amber 卡确认 → 生效时联动 `updateGroup(title)`）。
7. **砍 group_digest 定时任务**：scheduler BuiltinTaskId 删 group_digest；删除 group-digest-trigger/scanner/prompt、group-digest-tools 工具组。共享函数（getGroupDir/mergeSourcesSeen/GroupDigestSourceSeen）迁出 group-digest-store 到 background 侧，digest-store 本体删除。
8. **砍 review 定时任务与报告体系**：BuiltinTaskId 删 review；删除 review-trigger/store/prompt/scanner、review-tools 中 ListDigests/ReadDigest/TraceSource/ReadReport/WriteReport；前端 TopicPanel「组卡提炼」区删除、数据中心 DigestsPanel 及报告展示删除。磁盘上既有 digest.md/报告数据不删（用户数据不动）。
9. **会话标题不联动话题改名**：会话标题是历史记录（首条消息自动生成，可手改），话题标题是活的，层级展示各司其职。
10. **用户既有 plan 数据清理**：内置任务下线后，用户 plan 列表中 group_digest/review/categorize/categorize_organize 项过滤隐藏（数据保留，实施时看 plan-store 结构定）。
11. **砍智能分组全链**：scheduler 再删 categorize/categorize_organize 内置任务；删 category-trigger/smart-category-engine/smart-category-store/categorize-prompt 与 ListCategories/SaveCategory* 工具；前端删会话列表 SmartSection 分类视图与数据中心分类面板，会话列表回归话题平铺。categories.json 磁盘数据保留。理由：分组输入本就依赖 digest.md（Step 5 后断粮）；消费面全是人肉导航入口，用户检索路径已 agent 化（新起会话问 agent），分类层无受众。
12. **新增零模型「列出话题」工具**（dogear__ListTopics，挂 reference-tools）：读 groups.json + 各组状态卡 topic 一句话/组标题 + 更新时间 + 会话数，纯本地 IO。补 digest 工具组下线后的跨话题检索空缺——agent 动线：ListTopics 定位话题 → ReadGroupBackground 拿现状 → ReadReferenceSession 下钻原文。

### 排除的选项（及原因）

| 排除项 | 原因 |
|---|---|
| 管线强制同步（等抽取完再开局） | 单会话抽取 30s~1min+，10s 封顶必超时；用户体验已实际否决 |
| 插话补达（steer 中途推送新卡） | 滞后标注+指引承担「有新东西」的信号投递，内容靠工具拉取；省掉 UI 形态/打断感/无关 token 成本。steer 通道存在（pi-session.ts:950）但不启用 |
| 开局两态注入（fresh 直注完整卡 / stale 轻量头） | 被「统一轻量头」取代：少一个分支，fresh 时更省 token，agent 手里永远只有工具返回的一份卡 |
| 背景段结构化（目标/范围/约束/偏好字段化） | 话题卡就事论事只管话题内事实；长期偏好归记忆系统（dogear__SaveMemory）。提示词约束即可 |
| 轮次级同步 | 沿用上期排除理由：过度设计 |
| group_digest 降频保留 | 与状态卡同原料重复抽取，无独立价值；报告体系价值已被多处刮走（用户拍板） |
| 智能分组改造为基于状态卡分类 | 分组是给人肉导航设计的，用户检索路径已 agent 化，改完仍无受众 |
| 话题命名纯代码截取首条消息 | 首条消息不概括话题（例：「刚刚是等待时间？」）；抽取链路本就读逐字稿，顺带命名零额外成本 |

## 模块边界

| 模块 | 文件 | 改动 |
|---|---|---|
| 触发器 | electron/main/services/memory/state-extract-trigger.ts | 删 sync 分支与 SYNC_WAIT_MS；保留 submitExtractTask + in-flight 供读时同步复用；导出「等待组最新」接口 |
| 注入 | electron/main/agents/group-context-builder.ts | 注入模板改轻量头（topic + 未提炼标题 + 强指引） |
| 工具 | electron/main/agents/tools/reference-tools.ts | ReadGroupBackground 读时同步：查 staleness → 抽取等待 → 返回卡+提炼时间+未提炼列表；超时兜底 |
| schema | electron/main/services/memory/state-card.ts | resolved 跨类退休语义 + 合并逻辑 |
| 提示词 | electron/main/services/memory/state-extract-prompt.ts | 范围约束 + 退休引导 + 首次命名输出 |
| 命名联动 | electron/main/services/memory/background-store.ts（confirmTopicChange）+ 抽取 handler | title 空→首次命名生效；确认 topicChange→updateGroup(title) |
| scheduler | electron/main/services/scheduler/types.ts、builtin-task-meta.ts、plan-runner.ts、task-executor.ts、plan-store.ts | 砍 group_digest/review 内置任务 + 既有 plan 过滤 |
| digest/review 模块删除 | electron/main/services/memory/group-digest-*.ts、review-*.ts；electron/main/agents/tools/group-digest-tools.ts、review-tools.ts | 删除；共享函数迁移；review 工具组中记忆/core-profile 工具不属于 review 的保留 |
| 前端 | components/TopicPanel.tsx、app/data-center/digests-panel.tsx 及报告相关 | 组卡区/组卡列表/报告展示删除 |
| 智能分组删除 | electron/main/services/memory/category-trigger.ts、smart-category-engine.ts、smart-category-store.ts、categorize-prompt.ts；electron/main/agents/tools/（categorize 工具）；components/conversation-list/SmartSection.tsx、app/data-center/smart-category-panel.tsx、stores/smart-category-store.ts | 删除；scheduler 对应 case 同步删 |
| 新工具 | electron/main/agents/tools/reference-tools.ts | dogear__ListTopics：零模型列话题（组标题/topic/更新时间/会话数） |
| 触发点残留 | pi-session.ts start() | triggerStateExtractForSessionStart 调用移除（轻量头的 stale 标注由 group-context-builder 现查） |

## 数据流

```
[开局]  新会话 start() → group-context-builder 查 staleness → 注入轻量头（topic+未提炼标题+指引）
[读时]  agent 调 ReadGroupBackground → stale? → 复用/触发抽取（逐会话 runOnce）→ 等待 → 返回最新卡
[抽取]  逐字稿+现有卡 → 便宜模型 → 增量（条目+resolved+topicChange+首次命名）→ 代码合并 → background.md
[命名]  title 空 → 抽取产出直接生效；topicChange → pendingTopicChanges → 用户确认 → updateGroup(title)
[用户]  记一笔/这事做完了按钮 → user 条目直写（不变）
[退休]  增量 resolved → 旧条目跨类移除/标记 → 卡片不积累矛盾
```

## 错误处理 / 边界情况

- 读时同步超时（~120s）：返回现有卡 + 明示未同步（不比现状差）
- agent 不调工具（指引非硬约束）：兜底 = 轻量头里的 topic 身份 + 未提炼标题 + 「状态滞后」警告；最坏退化为无背景开局，不差于旧系统
- 抽取失败：sourcesSeen 不推进，可幂等重抽（不变）
- 并发：同组 in-flight 去重（开局已无触发，读时多会话并发调工具靠 in-flight 合并）
- 微信 bot / 任务执行会话：同样走轻量头 + 读时同步，等待税消失
- 既有 digest.md / 报告数据：磁盘保留，前端不再展示

## 未决问题（实施时定）

- 读时同步等待上限具体值（~120s）
- resolved 落盘形态：移除 vs 移入已完成区带「已解决」标记
- 既有用户 plan 数据的过滤方式（隐藏 vs 清理）
- 轻量头指引措辞的强度与措辞
- 模型档位：读时同步触发的抽取沿用 STATE_EXTRACT 现有档位（应无需新增）
