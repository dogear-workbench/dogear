// === 飞书 Bot 类型定义 ===

/** 凭证配置（.dogear/feishu/config.json 明文存储） */
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
  connectedAt?: string;
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
