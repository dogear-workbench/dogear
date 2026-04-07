/**
 * 微信 iLink 认证服务
 *
 * 管理 QR 码扫码登录流程和 bot_token 的持久化。
 * token 保存在 .dogear/wechat/auth.json，24 小时有效。
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { wechatILinkService } from './wechat-ilink-service.js';

const { app } = electron;

// ============================================================
// 类型（镜像，避免 rootDir 限制）
// ============================================================

export type WechatAuthState = 'disconnected' | 'qr_pending' | 'scanning' | 'connected' | 'expired';

export interface WechatAuthToken {
  botToken: string;
  botId: string;
  userId: string;
  baseUrl: string;
  botName: string;
  connectedAt: string;
  expiresAt: string;
}

export interface WechatQRCode {
  qrcodeId: string;
  imgUrl: string;
  expiresAt: string;
}

// ============================================================
// 工具
// ============================================================

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getAuthPath(): string {
  return path.join(getConfigDir(), 'wechat', 'auth.json');
}

// ============================================================
// 认证服务
// ============================================================

export interface WechatAuthEvents {
  stateChange: (state: WechatAuthState, botName?: string, errorMessage?: string) => void;
}

class WechatAuthService extends EventEmitter {
  private token: WechatAuthToken | null = null;
  private state: WechatAuthState = 'disconnected';
  private authPollAbort: AbortController | null = null;

  /** 获取当前认证状态 */
  getState(): WechatAuthState {
    return this.state;
  }

  /** 获取当前 token（如果有效） */
  getToken(): WechatAuthToken | null {
    if (this.token && this.isTokenValid()) {
      return this.token;
    }
    return null;
  }

  /** 检查 token 是否仍然有效 */
  isTokenValid(): boolean {
    if (!this.token) return false;
    return new Date(this.token.expiresAt).getTime() > Date.now();
  }

  /** 从磁盘加载 token */
  async loadToken(): Promise<WechatAuthToken | null> {
    try {
      const content = await fs.readFile(getAuthPath(), 'utf-8');
      this.token = JSON.parse(content) as WechatAuthToken;
      if (this.isTokenValid()) {
        this.setState('connected', this.token.botName);
        return this.token;
      }
      // token 过期
      this.token = null;
      this.setState('expired');
      return null;
    } catch {
      // 文件不存在或解析失败
      this.token = null;
      this.setState('disconnected');
      return null;
    }
  }

  /** 保存 token 到磁盘 */
  private async saveToken(token: WechatAuthToken): Promise<void> {
    const dir = path.dirname(getAuthPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getAuthPath(), JSON.stringify(token, null, 2), 'utf-8');
  }

  /** 清除 token */
  async clearToken(): Promise<void> {
    this.token = null;
    this.stopAuthPoll();
    try {
      await fs.unlink(getAuthPath());
    } catch {
      // 文件不存在也没关系
    }
    this.setState('disconnected');
  }

  /**
   * 启动 QR 码认证流程
   * 1. 调用 getQRCode 获取二维码
   * 2. 返回 QR 信息给渲染层展示
   * 3. 启动状态轮询直到扫码完成或超时
   */
  async startAuth(): Promise<WechatQRCode> {
    this.stopAuthPoll(); // 清理旧的轮询

    const qrRes = await wechatILinkService.getQRCode();
    if (qrRes.ret !== 0 || !qrRes.qrcode || !qrRes.qrcode_img_content) {
      throw new Error(`获取 QR 码失败: ${qrRes.errmsg || `ret=${qrRes.ret}`}`);
    }

    const qrCode: WechatQRCode = {
      qrcodeId: qrRes.qrcode,
      imgUrl: qrRes.qrcode_img_content,
      // QR 码通常 5 分钟过期
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    this.setState('qr_pending');

    // 启动后台轮询 QR 码状态
    this.startAuthPoll(qrCode.qrcodeId);

    return qrCode;
  }

  /**
   * 后台轮询 QR 码扫描状态
   */
  private startAuthPoll(qrcodeId: string): void {
    this.authPollAbort = new AbortController();
    const signal = this.authPollAbort.signal;

    const poll = async () => {
      while (!signal.aborted) {
        try {
          const statusRes = await wechatILinkService.pollQRCodeStatus(qrcodeId, signal);

          if (signal.aborted) return;

          if (statusRes.ret !== 0) {
            // 非 0 通常表示错误
            this.setState('disconnected', undefined, statusRes.errmsg || `ret=${statusRes.ret}`);
            return;
          }

          switch (statusRes.status) {
            case 'wait':
              // 继续等待
              break;

            case 'scaned':
              this.setState('scanning');
              break;

            case 'confirmed': {
              // 认证成功
              if (!statusRes.bot_token) {
                this.setState('disconnected', undefined, '认证成功但未返回 bot_token');
                return;
              }

              const token: WechatAuthToken = {
                botToken: statusRes.bot_token,
                botId: statusRes.ilink_bot_id || '',
                userId: statusRes.ilink_user_id || '',
                baseUrl: statusRes.baseurl || 'https://ilinkai.weixin.qq.com',
                botName: statusRes.nick_name || '微信 Bot',
                connectedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              };

              this.token = token;
              await this.saveToken(token);
              this.setState('connected', token.botName);
              return;
            }

            case 'expired':
              this.setState('expired');
              return;

            default:
              // 未知状态，继续轮询
              break;
          }

          // 短暂等待后继续轮询（iLink 的 get_qrcode_status 本身有长轮询，所以不需要额外 sleep）
        } catch (err: any) {
          if (signal.aborted) return;
          // 网络错误，短暂等待后重试
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    };

    poll().catch(() => { /* 轮询被取消 */ });
  }

  /** 停止 QR 码状态轮询 */
  private stopAuthPoll(): void {
    if (this.authPollAbort) {
      this.authPollAbort.abort();
      this.authPollAbort = null;
    }
  }

  /** 更新状态并发出事件 */
  private setState(state: WechatAuthState, botName?: string, errorMessage?: string): void {
    this.state = state;
    this.emit('stateChange', state, botName, errorMessage);
  }
}

export const wechatAuthService = new WechatAuthService();
