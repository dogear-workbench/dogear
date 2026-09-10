# 话题状态卡（新会话开局注入）设计

**日期**：2026-09-10
**状态**：已拍板（多轮讨论收敛）
**参考**：调研报告见会话组共享区 `research/session-group-architecture.md`、`research/pi-ai-capabilities.md`

## 背景

现有"话题背景"体系的根本问题：

1. **读取侧零逻辑**：新会话 `start()` 注入的组上下文不含 background.md（group-context-builder.ts:14-38 只拼组标题+共享区静态文案），背景全靠 agent 自觉调 `ReadGroupBackground`——实际表现就是失忆，用户每个新会话重复解释背景。
2. **异步提炼滞后**：组卡提炼靠定时窗口/会话关闭/手动触发，模型整卡重写，新会话读到的常是旧状态。
3. **错误全文级传播**：background/digest 均为模型整卡覆盖写，无来源、无留痕，抽错就整篇歪。
4. **用户在 Agent 外的行动无痕迹**：总结把"建议过"写成"已完成"。

**目标**：新会话开局快速知晓话题现状——不失忆、不重复解释、不乱试探。接受"开局一次、尽量准确的大方向"，不追求每轮强一致。

## 架构

### 核心决策：一条触发路径 + 一次注入 + 逐会话增量抽取

```
开启新会话（attach/start 同步链上，唯一触发点）
  → 判 staleness：状态卡 sourcesSeen vs 会话 JSONL 当前内容
     ├─ 新鲜 → 直接注入状态卡（常态，零模型成本）
     ├─ 轻度滞后（≤2 个会话有未提炼新增）→ 同步逐会话抽取，封顶等待 ~10s → 注入新鲜
     └─ 重度滞后 → 不等：注入旧状态 + 严重滞后标注 + 最近会话标题列表，后台抽取
会话中：零同步逻辑。agent 需要最新自己调 ReadGroupBackground（读文件天然最新）
```

### 数据模型：改造 background.md 为条目化状态卡，不新增流水文件

```
groups/<gid>/background.md
  frontmatter: { groupId, updatedAt, sourcesSeenJson }
  topic 段（身份层，低频）
    text + history[]（版本链：{text, source: session|user, ts}，可回滚）
  条目区（动态，增量合并）
    completed / inProgress / decisions / blockers / nextSteps / openQuestions
    每条 {id, text, source: sessionRef#uuid | user, ts}
```

- **事实层不新建**：conversations.json（元数据事实）+ 会话 JSONL（内容事实）+ 状态卡 user 条目（用户事实）已构成事实源。"最近活动"列表注入时从 conversations.json 现场派生，不持久化。
- digest.md 组卡**不动**：降级为纯展示层，与状态卡彻底解耦。现有定时提炼任务照旧（只负责 digest.md）。

### 背景（topic）保障

- 模型抽取默认不碰 topic；抽到用户原话证据才输出 topicChange 增量。
- **用户原话来源 → 直接生效；模型推断 → TopicPanel 待确认**（小红点，用户点确认才合入）。
- 版本链留痕，写坏可回滚；TopicPanel 手动编辑入口保留但纯兜底，方案不依赖它。
- 首个会话结束前 background 为空是合法状态；第一次抽取确立初始 topic。

### 抽取机制

- **逐会话一次 runOnce**（便宜模型，新用途档位照抄 categorize 模式 + 三级回退）。
- 输入 = 该会话上次提炼位置之后的新增 entry（readSessionBranchEntries + transcript-adapter，均现成）**+ 该会话已产出的旧条目**（供条目状态迁移：输出"X 已完成"，合并时代码把条目从 inProgress 移到 completed）。
- 输出 = zod schema 约束的条目增量（tool call 形式），每条一句话 + 来源 uuid；可选 topicChange。
- 合并 = 纯代码（append / 去重 / 条目迁移），**模型永远不碰存量条目**。
- 没变的会话靠 sourcesSeen 永不再读；成本只花在新增内容上。
- **无闲置判定**：JSONL append-only，读到哪算哪，后续新内容下次开启会话时追补——不是循环，是正常增量。

### 注入格式（systemPrompt 直注，扩展 group-context-builder）

```
【话题背景】（确立于 X，用户确认/来自会话Y）
…

【当前状态】（提炼至 X · 另有 N 个未提炼会话）
- 进行中：…（来源A）  已完成：…  下一步：…  阻碍：…  已拍板：…

【最近未提炼会话】
- 时间「标题」…

【指引】未提炼会话中可能有更晚的事实，关键决策先与用户确认；
需要最新状态可调 dogear__ReadGroupBackground；需深挖某会话可用 ReadReferenceSession。
```

### 用户侧入口

- ChatInputArea 底部工具行（ChatInputArea.tsx:429）加快捷按钮：「记一笔 / 这事做完了」——直接写状态卡条目（source: user），零模型成本。
- TopicPanel 话题背景 Section 改渲染状态卡（条目化 + 待确认 topicChange 提示），复用 groupDataChanged 广播自动刷新。

### 排除的选项（及原因）

| 排除项 | 原因 |
|---|---|
| activity.jsonl 活动流水 | 与 conversations.json + JSONL 重复建设 |
| 三文件模型（activity/status/background 分离） | MVP 过度 |
| 会话结束 hook 预热 | 用户无关闭习惯，命中率低；没人读就白花 |
| 轮次级同步（版本跟踪/每轮比对/steer 补达） | 强一致过度设计，产品只需开局不失忆 |
| 闲置 5 分钟判定 | 触发点收缩到"开启会话"后无必要（append-only 追补安全） |
| 状态机（未初始化/进行中/等待决策…） | MVP 不需要 |
| 走纯文本 JSON 输出 | pi-ai 无 response_format，无格式保证；走 tool call + zod parse |

## 模块边界

| 模块 | 文件 | 改动 |
|---|---|---|
| 状态卡存储 | electron/main/services/memory/background-store.ts | schema 重构：条目区 + topic 版本链 + sourcesSeen + 条目合并代码 |
| 注入 | electron/main/services/…/group-context-builder.ts | 扩展：读状态卡 + staleness 判定 + 模板拼装 |
| 抽取任务 | electron/main/agents/agent-worker.ts + task-types.ts | 新 TaskType（增量抽取 handler，逐会话 runOnce） |
| 模型档位 | electron/main/services/settings-types.ts | 新用途档位（照抄 categorize） |
| 触发与编排 | conversation-runtime-service.ts / pi-session start 链 | 开启时判 staleness → 同步轻抽（封顶）/ 异步重抽 |
| 注入读取工具 | electron/main/agents/tools/reference-tools.ts | ReadGroupBackground 适配新 schema |
| 用户按钮 | components/agent-chat/ChatInputArea.tsx + 新 IPC | 记一笔/标记完成 → 写状态卡 user 条目 |
| 前端展示 | components/TopicPanel.tsx | 状态卡渲染 + topicChange 待确认交互 |

## 数据流

```
[写路径1] 开启新会话 → 判滞后 → runOnce(新增entry+旧条目) → zod增量 → 代码合并 → 写状态卡 → 广播
[写路径2] 用户按钮 → IPC → 直接追加 user 条目 → 写状态卡 → 广播
[读路径1] 开启会话 → 读状态卡 + conversations.json 派生标题列表 → systemPrompt 注入
[读路径2] 会话中 agent 调 ReadGroupBackground → 读文件（天然最新）
[展示]   TopicPanel ← groupDataChanged 广播
```

## 错误处理 / 边界情况

- 同步抽取超时（>10s）→ 立即降级注入旧状态 + 滞后标注，后台继续抽。
- 抽取失败 → 状态卡保持旧版 + 滞后标注，最坏退化为现状（不比现在差）。
- 挂着的活跃会话被抽到半截 → 追补机制自然修正（条目迁移）。
- conversations.json 写路径必须走 withConversationTransaction。
- 背景 schema 变更需同步两个消费者（TopicPanel、ReadGroupBackground 工具）。
- 广播复用 broadcastGroupDataChanged，前端自动刷新通路现成。

## 未决问题（实施时定）

- 条目注入裁剪：每类最多几条、总 token 上限。
- 字段集终版：openQuestions 与 uncertainties 是否合并、是否要 nextSteps。
- 轻度/重度滞后阈值（≤2 算轻度的具体值）。
- topicChange 待确认的 UI 具体形态。
- constrainedSampling 透传（provider 端硬约束）做不做——zod parse 兜底已够，可后补。
```
