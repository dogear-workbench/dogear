/**
 * pi 会话管理器（阶段二 Step 1：walking skeleton）
 *
 * 独立于 QueryBasedSessionManager，不改造/不依赖它。方法面对齐（getSession/retain/release/
 * closeSession/bindConversation/getConversationIdBySession 等），供 conversation-runtime-service.ts
 * 按 ModelProfile.apiFormat 路由使用。
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import { v4 as uuidv4 } from 'uuid';
import { mainLogger } from '../logger.js';
import { PiSession, type PiSessionConfig } from './pi-session.js';
import { appendEntry as appendUsageEntry } from '../../services/usage/usage-service.js';
import { applyUsageSummary } from '../../services/conversation-service.js';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import type { ConversationUsageEntry } from '../../types.js';
import type { ExtendedSessionMessage } from '../task-types.js';

function broadcastUsageEntryAdded(conversationId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      getRendererHandlers<RendererHandlers>(win.webContents).usageEntryAdded.send({ conversationId });
    } catch {
      // 单窗口失败不影响其他窗口
    }
  }
}

/** 广播函数类型：将 session 事件发给所有渲染层窗口，注册方式与 QueryBasedSessionManager 对称但相互独立 */
type PiSessionBroadcaster = (
  sessionId: string,
  event: 'message' | 'complete' | 'error' | 'permissionRequest' | 'pendingCountChanged' | 'sessionStateChanged' | 'sessionClosed',
  payload: unknown,
) => void;

export class PiSessionManager extends EventEmitter {
  private sessions: Map<string, PiSession> = new Map();
  // 引用计数：与 QueryBasedSessionManager 语义一致，但阶段一没有"跑步机模式"——
  // release 归零直接销毁（pi 阶段一无工具副作用需要跑完收尾，Step 3+ 引入工具后需重新评估）
  private refCounts: Map<string, number> = new Map();
  private conversationSessionMap: Map<string, string> = new Map();
  private broadcaster: PiSessionBroadcaster | null = null;
  private logger = mainLogger.child('pi-session-manager');

  setBroadcaster(fn: PiSessionBroadcaster): void {
    this.broadcaster = fn;
  }

  createSession(config: PiSessionConfig): PiSession {
    const sessionId = uuidv4();
    this.logger.info('创建 pi 会话:', sessionId.substring(0, 8));

    const session = new PiSession(sessionId, config);

    session.on('message', (message: ExtendedSessionMessage) => {
      this.emit('sessionMessage', sessionId, message);
      this.broadcaster?.(sessionId, 'message', message);
    });

    session.on('error', (message: ExtendedSessionMessage) => {
      this.emit('sessionError', sessionId, message);
      this.broadcaster?.(sessionId, 'error', message);
    });

    session.on('complete', (result: unknown) => {
      this.emit('sessionComplete', sessionId, result);
      this.broadcaster?.(sessionId, 'complete', result);
    });

    // 权限确认请求：与 SDK 侧 conversation-runtime-service 的 permissionRequest 广播路径对称，
    // 走独立 IPC 通道（不经过 ExtendedSessionMessage 消息流），前端 useSessionEvents.ts 消费
    session.on('permissionRequest', (data: { requestId: string; toolName: string; toolInput: unknown }) => {
      this.emit('sessionPermissionRequest', sessionId, data);
      this.broadcaster?.(sessionId, 'permissionRequest', data);
    });

    // 插话队列长度变化（Step 5）：与 SDK 侧 pendingCountChanged 对称
    session.on('pendingCountChanged', (data: { count: number }) => {
      this.emit('sessionPendingCountChanged', sessionId, data);
      this.broadcaster?.(sessionId, 'pendingCountChanged', data);
    });

    // 跑步机状态原子事件（Step 5）：驱动前端 running/pendingAction 两个 Set
    session.on('sessionStateChanged', (data: { conversationId: string; running: boolean; pendingAction: boolean }) => {
      this.emit('sessionStateChanged', sessionId, data);
      this.broadcaster?.(sessionId, 'sessionStateChanged', data);
    });

    // 会话关闭（Step 5）：前端清 running/pendingAction Set 的原子信号
    session.on('sessionClosed', (data: { conversationId: string }) => {
      this.emit('sessionClosed', sessionId, data);
      this.broadcaster?.(sessionId, 'sessionClosed', data);
    });

    // usage 提取（Step 6）：先 await 落盘再广播，否则前端 refetch 会读到尚未写入的 JSONL。
    // 与 SDK 侧 QueryBasedSessionManager 的 usage 监听器完全对称，前端 usage 徽章零改动复用。
    session.on('usage', async ({ conversationId, entry }: { conversationId?: string; entry: ConversationUsageEntry }) => {
      if (!conversationId) return;
      await appendUsageEntry(conversationId, entry);
      applyUsageSummary(conversationId, entry).catch(() => {});
      broadcastUsageEntryAdded(conversationId);
    });

    this.sessions.set(sessionId, session);
    this.refCounts.set(sessionId, 1);

    return session;
  }

  getSession(sessionId: string): PiSession | undefined {
    return this.sessions.get(sessionId);
  }

  retain(sessionId: string): number {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return 0;
    const next = count + 1;
    this.refCounts.set(sessionId, next);
    this.logger.info(`retain pi session ${sessionId.substring(0, 8)}: refCount=${next}`);
    return next;
  }

  /**
   * 减少引用计数。归零即销毁——阶段一没有需要"跑完再收尾"的后台副作用（无工具）。
   * @returns 剩余引用计数
   */
  release(sessionId: string): number {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return 0;
    const next = Math.max(0, count - 1);
    this.refCounts.set(sessionId, next);
    this.logger.info(`release pi session ${sessionId.substring(0, 8)}: refCount ${count} -> ${next}`);
    if (next === 0) {
      this._destroySession(sessionId);
    }
    return next;
  }

  /** 直接关闭会话（忽略引用计数） */
  closeSession(sessionId: string): void {
    this._destroySession(sessionId);
  }

  bindConversation(conversationId: string, sessionId: string): void {
    this.conversationSessionMap.set(conversationId, sessionId);
  }

  unbindConversation(conversationId: string): void {
    this.conversationSessionMap.delete(conversationId);
  }

  getSessionIdByConversation(conversationId: string): string | undefined {
    const sessionId = this.conversationSessionMap.get(conversationId);
    if (sessionId && this.sessions.has(sessionId)) return sessionId;
    if (sessionId) this.conversationSessionMap.delete(conversationId);
    return undefined;
  }

  getConversationIdBySession(sessionId: string): string | undefined {
    for (const [convId, sid] of this.conversationSessionMap) {
      if (sid === sessionId) return convId;
    }
    return undefined;
  }

  private _destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [convId, sid] of this.conversationSessionMap) {
      if (sid === sessionId) this.conversationSessionMap.delete(convId);
    }

    session.close();
    this.sessions.delete(sessionId);
    this.refCounts.delete(sessionId);
    this.logger.info('pi 会话已关闭:', sessionId.substring(0, 8));
  }

  closeAll(): void {
    this.conversationSessionMap.clear();
    this.sessions.forEach((session) => session.close());
    this.sessions.clear();
    this.refCounts.clear();
  }

  getActiveCount(): number {
    return this.sessions.size;
  }
}

let piSessionManagerInstance: PiSessionManager | null = null;

export function getPiSessionManager(): PiSessionManager {
  if (!piSessionManagerInstance) {
    piSessionManagerInstance = new PiSessionManager();
  }
  return piSessionManagerInstance;
}

export function shutdownPiSessionManager(): void {
  if (piSessionManagerInstance) {
    piSessionManagerInstance.closeAll();
    piSessionManagerInstance = null;
  }
}
