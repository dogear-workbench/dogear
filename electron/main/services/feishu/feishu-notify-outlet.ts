import { mainLogger } from '../../agents/logger.js';
import { feishuConfigService } from './feishu-config-service.js';
import { feishuClientService } from './feishu-client-service.js';
import { feishuThreadService } from './feishu-thread-service.js';

const log = mainLogger.child('feishu-notify-outlet');

const THREAD_NOT_EXIST_CODE = 230019;
const MAX_SUMMARY_LENGTH = 4000;
const TRUNCATE_SUFFIX = '（已截断，完整内容见应用内）';

interface NotifyEntrySnapshot {
  dedupeKey: string;
  title: string;
  summary?: string;
  count: number;
  owner: { kind: 'system' } | { kind: 'conversation'; conversationId: string };
  workspaceId?: string;
  ownerLabel?: string;
}

function formatText(entry: NotifyEntrySnapshot): string {
  const label = entry.ownerLabel || '通知';
  let summary = entry.summary ?? '';
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_SUMMARY_LENGTH) + TRUNCATE_SUFFIX;
  }
  return `【${label}】${entry.title}${summary ? `\n${summary}` : ''}`;
}

interface SendResult {
  ok: boolean;
  error?: string;
}

class FeishuNotifyOutlet {
  private unregisterListener: (() => void) | null = null;

  async register(): Promise<void> {
    if (this.unregisterListener) return;
    const { getNotificationCenterService } = await import('../notification-center-service.js');
    this.unregisterListener = getNotificationCenterService().onAdd((entry) => this.handleEntry(entry));
    log.info('飞书通知推送出口已挂载');
  }

  unregister(): void {
    if (!this.unregisterListener) return;
    this.unregisterListener();
    this.unregisterListener = null;
    log.info('飞书通知推送出口已摘除');
  }

  private handleEntry(entry: NotifyEntrySnapshot): void {
    void this.push(entry).catch((err) => {
      log.warn('通知推送异常', err);
    });
  }

  private async push(entry: NotifyEntrySnapshot): Promise<void> {
    if (entry.count > 1) return;
    const config = await feishuConfigService.loadConfig();
    if (!config) return;
    if (config.notifyPush === false) return;
    if (!feishuClientService.isRunning()) return;

    const text = formatText(entry);
    let sent: SendResult;
    if (entry.owner.kind === 'conversation') {
      const binding = entry.workspaceId
        ? await feishuThreadService.threadBindings.byConversation(entry.workspaceId, entry.owner.conversationId)
        : await feishuThreadService.threadBindings.firstByConversation(entry.owner.conversationId);
      if (binding) {
        sent = await feishuClientService.replyText(binding.rootMessageId, text);
        if (!sent.ok && 'code' in sent && sent.code === THREAD_NOT_EXIST_CODE) {
          log.warn(`通知推送话题失效，转私聊兜底: ${sent.error}`);
          sent = await this.sendDirectOrSkip(config.userOpenId, text);
        }
      } else {
        sent = await this.sendDirectOrSkip(config.userOpenId, text);
      }
    } else {
      sent = await this.sendDirectOrSkip(config.userOpenId, text);
    }
    if (!sent.ok) log.warn(`通知推送失败: ${sent.error}`);
  }

  /** 无人值守等系统级事件直连推送：不进通知中心避免噪音；配置缺失/推送关闭/机器人未运行时静默跳过 */
  async pushDirect(input: { conversationId?: string; workspaceId?: string; title: string; summary?: string }): Promise<void> {
    const entry: NotifyEntrySnapshot = {
      dedupeKey: `unattended-direct-${Date.now()}`,
      title: input.title,
      summary: input.summary,
      count: 1,
      owner: input.conversationId
        ? { kind: 'conversation', conversationId: input.conversationId }
        : { kind: 'system' },
      workspaceId: input.workspaceId,
      ownerLabel: '无人值守',
    };
    await this.push(entry).catch((err) => {
      log.warn('直连推送异常', err);
    });
  }

  private async sendDirectOrSkip(openId: string | undefined, text: string): Promise<SendResult> {
    if (!openId) return { ok: false, error: '未记录 userOpenId，跳过私聊推送' };
    return feishuClientService.sendDirectText(openId, text);
  }
}

export const feishuNotifyOutlet = new FeishuNotifyOutlet();
