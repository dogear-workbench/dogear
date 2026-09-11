# 话题状态卡：读时同步与旧双轨清理 实施计划

**目标**：新会话秒开、agent 读时拿到唯一最新状态卡、条目可退休、砍掉 group_digest/review 双轨并迁移话题命名。

**架构思路**：systemPrompt 只负责「你是谁、在哪个话题」（轻量头），完整状态卡一律经 ReadGroupBackground 读时同步获取（stale 则复用 in-flight 触发抽取并等待）。开局同步等待分支删除。旧 digest/review 双轨整体下线。设计全文见 [topic-state-sync-design.md](../topic-state-sync-design.md)。

**涉及模块**：state-card.ts / state-extract-prompt.ts / state-extract-trigger.ts / reference-tools.ts / group-context-builder.ts / pi-session.ts / background-store.ts / scheduler（types/builtin-task-meta/plan-runner/task-executor/plan-store）/ memory 下 group-digest-*.ts 与 review-*.ts 删除 / 前端 TopicPanel.tsx、app/data-center/digests-panel.tsx

## 步骤索引

- [x] [Step 1: schema 与提示词地基](./step1-schema-prompt.md) — resolved 跨类退休 + initialTitle 字段 + 抽取提示词三处约束
- [x] [Step 2: 读时同步核心链路](./step2-read-sync.md) — 删触发器 sync 分支 + ReadGroupBackground 读时同步
- [x] [Step 3: 注入轻量化](./step3-light-inject.md) — 开局只注轻量头，start() 移除触发调用
- [x] [Step 4: 话题命名联动](./step4-naming.md) — 首次命名生效 + topicChange 确认联动 updateGroup
- [x] [Step 5: 旧轨下线（digest/review）](./step5-remove-legacy.md) — 砍 group_digest/review 定时任务、删模块、前端清理
- [x] [Step 6: 智能分组下线与跨话题检索](./step6-categorize-topics-tool.md) — 砍 categorize 全链 + 新增零模型 ListTopics 工具

## 全局决策

- **分工原则**：systemPrompt 注入轻量头（topic + 未提炼标题 + 指引）；完整卡只经 ReadGroupBackground 返回，agent 手里永远只有一份卡。
- **读时同步**：stale 时复用按组 in-flight 抽取任务（entryKey = wsId:groupId），等待上限 120s，超时返回现有卡 + 明示「未能同步」。
- **退休语义**：resolved 从「仅 inProgress→completed」扩展为跨类；被标记条目移入已完成区、文本后缀「（已解决）」，保留痕迹（倾向，实施时可调）。
- **命名**：increment 加 initialTitle（可选）；合并时若 group.title 为空/未定义则 updateGroup 生效一次；后续改名只走 topicChange 待确认 → 确认时联动 updateGroup(title)。会话标题永不联动。
- **抽取提示词约束**：只抽本话题内事实（长期偏好/身份归记忆系统不抽）；引导标记被取代旧条目；条目格式不写散文。
- **旧数据不删**：磁盘 digest.md / 报告 / categories.json 文件保留；前端不再展示；用户既有 plan 中 group_digest/review/categorize/categorize_organize 项过滤隐藏（数据保留）。
- **错误处理基调**：读时同步永不抛错；抽取失败 sourcesSeen 不推进可幂等重抽（沿用现状）。
- 注释规范：不写注释，仅 WHY 非显而易见处一行。

## 完成总结

六步全部实施完成（2026-09-11，逐 step 验收提交）：

| Step | 提交 | 核心改动 |
|---|---|---|
| 1 schema 与提示词地基 | caf43f3 | resolved 跨类退休（移入 completed 加「已解决」后缀）+ initialTitle 字段 + 抽取提示词范围/退休/命名三约束 |
| 2 读时同步核心链路 | d670fc4 | 删 sync 等待分支；ensureGroupFresh（120s 等待超时留后台）；ReadGroupBackground 读时同步 + 未同步明示段 |
| 3 注入轻量化 | 850b5e5 | systemPrompt 只注轻量头（话题背景/未提炼会话/指引）；完整卡唯一出口收敛到工具；start() 零触发零等待 |
| 4 话题命名联动 | 63fe296 | initialTitle 首次命名（组 title 空时生效一次）+ topicChange 确认联动 updateGroup |
| 5 旧轨下线 digest/review | 510ada6 | 砍两个内置任务与报告体系（19 文件 -2773 行）；存量 plans.json/磁盘数据保留仅过滤隐藏；前端组卡区/报告 UI 清理 |
| 6 智能分组下线 + ListTopics | 本次 | categorize 全链与 builtin 概念整体退役（22 文件 -4202 行）；migration-p3/p4/gate 删除；新增零模型 dogear__ListTopics 补跨话题检索 |

验收中发现并修复的问题：step5 的 listSchedulableTasks 自递归 bug（打回修复）；step5 遗漏的报告 UI 死链路（ReportSection 调用已删路由，step6 补做删除）。

遗留（备查，均不影响主链路）：无 GUI 视觉验收欠账（话题面板/数据中心/调度页/设置页需人工过一遍）；本机 .dogear/state-extract-prompt.md 旧版提示词屏蔽新 DEFAULT（用户确认后删除自动重播）；manualTaskDone 事件监听方仍在；单会话 prompt 无裁剪、保真校验只查 uuid 存在性、emit_state_increment 未注册 tool-registry、STATE_EXTRACT 未接 scheduler、读时同步 120s 阈值硬编码。
