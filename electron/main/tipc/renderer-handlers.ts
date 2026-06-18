/**
 * main→renderer 事件类型定义
 * 用于 getRendererHandlers<T> 和 createEventHandlers<T> 的类型约束
 */
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { TaskStatus } from '../agents/task-types.js';

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
    mode: string;
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

  // 首页报告文件变更（fs.watch 监听 <configDir>/workspaces/<wsId>/dashboard.md）
  reportUpdated: (data: { workspaceId: string }) => void;

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

};
