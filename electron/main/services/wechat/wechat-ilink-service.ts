/**
 * iLink HTTP API 封装
 *
 * 基于 @tencent-weixin/openclaw-weixin 源码整理的正确实现。
 * Headers、消息格式均来自官方包的 src/api/api.ts 和 src/api/types.ts。
 */

import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { mainLogger } from '../../agents/logger.js';

const log = mainLogger;

// ============================================================
// 常量（来自官方包 package.json 和 api.ts）
// ============================================================

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** ilink_appid 字段来自官方 package.json */
const ILINK_APP_ID = 'bot';

/**
 * iLink-App-ClientVersion: uint32 encoded as 0x00MMNNPP
 * 官方包版本 2.1.3 → (2<<16)|(1<<8)|3 = 131331
 */
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (1 << 8) | 3; // 131331

/**
 * channel_version: 官方包的 package.json version 字段
 * base_info 中使用
 */
const CHANNEL_VERSION = '2.1.3';

/** getUpdates 长轮询的 HTTP 超时（服务端挂起 ~35s，多留 5s 余量） */
const LONG_POLL_TIMEOUT_MS = 40_000;

// ============================================================
// 类型定义（对应官方包 src/api/types.ts）
// ============================================================

export interface ILinkQRCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
  ret?: number;
  errmsg?: string;
}

export interface ILinkQRCodeStatusResponse {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  nick_name?: string;
  redirect_host?: string;
  ret?: number;
  errmsg?: string;
}

/** 对应官方 MessageItem 类型 */
export interface ILinkMessageItem {
  type?: number;
  text_item?: { text?: string };
  image_item?: { url?: string };
  voice_item?: { text?: string; playtime?: number };
  file_item?: { file_name?: string };
  video_item?: { play_length?: number };
  msg_id?: string;
}

/** 对应官方 WeixinMessage 类型 */
export interface ILinkRawMessage {
  context_token?: string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  message_id?: number;
  create_time_ms?: number;
  item_list?: ILinkMessageItem[];
  group_id?: string;
  message_type?: number;
  message_state?: number;
  session_id?: string;
}

export interface ILinkGetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: ILinkRawMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface ILinkSendMessageResponse {
  ret?: number;
  errmsg?: string;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 生成 X-WECHAT-UIN header 值
 * 来自官方包：random uint32 bytes → readUInt32BE → decimal string → base64
 */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

/**
 * 构建所有请求共有的 headers（不含 Authorization）
 */
function buildCommonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
}

/**
 * 构建业务 POST 请求 headers（含认证）
 */
function buildAuthHeaders(botToken: string, body: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': `Bearer ${botToken}`,
    'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
  };
}

/**
 * 带超时的 fetch（支持外部 AbortSignal）
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 10_000, signal: externalSignal, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    log.info(`[iLink] ${fetchOptions.method || 'GET'} ${url}`);
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    log.info(`[iLink] response status=${res.status} url=${url}`);
    return res;
  } catch (err: any) {
    log.error(`[iLink] fetch error url=${url} err=${String(err)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// iLink 服务
// ============================================================

class WechatILinkService {
  /**
   * 获取 QR 码（扫码登录第一步）
   * GET /ilink/bot/get_bot_qrcode?bot_type=3
   * 不需要认证，只需 common headers
   */
  async getQRCode(): Promise<ILinkQRCodeResponse> {
    const url = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildCommonHeaders(),
      timeoutMs: 10_000,
    });
    const text = await res.text();
    log.info(`[iLink] getQRCode response: ${text.slice(0, 200)}`);
    return JSON.parse(text) as ILinkQRCodeResponse;
  }

  /**
   * 长轮询 QR 码扫描状态
   * GET /ilink/bot/get_qrcode_status?qrcode={id}
   * 官方包：只带 common headers（iLink-App-Id + iLink-App-ClientVersion）
   */
  async pollQRCodeStatus(
    qrcodeId: string,
    signal?: AbortSignal,
  ): Promise<ILinkQRCodeStatusResponse> {
    const url = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildCommonHeaders(),
      timeoutMs: 36_000, // 服务端长轮询约 35s
      signal,
    });
    const text = await res.text();
    log.info(`[iLink] pollQRCodeStatus: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text) as ILinkQRCodeStatusResponse;
    } catch {
      return { status: 'wait' };
    }
  }

  /**
   * 长轮询收消息
   * POST /ilink/bot/getupdates
   */
  async getUpdates(
    botToken: string,
    baseUrl: string,
    cursor: string,
    signal?: AbortSignal,
  ): Promise<ILinkGetUpdatesResponse> {
    const url = `${baseUrl || DEFAULT_BASE_URL}/ilink/bot/getupdates`;
    const body = JSON.stringify({
      get_updates_buf: cursor,
      base_info: { channel_version: CHANNEL_VERSION },
    });

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildAuthHeaders(botToken, body),
      body,
      timeoutMs: LONG_POLL_TIMEOUT_MS,
      signal,
    });

    if (!res.ok) {
      log.error(`[iLink] getUpdates HTTP error: status=${res.status} ${res.statusText}`);
      return { ret: res.status === 401 ? -14 : -1, errmsg: `HTTP ${res.status} ${res.statusText}` };
    }

    const text = await res.text();
    log.info(`[iLink] getUpdates response (first 500): ${text.slice(0, 500)}`);
    try {
      const json = JSON.parse(text) as ILinkGetUpdatesResponse;
      // 有些情况 ret 字段不存在，视为成功（0）
      if (json.ret === undefined && !json.errmsg) {
        json.ret = 0;
      }
      return json;
    } catch {
      log.error(`[iLink] getUpdates JSON parse error: ${text.slice(0, 500)}`);
      return { ret: -1, errmsg: 'JSON parse error' };
    }
  }

  /**
   * 发送文本消息
   * POST /ilink/bot/sendmessage
   * 注意：item_list 格式为 { type: 1, text_item: { text: "..." } }
   */
  async sendMessage(
    botToken: string,
    baseUrl: string,
    params: {
      contextToken: string;
      toUserId: string;
      content: string;
    },
  ): Promise<ILinkSendMessageResponse> {
    const url = `${baseUrl || DEFAULT_BASE_URL}/ilink/bot/sendmessage`;
    const clientId = `dogear-${uuidv4()}`;

    const msgBody = {
      msg: {
        from_user_id: '',
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: 2,   // BOT
        message_state: 2,  // FINISH
        context_token: params.contextToken,
        item_list: [
          {
            type: 1,  // TEXT（官方包 MessageItemType.TEXT = 1）
            text_item: {
              text: params.content,
            },
          },
        ],
      },
      base_info: { channel_version: CHANNEL_VERSION },
    };

    const body = JSON.stringify(msgBody);
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildAuthHeaders(botToken, body),
      body,
      timeoutMs: 15_000,
    });
    if (!res.ok) {
      log.error(`[iLink] sendMessage HTTP error: status=${res.status} ${res.statusText}`);
      return { ret: -1, errmsg: `HTTP ${res.status}` };
    }

    const text = await res.text();
    log.info(`[iLink] sendMessage response: ${text.slice(0, 300)}`);
    try {
      const json = JSON.parse(text) as ILinkSendMessageResponse;
      // ret 不存在时视为成功
      if (json.ret === undefined) json.ret = 0;
      return json;
    } catch {
      // 空响应或非 JSON 也视为成功（HTTP 200 已确认）
      return { ret: 0 };
    }
  }

  /**
   * 发送"正在输入"状态
   * 两步：先 getconfig 拿 typing_ticket，再 sendtyping
   */
  async sendTyping(
    botToken: string,
    baseUrl: string,
    ilinkUserId: string,
    contextToken: string,
  ): Promise<void> {
    const base = baseUrl || DEFAULT_BASE_URL;

    // Step 1: 获取 typing_ticket
    const configBody = JSON.stringify({
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const configRes = await fetchWithTimeout(`${base}/ilink/bot/getconfig`, {
      method: 'POST',
      headers: buildAuthHeaders(botToken, configBody),
      body: configBody,
      timeoutMs: 10_000,
    });
    const configText = await configRes.text();
    const configData = JSON.parse(configText) as { ret?: number; typing_ticket?: string };
    if (!configData.typing_ticket) return;

    // Step 2: 发送 typing 状态
    const typingBody = JSON.stringify({
      ilink_user_id: ilinkUserId,
      typing_ticket: configData.typing_ticket,
      status: 1,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    await fetchWithTimeout(`${base}/ilink/bot/sendtyping`, {
      method: 'POST',
      headers: buildAuthHeaders(botToken, typingBody),
      body: typingBody,
      timeoutMs: 10_000,
    });
  }
}

export const wechatILinkService = new WechatILinkService();
