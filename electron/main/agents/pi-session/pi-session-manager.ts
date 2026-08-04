/**
 * pi 会话管理器
 *
 * 主会话（及其派遣的子会话）唯一的运行时管理器：conversation-runtime-service.ts 统一通过
 * getPiSessionManager() 管理会话生命周期（getSession/retain/release/closeSession/
 * bindConversation/getConversationIdBySession 等）。ModelProfile.apiFormat 字段仍然存在，
 * 但现在只服务模型选择器 UI 的三档 tier vs 自由 piModels 列表展示（见 pi/provider.ts、
 * lib/model-selection.ts），不再决定运行时路由——旧 SDK 主会话实现已随迁移完成整体移除。
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import { v4 as uuidv4 } from 'uuid';
import { mainLogger } from '../logger.js';
import { PiSession, type PiSessionConfig } from './pi-session.js';
import { appendContext as appendUsageContext, appendEntry as appendUsageEntry } from '../../services/usage/usage-service.js';
import { applyUsageSummary } from '../../services/conversation-service.js';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import type { ContextSnapshot, ConversationUsageEntry } from '../../types.js';
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

/** 广播函数类型：将 session 事件（message/complete/error/permissionRequest 等）发给所有渲染层窗口 */
type PiSessionBroadcaster = (
  sessionId: string,
  event: 'message' | 'complete' | 'error' | 'permissionRequest' | 'pendingCountChanged' | 'sessionStateChanged' | 'sessionClosed',
  payload: unknown,
) => void;

export class PiSessionManager extends EventEmitter {
  private sessions: Map<string, PiSession> = new Map();
  // 引用计数：release 归零即直接销毁，不做旧 SDK 主会话运行时那种"跑步机保活"
  // （running/pending 时延迟关闭）——当前 pi 会话结构下尚未引入这层区分
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
    // 落盘格式与旧 SDK 主会话运行时一致，前端 usage 徽章零改动复用。
    session.on('usage', async ({ conversationId, entry }: { conversationId?: string; entry: ConversationUsageEntry }) => {
      if (!conversationId) return;
      await appendUsageEntry(conversationId, entry);
      applyUsageSummary(conversationId, entry).catch(() => {});
      broadcastUsageEntryAdded(conversationId);
    });

    session.on('usageContext', async ({ conversationId, snapshot }: { conversationId?: string; snapshot: ContextSnapshot }) => {
      if (!conversationId) return;
      await appendUsageContext(conversationId, snapshot);
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
  async release(sessionId: string): Promise<number> {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return 0;
    const next = Math.max(0, count - 1);
    this.refCounts.set(sessionId, next);
    this.logger.info(`release pi session ${sessionId.substring(0, 8)}: refCount ${count} -> ${next}`);
    if (next === 0) {
      await this._destroySession(sessionId);
    }
    return next;
  }

  /** 直接关闭会话（忽略引用计数） */
  async closeSession(sessionId: string): Promise<void> {
    await this._destroySession(sessionId);
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

  /**
   * 先从 sessions/refCounts/conversationSessionMap 摘除，再 await 实际收尾——
   * 摘除动作本身不耗时，保证即使 session.close() 卡住，这个 sessionId 在 manager
   * 层面也已经不可再被外部拿到（不会被重复 retain/release）。
   */
  private async _destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [convId, sid] of this.conversationSessionMap) {
      if (sid === sessionId) this.conversationSessionMap.delete(convId);
    }
    this.sessions.delete(sessionId);
    this.refCounts.delete(sessionId);

    try {
      await session.close();
    } catch (error) {
      // close() 内部（adapter.abort()）已经吞掉 harness 聚合异常，这里只是双重兜底，
      // 确保 release()/closeSession() 的调用方（tipc handler）永远不会收到未处理 rejection。
      this.logger.warn('pi 会话关闭时出错（已忽略）:', error);
    }
    this.logger.info('pi 会话已关闭:', sessionId.substring(0, 8));
  }

  /**
   * app 退出路径：不能因为某个 session 卡在 abort() 收尾（例如等待模型 API 请求超时）
   * 而阻塞进程退出，对每个 session 加超时兜底；超时或出错都只 warn 不外抛，
   * 保证不产生未处理 rejection。
   */
  closeAll(): void {
    const sessions = Array.from(this.sessions.values());
    this.conversationSessionMap.clear();
    this.sessions.clear();
    this.refCounts.clear();

    const CLOSE_ALL_TIMEOUT_MS = 5000;
    for (const session of sessions) {
      Promise.race([
        session.close(),
        new Promise<void>((resolve) => setTimeout(resolve, CLOSE_ALL_TIMEOUT_MS)),
      ]).catch((error) => {
        this.logger.warn('closeAll: 会话关闭失败（已忽略，进程即将退出）:', error);
      });
    }
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
