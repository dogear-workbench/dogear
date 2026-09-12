/**
 * 顶部消息中心存储 service：系统级（任务 review/中断/失败）+ 会话级（子会话交付/终态，归属父会话）
 * 两类事件的聚合收件箱，JSON 持久化（getConfigDir()/notifications.json），跳转定位在渲染层完成。
 * 系统 toast（session-notification-service）独立保留，本 service 是聚合层不替代它。
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getConfigDir, mainLogger } from '../agents/logger.js';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';

const log = mainLogger.child('notification-center');

export type NotificationOwner =
  | { kind: 'system' }
  | { kind: 'conversation'; conversationId: string };

export interface NotificationCenterEntry {
  id: string;
  type: 'task' | 'conversation';
  /** 同源聚合键（task:{taskId}:{kind} / conversation:{childId}:{kind}），未读同源事件合并为一条 */
  dedupeKey: string;
  title: string;
  summary?: string;
  createdAt: string;
  read: boolean;
  /** 同源未读重复事件聚合计数，≥2 时面板显示 ×N */
  count: number;
  owner: NotificationOwner;
  /** type=task 的跳转定位 */
  taskId?: string;
  /** 跳转定位所属工作区 */
  workspaceId?: string;
  /** 归属名（父会话标题 / 系统） */
  ownerLabel?: string;
}

export interface AddNotificationInput {
  type: 'task' | 'conversation';
  dedupeKey: string;
  title: string;
  summary?: string;
  owner: NotificationOwner;
  taskId?: string;
  workspaceId?: string;
  ownerLabel?: string;
}

interface NotificationsFile {
  version: 1;
  entries: NotificationCenterEntry[];
}

const MAX_ENTRIES = 100;

function emptyFile(): NotificationsFile {
  return { version: 1, entries: [] };
}

function generateId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

class NotificationCenterService {
  private storagePath: string | null = null;
  private writing: Promise<void> = Promise.resolve();

  private getFilePath(): string {
    return this.storagePath ?? path.join(getConfigDir(), 'notifications.json');
  }

  /** 测试注入用：隔离真实配置目录 */
  setStoragePathForTest(p: string): void {
    this.storagePath = p;
  }

  private async readFile(): Promise<NotificationsFile> {
    return safeJsonRead(this.getFilePath(), emptyFile());
  }

  private async persist(entries: NotificationCenterEntry[], unreadCount: number): Promise<void> {
    const prev = this.writing;
    this.writing = (async () => {
      await prev;
      try {
        await safeJsonWrite(this.getFilePath(), { version: 1, entries } satisfies NotificationsFile);
      } catch (err) {
        log.warn('通知持久化失败', err);
      }
    })();
    await this.writing;
    await broadcastNotificationsChanged(unreadCount);
  }

  private countUnread(entries: NotificationCenterEntry[]): number {
    return entries.reduce((n, e) => (e.read ? n : n + 1), 0);
  }

  async add(input: AddNotificationInput): Promise<void> {
    const file = await this.readFile();
    const entries = file.entries;
    const now = new Date().toISOString();
    const target = entries.find((e) => !e.read && e.dedupeKey === input.dedupeKey);
    if (target) {
      target.title = input.title;
      if (input.summary !== undefined) target.summary = input.summary;
      if (input.workspaceId) target.workspaceId = input.workspaceId;
      if (input.ownerLabel) target.ownerLabel = input.ownerLabel;
      target.createdAt = now;
      target.count += 1;
    } else {
      entries.unshift({
        id: generateId(),
        type: input.type,
        dedupeKey: input.dedupeKey,
        title: input.title,
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        createdAt: now,
        read: false,
        count: 1,
        owner: input.owner,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
      });
    }
    if (entries.length > MAX_ENTRIES) {
      // 优先丢弃已读旧条目，仍超限再丢最旧未读（新条目在头部，尾部即最旧）
      for (let i = entries.length - 1; i >= 0 && entries.length > MAX_ENTRIES; i--) {
        if (entries[i].read) entries.splice(i, 1);
      }
      while (entries.length > MAX_ENTRIES) entries.pop();
    }
    await this.persist(entries, this.countUnread(entries));
  }

  async list(): Promise<NotificationCenterEntry[]> {
    const file = await this.readFile();
    return file.entries.map((e) => ({ ...e }));
  }

  async markRead(id: string): Promise<void> {
    const file = await this.readFile();
    const target = file.entries.find((e) => e.id === id);
    if (!target || target.read) return;
    target.read = true;
    await this.persist(file.entries, this.countUnread(file.entries));
  }

  async markAllRead(): Promise<void> {
    const file = await this.readFile();
    if (file.entries.every((e) => e.read)) return;
    for (const e of file.entries) e.read = true;
    await this.persist(file.entries, 0);
  }

  async remove(id: string): Promise<void> {
    const file = await this.readFile();
    const next = file.entries.filter((e) => e.id !== id);
    if (next.length === file.entries.length) return;
    await this.persist(next, this.countUnread(next));
  }

  async clearAll(): Promise<void> {
    const file = await this.readFile();
    if (file.entries.length === 0) return;
    await this.persist([], 0);
  }

  async pruneExpired(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const file = await this.readFile();
    const cutoff = Date.now() - maxAgeMs;
    const next = file.entries.filter((e) => !e.read || Date.parse(e.createdAt) >= cutoff);
    if (next.length === file.entries.length) return 0;
    await this.persist(next, this.countUnread(next));
    return file.entries.length - next.length;
  }
}

let instance: NotificationCenterService | null = null;

// 动态 import：tipc/main 静态链在 bun test 下解析 electron named export 会炸，与 task-service 广播同模式
async function broadcastNotificationsChanged(unreadCount: number): Promise<void> {
  try {
    const [{ getRendererHandlers }, { broadcastToWindows }] = await Promise.all([
      import('@egoist/tipc/main'),
      import('./renderer-broadcast.js'),
    ]);
    broadcastToWindows((h) => h.notificationsChanged.send({ unreadCount }));
  } catch {
    // 非 Electron 环境（冒烟脚本/单测）无窗口可广播
  }
}

export function getNotificationCenterService(): NotificationCenterService {
  if (!instance) instance = new NotificationCenterService();
  return instance;
}
