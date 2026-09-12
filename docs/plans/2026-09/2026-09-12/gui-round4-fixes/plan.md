# GUI 第四轮反馈修复：派遣渲染统一 + 通讯卡修正 + 通知治理 + 双向连接

**目标**：修复第三轮回归暴露的六组问题——CreateSession 派遣消息未纳入消息流渲染、通讯卡字号/展开/收起交互/配色、通知中心噪音与不可清理、申报卡与任务面板双向连接。

**架构思路**：主进程给 CreateSession 初始 task 包 `dispatch` 注入标签（复用 sender 标签 + pendingInjected 机制），前端把 CreateSession/CreateSessionBatch 与 SendMessage 同等纳入 SESSION_MESSAGE_TOOL_NAMES 消息流渲染；通知中心语义收敛为「需要用户行动/注意」，子会话粒度事件全部移除；色板底色统一中性化，竖线+徽章保留类型色。

**涉及模块**：
- 主进程：`electron/main/agents/delegation-bridge.ts`（startChild 消息包装）、`electron/main/agents/delegation-tools.ts`（删交付通知）、`electron/main/services/notification-center-service.ts`（remove/clearAll/pruneExpired）、对应 tipc 路由
- 前端渲染：`components/agent-chat/AgentCommCard.tsx`、`MessageItem.tsx`（InjectedMessageCard）、`ContentBlockItem.tsx`、`session-tools.ts`、`injection-tags.ts`、`utils.ts`、`types.ts`、`minimap-utils.ts`
- 任务/通知 UI：`components/agent-chat/TaskReportMessage.tsx`、`components/notes/TaskPanel.tsx`、`components/NotificationCenter.tsx`、`stores/notification-store.ts`

## 步骤索引

- [x] [Step 1: 通讯卡视觉与交互修正](./step1-comm-card-visual.md) — 字号调小、展开态完整目标行、收起触发点重排、底色中性化
- [x] [Step 2: 派遣渲染统一链](./step2-dispatch-rendering.md) — dispatch 注入标签 + CreateSession 通讯卡 + 会话名可点跳转 + 小地图
- [ ] [Step 3: 通知中心收敛与治理](./step3-notification-hygiene.md) — 移除子会话粒度通知、单条删除/清空、已读自动过期
- [ ] [Step 4: 申报卡与任务面板双向连接](./step4-task-bidirectional.md) — 状态徽章可点定位任务、任务条目跳执行会话

## 全局决策

- **底色中性**：`injection-tags.ts` 所有 `card` 类统一 `bg-secondary/60`（含新 dispatch）；竖线 `bar` 与徽章 `badge` 保留原类型色。`TaskReportMessage` 蓝底同步中性化（同族消息流卡）
- **展开态正文一律 `text-xs`**（AgentCommCard 的 MarkdownRenderer 与 InjectedMessageCard 的纯文本）
- **InjectionTag 新增 `'dispatch'`**：amber 竖线（同 task-execution 色系），徽章文案「派出」；主/前端两侧类型定义同步扩展
- **收起交互**：展开态不再放顶部小按钮（点卡片头即收起，CollapsibleTrigger 本身支持）；底部为整行宽收起条（居中「收起」+ ChevronUp，hover 高亮）
- **通知中心语义**：只留任务进入待审核/任务中断/任务执行失败（系统级）；子会话交付、子会话终态两类不再进消息中心（注入父会话的卡不受影响）
- **通知清理**：已读条目 24h 自动清（启动时执行）+ 单条删除 + 一键清空
- **会话名跳转口径**：与 NotificationCenter 的 `openOrFocusConversation(conv, topic:{groupId}:{id})` 一致，本地 store 命中后兜底 `client.getByWorkspaceId`
- 主进程改动需 `build:electron` + 重启 dev 验证；前端走 Vite 热重载。每步 lint + tsc 零错误后 commit，只 add 当前 step 涉及文件
- 旧会话里已落盘的裸 task 消息（无 sender 标签）保持原用户气泡渲染，不做数据迁移
