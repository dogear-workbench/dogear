/**
 * main→renderer 事件类型定义
 * 用于 getRendererHandlers<T> 和 createEventHandlers<T> 的类型约束
 */
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { ChildStatus, ChildStateSnapshot } from '../types.js';
import type { PiPermissionMode } from '../agents/pi-session/permission-mode.js';
import type { BrowserActionEvent } from '../services/browser/browser-action-stream.js';

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

  // === 文章解析状态（Phase 3） ===

  // 文章解析状态变化（脚本/AI 质量检查/重新解析后端广播）
  articleParseStatusChanged: (data: {
    articleId: string;
    workspacePath: string;
    parseStatus: 'script_ok' | 'fixed' | 'need_login' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
  }) => void;

  // 浏览器解析遇登录墙（解析编排广播，前端 toast 提示 + 文章条目展示需要登录状态）
  browserLoginRequired: (data: {
    articleId: string;
    url: string;
    workspaceId: string;
  }) => void;

  // === 微信 iLink ===

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

  // 对话列表变更通知（service 层写入后广播，前端应刷新列表）
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

  // 工作区文件树结构变更（workspace-watcher 监听 rename 事件去抖后广播，前端匹配当前工作区重拉文件树）
  workspaceFilesChanged: (data: { workspaceId: string }) => void;

  // 话题组数据变更（共享区文件/话题背景/组卡写点广播，TopicPanel 匹配当前组后重拉）
  groupDataChanged: (data: { workspaceId: string; groupId: string }) => void;

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

  // 浏览器动作流增量事件（action-stream 广播，browser-store 追加渲染）
  browserActionAdded: (data: BrowserActionEvent) => void;

};
