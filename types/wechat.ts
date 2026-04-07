// === 微信 iLink 协议类型定义 ===

/** 认证状态 */
export type WechatAuthState = 'disconnected' | 'qr_pending' | 'scanning' | 'connected' | 'expired';

/** 连接信息 */
export interface WechatConnectionInfo {
  state: WechatAuthState;
  botName?: string;
  connectedAt?: string;       // ISO timestamp
  tokenExpiresAt?: string;    // ISO timestamp
  lastPollAt?: string;        // ISO timestamp
  errorMessage?: string;
}

/** QR 码信息 */
export interface WechatQRCode {
  qrcodeId: string;     // 轮询用的 token（get_qrcode_status 参数）
  imgUrl: string;        // 可扫描的 URL（qrcode_img_content）
  expiresAt: string;     // ISO timestamp
}

/** 消息类型 */
export type WechatMessageType = 'text' | 'image' | 'voice' | 'video' | 'file' | 'link' | 'location' | 'unknown';

/** 微信消息 */
export interface WechatMessage {
  id: string;                   // 消息唯一 ID
  contextToken: string;         // 回复路由 token
  senderId: string;             // 发送者标识
  senderName: string;           // 发送者昵称
  content: string;              // 文本内容或媒体描述
  messageType: WechatMessageType;
  timestamp: number;            // Unix ms
  isGroup: boolean;             // 是否群消息
  groupId?: string;             // 群标识
  groupName?: string;           // 群名称
  isOutgoing: boolean;          // 是否 bot 发出
}

/** 联系人 */
export interface WechatContact {
  id: string;                   // 联系人/群唯一标识
  name: string;                 // 显示名称
  isGroup: boolean;
  lastMessage?: string;         // 最后一条消息预览
  lastMessageAt?: number;       // 最后消息时间戳
  unreadCount: number;
  contextToken?: string;        // 最新 context_token（用于回复）
}

/** 持久化的认证 token */
export interface WechatAuthToken {
  botToken: string;
  botId: string;                // ilink_bot_id
  userId: string;               // ilink_user_id
  baseUrl: string;              // iLink 返回的 baseurl
  botName: string;
  connectedAt: string;          // ISO timestamp
  expiresAt: string;            // ISO timestamp（24h）
}

/** 发送消息请求 */
export interface WechatSendRequest {
  contextToken: string;
  content: string;
  toUserId: string;
}

// === iLink API 原始响应类型 ===

/** getUpdates 返回的原始消息 */
export interface ILinkRawMessage {
  context_token: string;
  from_user_id: string;
  from_user_name?: string;
  to_user_id?: string;
  message_id?: string;
  item_list?: Array<{
    item_type: number;      // 1=text, 2=image, 3=voice, 4=video, 5=file, 6=link, 7=location
    text_content?: string;
    title?: string;
    desc?: string;
    url?: string;
    media_id?: string;
  }>;
  group_id?: string;
  group_name?: string;
  create_time?: number;
}

/** getUpdates 响应 */
export interface ILinkGetUpdatesResponse {
  ret: number;
  errmsg?: string;
  msgs?: ILinkRawMessage[];
  get_updates_buf?: string;    // 不透明 cursor，需持久化传回
}

/** QR 码获取响应 */
export interface ILinkQRCodeResponse {
  ret: number;
  errmsg?: string;
  qrcode?: string;             // 轮询 ID
  qrcode_img_content?: string; // 可扫描 URL
}

/** QR 码状态轮询响应 */
export interface ILinkQRCodeStatusResponse {
  ret: number;
  errmsg?: string;
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  nick_name?: string;
}

/** sendMessage 响应 */
export interface ILinkSendMessageResponse {
  ret: number;
  errmsg?: string;
}
