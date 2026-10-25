/**
 * main→renderer 事件类型定义
 * 用于 getRendererHandlers<T> 和 createEventHandlers<T> 的类型约束
 */
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { ChildStatus, ChildStateSnapshot } from '../types.js';
import type { PiPermissionMode } from '../agents/pi-session/permission-mode.js';
import type { HumanInterventionRequest } from '../services/browser/human-intervention.js';
import type { ExtensionStatus } from '../services/browser/browser-gateway.js';
import type { HandoffDraftBroadcast } from '../services/browser/extension-handoff.js';
import type { SyncProgressEvent } from '../services/sync/orchestrator.js';
import type { LanSyncStatus } from '../services/sync/lan-sync-service.js';
import type { PeerInfo } from '../services/sync/discovery.js';
import type { PairingOutcome, PairingRequestInfo } from '../services/sync/pairing.js';

/**
 * 渲染进程事件处理器类型定义
 * 每个属性是一个函数签名，参数即为事件的 payload
 */
export type RendererHandlers = {
  // 基于 Query 的会话消息
  queryBasedSessionMessage: (data: {
    sessionId: string;
    message: ExtendedSessionMessage;
  }) => void;

  // 基于 Query 的会话完成（conversationId 供前端定位 conversation 记录，如未读标记；会话未绑定 conversation 时缺省）
  queryBasedSessionComplete: (data: {
    sessionId: string;
    conversationId?: string;
    result: unknown;
  }) => void;

  // 队列长度变化（插话进出队列）
  pendingCountChanged: (data: {
    sessionId: string;
    count: number;
  }) => void;

  // 权限确认请求（SDK canUseTool 回调触发）
  permissionRequest: (data: {
    sessionId: string;
    requestId: string;
    toolName: string;
    toolInput: unknown;
    decisionReason?: string;
  }) => void;

  // Agent 通知事件（Notification hook 触发）
  agentNotification: (data: {
    sessionId: string;
    title?: string;
    message: string;
    notificationType: string;
  }) => void;

  // 权限模式变更通知（后端→前端双向同步）
  permissionModeChanged: (data: {
    sessionId: string;
    mode: PiPermissionMode;
  }) => void;

  // AskUserQuestion 事件（SDK AskUserQuestion 工具触发）
  askUserQuestion: (data: {
    sessionId: string;
    requestId: string;
    questions: Array<{
      question: string;
      header?: string;
      options: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;
  }) => void;

  // 会话能力信息（SDK init 消息中的命令/工具/技能列表）
  sessionCapabilities: (data: {
    sessionId: string;
    sdkCommands: Array<{ name: string; description: string; argumentHint: string }>;
    tools: string[];
    skills: string[];
    mcpServers: Array<{ name: string; status: string }>;
  }) => void;

  // === 文章解析状态（Phase 3） ===

  // 文章解析状态变化（脚本/AI 质量检查/重新解析后端广播）
  articleParseStatusChanged: (data: {
    articleId: string;
    workspaceId: string;
    parseStatus: 'script_ok' | 'fixed' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
  }) => void;

  // === 飞书 Bot ===

  // 飞书 WS 连接状态变化
  feishuConnectionStatus: (data: {
    state: 'disconnected' | 'connecting' | 'connected' | 'error';
    errorMessage?: string;
  }) => void;

  // 飞书 Bot 自动初始化数据（connect 成功后推送；结构镜像 types/feishu.ts 的 FeishuBotStatus）
  feishuBotAutoInit: (data: {
    status: {
      workspaceId: string | null;
      workspaceName: string | null;
      conversationId: string | null;
      conversationTitle: string | null;
      debugMode: boolean;
      pendingNew: boolean;
    };
    chatBindings: Array<{
      chatId: string;
      workspaceName: string | null;
      groupTitle: string | null;
      hasManageCard: boolean;
      lastActiveAt: string;
      threadBindings: Array<{
        threadId: string;
        conversationTitle: string | null;
        lastActiveAt: string;
      }>;
    }>;
  }) => void;

  // 飞书 Bot 绑定对话变更
  feishuBotBindingChanged: (data: {
    conversationId: string | null;
  }) => void;

  // 独立会话窗口关闭（通知主窗口恢复 Tab）
  sessionWindowClosed: (data: {
    conversationId: string;
    title: string;
    workspaceId: string;
  }) => void;

  // 对话列表变更通知（service 层写入后广播，前端应刷新列表）
  conversationListChanged: (data: {
    workspaceId: string;
  }) => void;

  // 会话未读标记实际翻转（setUnread 落盘成功后广播，前端据此更新绿点分片与 tab 未读置顶）；'error' = 上一轮执行失败（红点）
  conversationUnreadChanged: (data: {
    conversationId: string;
    unread: boolean | 'error';
  }) => void;

  // 对话用量有新条目写入（Task 6 写完后广播，渲染层收到后重新 getUsage）
  usageEntryAdded: (data: { conversationId: string }) => void;


  // 笔记数据变更（notes-service 写操作后广播，前端 store 收到后重新拉取列表）
  notesChanged: (data: { workspaceId: string }) => void;

  // 实施任务数据变更（task-service 写操作后广播，前端 store 收到后重新拉取列表）
  tasksChanged: (data: { workspacePath: string }) => void;

  // 子会话状态变化（delegation-bridge 广播）
  childStatusChanged: (data: {
    parentConversationId: string;
    childId: string;
    status: ChildStatus;
    snapshot: ChildStateSnapshot;
  }) => void;

  // 主会话模型故障转移发生（quota 后自动切换供应商继续）
  failoverNotice: (data: {
    conversationId: string;
    fromLabel: string;
    toLabel: string;
    at: number;
  }) => void;

  // 会话运行/挂起操作状态变化（跑步机模式：后端唯一权威判定，一次事件同步驱动前端全局
  // running/pendingAction Set 与 session 内 pendingState，状态跟上次不同才 emit）
  sessionStateChanged: (data: {
    conversationId: string;
    running: boolean;
    pendingAction: boolean;
    paused: boolean;
  }) => void;

  // 会话已终止（PiSession.close() 收尾完成后 emit 一次）
  // 前端收到后应把该会话从 running/pendingAction Set 中清除，不再等待对应的 sessionStateChanged:false
  sessionClosed: (data: {
    conversationId: string;
  }) => void;

  // 会话压缩失败持续态翻转（置位/恢复；重启恢复时创建后主动对账一次），驱动会话告警横幅显隐
  compactionFailureChanged: (data: {
    conversationId: string;
    failed: boolean;
  }) => void;

  // 通知点击后定位到目标对话（主窗口收到后切换到对应工作区并激活对话）
  focusConversation: (data: {
    conversationId: string;
    workspaceId: string;
  }) => void;

  // 全局焦点会话变化（focused-conversation-service 值变化时广播，伴随工作台窗口跟随当前活跃会话）
  focusedConversationChanged: (data: {
    conversationId: string;
    workspaceId: string;
  }) => void;

  // 任务通知点击深链（主窗口切任务面板并选中该任务）
  focusTask: (data: { taskId: string; workspaceId: string }) => void;

  // 消息中心变更（notification-center-service 写操作后广播，载荷为未读数；渲染层收到后重拉列表）
  notificationsChanged: (data: { unreadCount: number }) => void;

  // 热更新下载进度（主进程→渲染层推送）
  updateProgress: (data: {
    percent: number;
    transferred: number;
    total: number;
  }) => void;

  // 设置已落盘（渲染层收到后刷新 settings store；agent 快照域由主进程标脏处理，渲染层无需重启会话）
  settingsChanged: (data: null) => void;

  // 工作区文件树结构变更（workspace-watcher 监听 rename 事件去抖后广播，前端匹配当前工作区重拉文件树）
  workspaceFilesChanged: (data: { workspaceId: string }) => void;

  // 话题组数据变更（共享区文件/话题背景/组卡写点广播，TopicPanel 匹配当前组后重拉）
  groupDataChanged: (data: { workspaceId: string; groupId: string }) => void;

  // 存活会话集合变化（PiSessionManager 内存态派生，全量列表；驱动列表竖线常亮）
  aliveConversationsChanged: (data: { conversationIds: string[] }) => void;

  // PTY 终端实例创建（pty-service 广播，渲染端建 tab）
  ptyCreated: (data: {
    terminalId: string;
    conversationId: string | null;
    command: string;
  }) => void;

  // PTY 原始输出增量（保留 ANSI，xterm.write 直写）
  ptyData: (data: { terminalId: string; data: string }) => void;

  // PTY 进程退出
  ptyExit: (data: { terminalId: string; exitCode: number }) => void;

  // 等待人工请求变化（human-intervention 广播；pending 为全量待处理列表，resolved 为刚解除的请求（含 result），供会话消息流卡片置 resolved 态）
  humanInterventionChanged: (data: { pending: HumanInterventionRequest[]; resolved?: HumanInterventionRequest }) => void;

  // 浏览器扩展连接状态变化（browser-gateway 广播，设置页状态行渲染；payload 为全量状态快照）
  extensionStatusChanged: (data: ExtensionStatus) => void;

  // 浏览器一键移交草稿（extension-handoff 广播；渲染层挂到 handoff-draft-store，目标会话输入框上方待编辑）
  browserHandoffReceived: (data: HandoffDraftBroadcast) => void;

  // 提示音播放指令（主进程提示决策单点收敛后下发，只发主窗口；渲染层结合设置项决定是否发声；
  // intervention 为人工介入卡提醒，不受前台静默限制）
  soundCue: (data: { kind: 'complete' | 'permission' | 'error' | 'intervention'; appFocused: boolean }) => void;

  // 人工介入卡焦点跳转（intervention-notify 定向发目标窗口；渲染层切到目标会话后滚动定位到卡片）
  interventionFocus: (data: { conversationId: string; workspaceId: string; interventionRequestId: string }) => void;

  // === 双屏工作模式：窗口生命周期广播（互斥/哨兵弹出状态由前端 store 消费，不落盘） ===

  // 工作台窗口打开（主窗口右栏收起、开关按钮隐藏，独立会话窗口工具箱同步隐藏）
  workbenchWindowOpened: (data: null) => void;

  // 工作台窗口关闭（右栏恢复展开）
  workbenchWindowClosed: (data: null) => void;

  // 笔记窗口打开（主窗口隐藏笔记哨兵 tab）
  notesWindowOpened: (data: null) => void;

  // 笔记窗口关闭（主窗口恢复笔记 tab）
  notesWindowClosed: (data: null) => void;

  // 数据中心窗口打开（主窗口隐藏数据中心哨兵 tab）
  dataCenterWindowOpened: (data: null) => void;

  // 数据中心窗口关闭（主窗口恢复数据中心 tab）
  dataCenterWindowClosed: (data: null) => void;

  // 局域网同步事件总线（状态/对端/同步进度/配对四路合一，前端 sync store 按 kind 分发）
  syncEvent: (data: SyncEventPayload) => void;

};

export type SyncEventPayload =
  | { kind: 'status'; status: LanSyncStatus }
  | { kind: 'peers'; peers: PeerInfo[] }  // 合并快照（mDNS 在线 ∪ 探测在线 ∪ 离线已配对常驻），非纯 mDNS 列表
  | { kind: 'sync'; event: SyncProgressEvent }
  | { kind: 'pair-request'; request: PairingRequestInfo }
  | { kind: 'pairing-completed'; outcome: PairingOutcome };
