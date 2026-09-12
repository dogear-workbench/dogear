# GUI 回归第三轮反馈修复 实施计划

**目标**：落实第三轮 GUI 回归反馈——申报/勾选/通讯渲染改消息式、绿色标识语义修正、等待图标与插话交互、执行会话提示词精简、设置保存并退出分层生效、新增顶部消息中心。

**架构思路**：渲染侧在 tool_use 分发层拦截「会话性质」工具（ReportTaskResult/TrackUserActions/SendMessage）摘出工具壳；主进程侧 alive 判定放宽为内存存活、设置走 diff + 脏标记下轮重建；消息中心为独立新 service + tipc + 顶栏 UI。设计细节见 [design.md](./design.md)。

**涉及模块**：components/agent-chat/*（渲染）、electron/main/agents/pi-session/*（会话管理/提示词/脏标记）、electron/main/tipc/*（delegation/settings/新 notification）、app/settings/page.tsx、新增 notification service 与顶栏组件。

## 步骤索引

- [x] [Step 1: 申报消息与勾选卡渲染](./step1-report-message.md) — ReportTaskResult + TrackUserActions 摘出工具壳，渲染为消息式申报 + 勾选卡
- [x] [Step 2: agent↔agent 通讯卡统一](./step2-agent-comm-card.md) — SendMessage 摘壳改一行收起「→ 发出」卡，注入消息加上下收起触发点
- [ ] [Step 3: 等待图标与插话交互](./step3-await-steer-ui.md) — 等待图标改旋转、删点击中断链，插话成功提示去掉
- [ ] [Step 4: 绿色存活标识语义修正](./step4-alive-semantics.md) — alive 判定改为「在内存即活」并验证消费方
- [ ] [Step 5: 执行会话提示词精简](./step5-executor-prompt.md) — 砍话题指引与笔记存卡纪律注入，修 selfConversationId 缺传
- [ ] [Step 6: 设置保存并退出与分层生效](./step6-settings-layers.md) — 按钮改造 + diff 域划分 + PiSession 脏标记下轮重建
- [ ] [Step 7: 顶部消息中心](./step7-notification-center.md) — 通知存储 service + tipc + 顶栏铃铛下拉 + review 通知补发

## 全局决策

- **行号免责**：所有文档中行号为 2026-09-12 调研快照，实施时以实际代码为准，以符号（函数名/常量名）定位
- **commit 纪律**：沿用上轮约定——工作区遗留其他话题未提交改动一律不碰，每次 commit 只 add 当前 step 涉及文件
- **不写注释**：遵循项目规范，仅 WHY 非显而易见处加一行
- **渲染拦截原则**：会话性质工具（ReportTaskResult/TrackUserActions/SendMessage）在 ContentBlockItem tool_use 分发层拦截，且必须排除出 groupBlocks 的工具组合并；历史消息重载路径天然走同一分发（tool_use 块持久化在消息 contentBlocks），无需 injectedTag 类运行时标记
- **勾选卡数据来源**：只靠 agent 调 TrackUserActions（结构化），不做文本解析
- **通知归属规则**：子会话事件归属父会话（跳父会话）；系统级（任务 review/中断/失败）归 system；系统 toast 保留，中心是聚合层
- **agent↔agent 通讯永不自动展开**：一行收起，仅手动展开；主会话给用户的正文才是展开消息
