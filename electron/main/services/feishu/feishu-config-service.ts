import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { Client, Domain, withTenantToken } from '@larksuiteoapi/node-sdk';
import { safeJsonWrite } from '../safe-json.js';

const { app } = electron;

// 类型镜像自 types/feishu.ts（主进程 rootDir 限制，不能跨目录 import）

export type FeishuConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
  connectedAt?: string;
  userOpenId?: string;
  topicChatId?: string;
  notifyPush?: boolean;
}

export interface FeishuTestResult {
  ok: boolean;
  stage?: 'token' | 'bot_info';
  botName?: string;
  error?: string;
}

const TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';

interface TenantTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
}

interface BotInfoResponse {
  code: number;
  msg?: string;
  bot?: {
    app_name?: string;
    activate_status?: number;
  };
}

function getConfigPath(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear', 'feishu', 'config.json');
  }
  return path.join(process.cwd(), '.dogear', 'feishu', 'config.json');
}

class FeishuConfigService {
  private config: FeishuConfig | null = null;

  async loadConfig(): Promise<FeishuConfig | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(getConfigPath(), 'utf-8')) as FeishuConfig;
      if (!parsed.appId || !parsed.appSecret) {
        this.config = null;
        return null;
      }
      this.config = parsed;
      return parsed;
    } catch {
      this.config = null;
      return null;
    }
  }

  async saveConfig(cfg: FeishuConfig): Promise<void> {
    this.config = cfg;
    await safeJsonWrite(getConfigPath(), cfg);
  }

  async clearConfig(): Promise<void> {
    this.config = null;
    try {
      await fs.unlink(getConfigPath());
    } catch {
      // 文件不存在即已清空
    }
  }

  getCachedConfig(): FeishuConfig | null {
    return this.config;
  }

  /**
   * 两层校验：① 凭证换 tenant_access_token（失败 = appId/secret 错）
   * ② 拉机器人信息（失败 = 机器人能力未开启或应用未发布）
   * 第一层走直接 fetch 保证错误语义可控；第二层走 SDK Client 验证 SDK HTTP 栈可用。
   */
  async testConnection(appId: string, appSecret: string): Promise<FeishuTestResult> {
    let accessToken: string;
    try {
      const res = await fetch(TENANT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const data = (await res.json()) as TenantTokenResponse;
      if (data.code !== 0 || !data.tenant_access_token) {
        return {
          ok: false,
          stage: 'token',
          error: `App ID 或 App Secret 不正确（${data.msg || `code=${data.code}`}），请在飞书开放平台「凭证与基础信息」页面核对后重试`,
        };
      }
      accessToken = data.tenant_access_token;
    } catch (err) {
      return {
        ok: false,
        stage: 'token',
        error: `无法连接飞书开放平台（${String(err)}），请检查网络后重试`,
      };
    }

    try {
      const client = new Client({ appId, appSecret, domain: Domain.Feishu });
      const res = await client.request<BotInfoResponse>(
        { url: '/open-apis/bot/v3/info', method: 'GET' },
        withTenantToken(accessToken),
      );
      if (res.code !== 0 || !res.bot) {
        return {
          ok: false,
          stage: 'bot_info',
          error: `无法获取机器人信息（${res.msg || `code=${res.code}`}），请在飞书开放平台「添加应用能力」中开启机器人，并创建版本发布后重试`,
        };
      }
      return { ok: true, botName: res.bot.app_name || '飞书 Bot' };
    } catch (err) {
      return {
        ok: false,
        stage: 'bot_info',
        error: `无法连接飞书开放平台（${String(err)}），请检查网络后重试`,
      };
    }
  }
}

export const feishuConfigService = new FeishuConfigService();
