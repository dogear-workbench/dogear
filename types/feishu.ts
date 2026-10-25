// === 飞书 Bot 类型定义 ===

/** 凭证配置（.dogear/feishu/config.json 明文存储） */
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
  connectedAt?: string;
  /** 首次私聊 bot 的用户 open_id（建群与推送用） */
  userOpenId?: string;
  /** 话题工作群 chat_id（创建成功后写入） */
  topicChatId?: string;
  /** 通知推送开关（默认 true） */
  notifyPush?: boolean;
}

/** 连接测试结果（失败时 error 含开放平台修复指引） */
export interface FeishuTestResult {
  ok: boolean;
  stage?: 'token' | 'bot_info';
  botName?: string;
  error?: string;
}

/** WS 长连接状态 */
export type FeishuConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** 连接状态快照（getConnectionStatus 返回） */
export interface FeishuConnectionStatus {
  state: FeishuConnectionState;
  errorMessage?: string;
  running: boolean;
  botName?: string;
  connectedAt?: string;
}

/** WS 收到的文本消息（p2p 全量；群仅 thread_id 存在的话题消息，普通群消息静默过滤） */
export interface FeishuIncomingMessage {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  text: string;
  chatType?: 'p2p' | 'group';
  /** 话题 ID（omt_ 前缀，仅话题消息返回） */
  threadId?: string;
  /** 话题根消息 ID（话题内回复时返回） */
  rootId?: string;
}

/** 话题级绑定（threads.json v2 threadBindings）：飞书话题 → 应用会话一对一 */
export interface FeishuThreadBinding {
  threadId: string;
  rootMessageId: string;
  chatId: string;
  workspaceId: string;
  conversationId: string;
  createdAt: string;
  lastActiveAt: string;
}

/** 群内话题绑定行（飞书话题 → 应用会话，一对一） */
export interface FeishuThreadBindingRow {
  threadId: string;
  /** 绑定的会话已删除时为 null */
  conversationTitle: string | null;
  lastActiveAt: string;
}

/** 群绑定一览行（getBotStatus / feishuBotAutoInit 的 chatBindings 项） */
export interface FeishuChatBindingRow {
  chatId: string;
  /** 绑定的工作区已删除时为 null */
  workspaceName: string | null;
  /** 群尚未归属话题时为 null（首次新建会话时自动创建） */
  groupTitle: string | null;
  /** 群内置顶管理卡是否已就绪 */
  hasManageCard: boolean;
  lastActiveAt: string;
  threadBindings: FeishuThreadBindingRow[];
}

/** Bot 状态快照（feishu:getBotStatus 返回 / feishuBotAutoInit 推送） */
export interface FeishuBotStatus {
  status: {
    workspaceId: string | null;
    workspaceName: string | null;
    conversationId: string | null;
    conversationTitle: string | null;
    debugMode: boolean;
    /** 私聊 /new 已表态，下一条消息到达才真正建会话 */
    pendingNew: boolean;
  };
  chatBindings: FeishuChatBindingRow[];
}

/** 话题工作群创建结果 */
export interface FeishuTopicChatResult {
  ok: boolean;
  chatId?: string;
  error?: string;
}
