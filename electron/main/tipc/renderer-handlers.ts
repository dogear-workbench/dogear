/**
 * main→renderer 事件类型定义
 * 用于 getRendererHandlers<T> 和 createEventHandlers<T> 的类型约束
 */
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { TaskStatus } from '../agents/task-types.js';
import type { ChildStatus, ChildStateSnapshot } from '../types.js';
import type { PiPermissionMode } from '../agents/pi-session/permission-mode.js';

/**
 * 渲染进程事件处理器类型定义
 * 每个属性是一个函数签名，参数即为事件的 payload
 */
export type RendererHandlers = {
  // Agent 任务状态更新
  agentTaskUpdate: (data: {
    taskId: string;
    status: TaskStatus;
    result?: unknown;
    error?: string;
  }) => void;

  // Agent 流式文本块
  agentStreamChunk: (data: {
    taskId: string;
    chunk: string;
  }) => void;

  // 旧版 Agent 会话消息
  agentSessionMessage: (data: {
    sessionId: string;
    message: string;
  }) => void;

  // 基于 Query 的会话消息
  queryBasedSessionMessage: (data: {
    sessionId: string;
    message: ExtendedSessionMessage;
  }) => void;

  // 基于 Query 的会话完成
  queryBasedSessionComplete: (data: {
    sessionId: string;
    result: unknown;
  }) => void;

  // 队列长度变化（插话/正常消息进出 pendingMessages）
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

  // 子代理开始运行
  subAgentStarted: (data: {
    parentSessionId: string;
    agentId: string;
    description: string;
    subagentType?: string;
  }) => void;

  // 子代理运行完成
  subAgentCompleted: (data: {
    parentSessionId: string;
    agentId: string;
    status: string;
    durationMs?: number;
    tokens?: number;
    toolUseCount?: number;
    resultText?: string;
  }) => void;

  // === 文章解析状态（Phase 3） ===

  // 文章解析状态变化（脚本/AI 质量检查/重新解析后端广播）
  articleParseStatusChanged: (data: {
    articleId: string;
    workspacePath: string;
    parseStatus: 'script_ok' | 'fixed' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
  }) => void;

  // === 微信 iLink ===

  // 收到新微信消息
  wechatNewMessage: (data: {
    messages: Array<{
      id: string;
      contextToken: string;
      senderId: string;
      senderName: string;
      content: string;
      messageType: string;
      timestamp: number;
      isGroup: boolean;
      groupId?: string;
      groupName?: string;
      isOutgoing: boolean;
    }>;
  }) => void;

  // 微信认证状态变化
  wechatAuthStatus: (data: {
    state: string;
    botName?: string;
    errorMessage?: string;
  }) => void;

  // 微信连接/轮询状态变化
  wechatConnectionStatus: (data: {
    polling: boolean;
    lastPollAt?: string;
    errorMessage?: string;
  }) => void;

  // 对话运行状态变化（主进程统一管理，不依赖渲染层 tab 是否打开）
  conversationRunningStateChanged: (data: {
    conversationId: string;
    isRunning: boolean;
  }) => void;

  // 微信 Bot 绑定对话变更
  wechatBotBindingChanged: (data: {
    conversationId: string | null;
  }) => void;

  // 独立会话窗口关闭（通知主窗口恢复 Tab）
  sessionWindowClosed: (data: {
    conversationId: string;
    title: string;
    workspaceId: string;
  }) => void;

  // 独立会话窗口 attach 完成（通知主窗口可以安全关闭标签页）
  sessionWindowReady: (data: {
    conversationId: string;
  }) => void;

  // 对话列表变更通知（主进程侧创建/删除对话后广播，前端应刷新列表）
  conversationListChanged: (data: {
    workspaceId: string;
  }) => void;

  // 对话用量有新条目写入（Task 6 写完后广播，渲染层收到后重新 getUsage）
  usageEntryAdded: (data: { conversationId: string }) => void;

  // 智能分类索引变更（CATEGORIZE_SESSION 完成后广播，前端 store 收到刷新）
  categoriesUpdated: (data: { workspaceId: string }) => void;

  // 手动长任务（全量重置分类 / 单组重新提炼）终态通知（主进程写完 run-history 后广播，status 供渲染层分流 toast）
  manualTaskDone: (data: {
    kind: 'full-rebuild' | 'redigest';
    planId: 'manual-full-rebuild' | 'manual-redigest';
    planName: string;
    status: 'completed' | 'failed' | 'cancelled';
    workspaceId: string;
    groupId?: string;
    durationMs: number;
    summary?: string;
    error?: string;
  }) => void;

  // 首页报告文件变更（fs.watch 监听 <configDir>/workspaces/<wsId>/dashboard.md）
  reportUpdated: (data: { workspaceId: string }) => void;

  // 笔记数据变更（notes-service 写操作后广播，前端 store 收到后重新拉取列表）
  notesChanged: (data: { workspacePath: string }) => void;

  // 实施任务数据变更（task-service 写操作后广播，前端 store 收到后重新拉取列表）
  tasksChanged: (data: { workspacePath: string }) => void;

  // 微信 Bot 自动初始化数据（startPolling 成功后推送）
  wechatBotAutoInit: (data: {
    status: {
      workspaceId: string | null;
      workspaceName: string | null;
      conversationId: string | null;
      conversationTitle: string | null;
      debugMode: boolean;
    };
    conversations: Array<{
      index: number;
      id: string;
      title: string;
      updatedAt: string;
    }>;
  }) => void;

  // 子会话状态变化（delegation-bridge 广播）
  childStatusChanged: (data: {
    parentConversationId: string;
    childId: string;
    status: ChildStatus;
    snapshot: ChildStateSnapshot;
  }) => void;

  // 父会话等待中的子会话数量变化
  deliveriesAwaitChanged: (data: {
    parentConversationId: string;
    runningCount: number;
    doneCount: number;
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
  }) => void;

  // 会话已终止（PiSession.close() 收尾完成后 emit 一次）
  // 前端收到后应把该会话从 running/pendingAction Set 中清除，不再等待对应的 sessionStateChanged:false
  sessionClosed: (data: {
    conversationId: string;
  }) => void;

  // 通知点击后定位到目标对话（主窗口收到后切换到对应工作区并激活对话）
  focusConversation: (data: {
    conversationId: string;
    workspaceId: string;
  }) => void;

  // 任务通知点击深链（主窗口收到后切换到笔记页任务视图并选中该任务）
  focusTask: (data: { taskId: string; workspaceId: string }) => void;

  // 热更新下载进度（主进程→渲染层推送）
  updateProgress: (data: {
    percent: number;
    transferred: number;
    total: number;
  }) => void;

  // 设置已落盘（设置保存发起，主窗口收到后刷新 settings store；restartSessions=true 时重启活跃会话）
  settingsChanged: (data: { restartSessions: boolean }) => void;

};
