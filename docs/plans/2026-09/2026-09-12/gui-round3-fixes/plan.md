# GUI 回归第三轮反馈修复 实施计划

**目标**：落实第三轮 GUI 回归反馈——申报/勾选/通讯渲染改消息式、绿色标识语义修正、等待图标与插话交互、执行会话提示词精简、设置保存并退出分层生效、新增顶部消息中心。

**架构思路**：渲染侧在 tool_use 分发层拦截「会话性质」工具（ReportTaskResult/TrackUserActions/SendMessage）摘出工具壳；主进程侧 alive 判定放宽为内存存活、设置走 diff + 脏标记下轮重建；消息中心为独立新 service + tipc + 顶栏 UI。设计细节见 [design.md](./design.md)。

**涉及模块**：components/agent-chat/*（渲染）、electron/main/agents/pi-session/*（会话管理/提示词/脏标记）、electron/main/tipc/*（delegation/settings/新 notification）、app/settings/page.tsx、新增 notification service 与顶栏组件。

## 步骤索引

- [x] [Step 1: 申报消息与勾选卡渲染](./step1-report-message.md) — ReportTaskResult + TrackUserActions 摘出工具壳，渲染为消息式申报 + 勾选卡
- [x] [Step 2: agent↔agent 通讯卡统一](./step2-agent-comm-card.md) — SendMessage 摘壳改一行收起「→ 发出」卡，注入消息加上下收起触发点
- [x] [Step 3: 等待图标与插话交互](./step3-await-steer-ui.md) — 等待图标改旋转、删点击中断链，插话成功提示去掉
- [x] [Step 4: 绿色存活标识语义修正](./step4-alive-semantics.md) — alive 判定改为「在内存即活」并验证消费方
- [x] [Step 5: 执行会话提示词精简](./step5-executor-prompt.md) — 砍话题指引与笔记存卡纪律注入，修 selfConversationId 缺传
- [x] [Step 6: 设置保存并退出与分层生效](./step6-settings-layers.md) — 按钮改造 + diff 域划分 + PiSession 脏标记下轮重建
- [x] [Step 7: 顶部消息中心](./step7-notification-center.md) — 通知存储 service + tipc + 顶栏铃铛下拉 + review 通知补发

## 全局决策

- **行号免责**：所有文档中行号为 2026-09-12 调研快照，实施时以实际代码为准，以符号（函数名/常量名）定位
- **commit 纪律**：沿用上轮约定——工作区遗留其他话题未提交改动一律不碰，每次 commit 只 add 当前 step 涉及文件
- **不写注释**：遵循项目规范，仅 WHY 非显而易见处加一行
- **渲染拦截原则**：会话性质工具（ReportTaskResult/TrackUserActions/SendMessage）在 ContentBlockItem tool_use 分发层拦截，且必须排除出 groupBlocks 的工具组合并；历史消息重载路径天然走同一分发（tool_use 块持久化在消息 contentBlocks），无需 injectedTag 类运行时标记
- **勾选卡数据来源**：只靠 agent 调 TrackUserActions（结构化），不做文本解析
- **通知归属规则**：子会话事件归属父会话（跳父会话）；系统级（任务 review/中断/失败）归 system；系统 toast 保留，中心是聚合层
- **agent↔agent 通讯永不自动展开**：一行收起，仅手动展开；主会话给用户的正文才是展开消息

## 完成总结

第三轮 GUI 回归反馈 7 步全部实施完毕（2026-09-12），每步独立 commit：

1. **918b6cc** 申报/勾选工具渲染为消息流卡片：ReportTaskResult/TrackUserActions 在 tool_use 分发层摘壳，新增 TaskReportMessage（徽章+状态+markdown+打开任务）与 UserActionsCard（emerald 勾选卡），groupBlocks 排除会话性质工具
2. **bc09a62** agent 通讯卡统一：SendMessage 摘壳为 AgentCommCard 一行收起「→ 发给 @会话名」（交付/消息双徽章），注入卡展开态上下加收起按钮，色板抽 injection-tags.ts
3. **05f3958** 等待图标改 Loader2 旋转，删点击挂起链（abortWaitsForParent 整链+tipc 路由+测试），插话成功提示去掉、失败补可见 toast
4. **ba5802a** 存活绿条语义改为「内存即活」：getAliveConversationIds 放宽 + unbindConversation 补广播，消费方六点逐一验证安全
5. **0c24f1b** 执行会话 systemPrompt 精简：ConversationIndex.executor 标记，组上下文只留组头、跳过笔记纪律；buildGroupContextPrompt 补 selfConversationId
6. **d1c9f3b** 设置保存并退出与分层生效：diffSettings 域映射（ui/perCall/snapshot），PiSession 脏标记 + 下轮 sendMessage 原位重建（同 harnessSessionId 历史不丢，失败回滚），废除无差别 closeAll
7. **4c53708** 顶栏消息中心：notification-center-service（JSON 持久化+同源聚合+上限 100）+ tipc 三路由 + 主窗口铃铛下拉，任务 review/中断/失败与子会话交付/终态（归属父会话）接入，跳转即已读

遗留：GUI 人工回归三场景（主题热更、改模型下轮生效、保存时后台会话不杀 + 消息中心跳转视觉）待用户实际操作确认；readOnly 会话勾选卡可点（与旧行为一致）；paused 脏会话恢复那轮仍用旧设置。
