/**
 * pi 会话管理器
 *
 * 主会话（及其派遣的子会话）唯一的运行时管理器：conversation-runtime-service.ts 统一通过
 * getPiSessionManager() 管理会话生命周期（getSession/retain/release/closeSession/
 * bindConversation/getConversationIdBySession 等）。所有会话统一走 pi 运行时
 * （见 pi/provider.ts），旧 SDK 主会话实现已随迁移完成整体移除。
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import { v4 as uuidv4 } from 'uuid';
import { mainLogger } from '../logger.js';
import { broadcastAliveConversations } from '../../services/renderer-broadcast.js';
import { PiSession, type PiSessionConfig, type PiSessionTurnResult } from './pi-session.js';
import { isSessionSnapshotAffected, type SettingsSnapshotDiff } from '../../services/settings-diff.js';
import type { AppSettings } from '../../services/settings-types.js';
import { loadSettings } from '../../services/settings-service.js';
import { resolveAllPendingInterventionsUnattended } from '../../services/browser/human-intervention.js';
import { appendContext as appendUsageContext, appendEntry as appendUsageEntry, appendCompactMarker as appendUsageCompactMarker, readNextTurnIndex } from '../../services/usage/usage-service.js';
import { applyUsageSummary, getByIdGlobal, setPinnedAt } from '../../services/conversation-service.js';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import type { CompactMarker, ContextSnapshot, ConversationUsageEntry } from '../../types.js';
import type { ExtendedSessionMessage } from '../task-types.js';

export const ORPHAN_GRACE_MS = 10 * 60_000;

/** 绿线保活窗档位 → 毫秒；'off'=0 表示非 running 一律不亮 */
const ALIVE_WINDOW_MS: Record<string, number> = {
  off: 0,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};
const ALIVE_WINDOW_DEFAULT_MS = 60 * 60_000;
const ALIVE_SCAN_INTERVAL_MS = 60_000;

let effectiveOrphanGraceMs = ORPHAN_GRACE_MS;

/** 测试注入用：把孤儿复核间隔临时调小以验证超龄强杀，生产路径不调用 */
export function setOrphanGraceMs(ms: number): void {
  effectiveOrphanGraceMs = ms;
}

export function getOrphanGraceMs(): number {
  return effectiveOrphanGraceMs;
}

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
  event: 'message' | 'complete' | 'error' | 'permissionRequest' | 'permissionModeChanged' | 'pendingCountChanged' | 'sessionStateChanged' | 'sessionClosed' | 'compactionFailure',
  payload: unknown,
) => void;

export type SessionCloseSource = 'natural' | 'forced';

export class PiSessionManager extends EventEmitter {
  private sessions: Map<string, PiSession> = new Map();
  // 引用计数：release 归零时，若 session 仍在 running 则进入 orphan 保活（B1），
  // 等 settled 后由 maybeCollectOrphan 回收；否则直接销毁
  private refCounts: Map<string, number> = new Map();
  // 非 UI 保活计数（delegation-bridge 在有 running 直属子会话期间对父会话的存活持有）：
  // 与 refCounts 独立记账，销毁判定要求两者同时归零
  private holds: Map<string, number> = new Map();
  private conversationSessionMap: Map<string, string> = new Map();
  private broadcaster: PiSessionBroadcaster | null = null;
  private logger = mainLogger.child('pi-session-manager');
  // 上次广播的存活集合快照（sorted join），避免无变化的重复广播
  private lastAliveKey = '';
  // 绿线「最近活跃」记录：conversationId → 最后一次收尾（sessionStateChanged running→false）时刻；
  // session 销毁时故意不清（session 释放后窗内绿线仍要亮），由 60s 扫描顺手清理过窗条目
  private lastActivityAt: Map<string, number> = new Map();
  // aliveWindow 档位缓存（毫秒，'off'=0）；null=未加载，invalidateAliveWindowCache 失效
  private aliveWindowMs: number | null = null;
  private aliveScanTimer: NodeJS.Timeout;
  // 孤儿保活超龄复核 timer：保活赌注「卡死会话终会 settle」若有漏网，超龄宁可遗弃强杀也不无限滞留内存
  private orphanTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    this.aliveScanTimer = setInterval(() => {
      this.pruneExpiredActivity();
      void this.broadcastAliveSet();
    }, ALIVE_SCAN_INTERVAL_MS);
    this.aliveScanTimer.unref();
  }

  setBroadcaster(fn: PiSessionBroadcaster): void {
    this.broadcaster = fn;
  }

  async createSession(config: PiSessionConfig): Promise<PiSession> {
    const sessionId = uuidv4();
    this.logger.info('创建 pi 会话:', sessionId.substring(0, 8));

    // usageTurnIndex 续号：会话 JSONL 尾部 ENTRY 的 turnIndex + 1，空文件/读失败回退 0
    const usageTurnIndexStart = await readNextTurnIndex(config.conversationId);
    const session = new PiSession(sessionId, { ...config, usageTurnIndexStart });

    session.on('message', (message: ExtendedSessionMessage) => {
      this.emit('sessionMessage', sessionId, message);
      this.broadcaster?.(sessionId, 'message', message);
    });

    session.on('error', (message: ExtendedSessionMessage) => {
      this.emit('sessionError', sessionId, message);
      this.broadcaster?.(sessionId, 'error', message);
    });

    session.on('complete', (result: PiSessionTurnResult) => {
      this.emit('sessionComplete', sessionId, result);
      this.broadcaster?.(sessionId, 'complete', result);
    });

    // 权限确认请求：与 SDK 侧 conversation-runtime-service 的 permissionRequest 广播路径对称，
    // 走独立 IPC 通道（不经过 ExtendedSessionMessage 消息流），前端 useSessionEvents.ts 消费
    session.on('permissionRequest', (data: { requestId: string; toolName: string; toolInput: unknown }) => {
      this.emit('sessionPermissionRequest', sessionId, data);
      this.broadcaster?.(sessionId, 'permissionRequest', data);
    });

    session.on('permissionModeChanged', (data: { mode: string }) => {
      this.emit('sessionPermissionModeChanged', sessionId, data);
      this.broadcaster?.(sessionId, 'permissionModeChanged', data);
    });

    // 插话队列长度变化（Step 5）：与 SDK 侧 pendingCountChanged 对称
    session.on('pendingCountChanged', (data: { count: number }) => {
      this.emit('sessionPendingCountChanged', sessionId, data);
      this.broadcaster?.(sessionId, 'pendingCountChanged', data);
    });

    // 跑步机状态原子事件（Step 5）：驱动前端 running/pendingAction 两个 Set
    session.on('sessionStateChanged', (data: { conversationId: string; running: boolean; pendingAction: boolean; paused: boolean }) => {
      this.emit('sessionStateChanged', sessionId, data);
      this.broadcaster?.(sessionId, 'sessionStateChanged', data);
      if (!data.running) {
        this.lastActivityAt.set(data.conversationId, Date.now());
        this.redeemConversationPin(data.conversationId);
      }
      void this.broadcastAliveSet();
    });

    // 会话关闭（Step 5）：前端清 running/pendingAction Set 的原子信号
    session.on('sessionClosed', (data: { conversationId: string }) => {
      this.emit('sessionClosed', sessionId, data);
      this.broadcaster?.(sessionId, 'sessionClosed', data);
    });

    // 压缩失败持续态翻转（会话创建后主动对账 + durable 事件推导翻转），前端据此显隐会话告警横幅
    session.on('compactionFailure', (data: { conversationId: string; failed: boolean }) => {
      this.broadcaster?.(sessionId, 'compactionFailure', data);
    });

    // orphan 保活收集（B1）：settled 即保活赌注兑现，先撤防超龄复核再尝试回收
    session.on('settled', () => {
      this.clearOrphanTimer(sessionId);
      void this.broadcastAliveSet();
      this.maybeCollectOrphan(sessionId).catch((error) => {
        this.logger.warn(`maybeCollectOrphan(${sessionId.substring(0, 8)}) 失败（已忽略）:`, error);
      });
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

    // 自动压缩标记落盘（pi-session maybeAutoCompact 发出）：与 entry/context 同一 JSONL
    session.on('usageCompact', async ({ conversationId, marker }: { conversationId?: string; marker: CompactMarker }) => {
      if (!conversationId) return;
      await appendUsageCompactMarker(conversationId, marker);
      broadcastUsageEntryAdded(conversationId);
    });

    this.sessions.set(sessionId, session);
    this.refCounts.set(sessionId, 1);

    // 无人值守开着时新建 main 会话直接 autoExecute（记录值 = 当前设置的模式，供关闭恢复）
    if (config.role === 'main') {
      const appSettings = await loadSettings();
      if (appSettings.ai.unattended) session.takeOverForUnattended();
    }

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
    this.clearOrphanTimer(sessionId);
    this.logger.info(`retain pi session ${sessionId.substring(0, 8)}: refCount=${next}`);
    return next;
  }

  /**
   * 减少引用计数。归零时：session 仍在 running 或被 hold（delegation-bridge 保活）则保活
   * （不从 Map 删除、不摘 conversationSessionMap），等 settled 后由 maybeCollectOrphan 收集；
   * 否则直接销毁。
   * @returns 剩余引用计数
   */
  async release(sessionId: string, source: SessionCloseSource = 'natural'): Promise<number> {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return 0;
    const next = Math.max(0, count - 1);
    this.refCounts.set(sessionId, next);
    this.logger.info(`release pi session ${sessionId.substring(0, 8)}: refCount ${count} -> ${next}`);
    if (next === 0) {
      const session = this.sessions.get(sessionId);
      if (session?.isRunning()) {
        this.logger.info(`pi session ${sessionId.substring(0, 8)} 仍在运行，进入 orphan 保活`);
        this.armOrphanTimer(sessionId);
      } else if (this.isHeld(sessionId)) {
        this.logger.info(`pi session ${sessionId.substring(0, 8)} 被 hold（子会话运行中），进入保活`);
      } else {
        await this._destroySession(sessionId, source);
      }
    }
    return next;
  }

  /** 非 UI 保活：子会话运行期间对父会话的存活持有；session 不在内存时返回 false */
  acquireHold(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    const next = (this.holds.get(sessionId) ?? 0) + 1;
    this.holds.set(sessionId, next);
    this.clearOrphanTimer(sessionId);
    this.logger.info(`hold pi session ${sessionId.substring(0, 8)}: holdCount=${next}`);
    void this.broadcastAliveSet();
    return true;
  }

  /**
   * 释放非 UI 保活。归零时重走与 release 归零相同的判定：refCount 也已归零且
   * session 不在 running 则销毁，仍在 running 则留给 settled → maybeCollectOrphan 收集。
   */
  async releaseHold(sessionId: string): Promise<void> {
    const count = this.holds.get(sessionId);
    if (count === undefined) return;
    const next = count - 1;
    if (next > 0) this.holds.set(sessionId, next);
    else this.holds.delete(sessionId);
    this.logger.info(`release hold pi session ${sessionId.substring(0, 8)}: holdCount ${count} -> ${next}`);
    void this.broadcastAliveSet();
    if (next === 0 && this.refCounts.get(sessionId) === 0) {
      const session = this.sessions.get(sessionId);
      if (session?.isRunning()) {
        this.logger.info(`pi session ${sessionId.substring(0, 8)} 仍在运行，进入 orphan 保活`);
        this.armOrphanTimer(sessionId);
      } else if (session) {
        await this._destroySession(sessionId, 'natural');
      }
    }
  }

  private isHeld(sessionId: string): boolean {
    return (this.holds.get(sessionId) ?? 0) > 0;
  }

  /** 进入孤儿保活时布防超龄复核；重复布防先清旧（release/releaseHold 双入口可能先后触发） */
  private armOrphanTimer(sessionId: string): void {
    this.clearOrphanTimer(sessionId);
    const timer = setTimeout(() => {
      this.orphanTimers.delete(sessionId);
      void this.reapStalledOrphan(sessionId);
    }, effectiveOrphanGraceMs);
    this.orphanTimers.set(sessionId, timer);
  }

  private clearOrphanTimer(sessionId: string): void {
    const timer = this.orphanTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.orphanTimers.delete(sessionId);
  }

  /** 到期复核四条件（仍在 map、refCount 0、未被 hold、仍 running）全满足才销毁；期间被 re-attach / settled 是正常出路 */
  private async reapStalledOrphan(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (this.refCounts.get(sessionId) !== 0) return;
    if (this.isHeld(sessionId)) return;
    if (!session.isRunning()) return;
    this.logger.warn(`orphan pi session ${sessionId.substring(0, 8)} 超龄（${effectiveOrphanGraceMs}ms）仍 running，强制销毁`);
    await this._destroySession(sessionId, 'forced');
  }

  /** 直接关闭会话（忽略引用计数） */
  async closeSession(sessionId: string): Promise<void> {
    await this._destroySession(sessionId, 'forced');
  }

  /**
   * 收集 orphan 会话：refCount==0 且未被 hold 则销毁。由 PiSession 的 settled 事件触发，
   * 用于在 orphan 保活的会话自然跑完后回收。如果期间被 re-attach（retain 过）
   * 或仍被 hold，refCount/holdCount 未归零则跳过。
   */
  async maybeCollectOrphan(sessionId: string): Promise<void> {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return;
    if (count === 0 && !this.isHeld(sessionId)) {
      this.logger.info(`orphan pi session ${sessionId.substring(0, 8)} 已 settled，收集销毁`);
      await this._destroySession(sessionId, 'natural');
    }
  }

  bindConversation(conversationId: string, sessionId: string): void {
    this.conversationSessionMap.set(conversationId, sessionId);
    void this.broadcastAliveSet();
  }

  unbindConversation(conversationId: string): void {
    this.conversationSessionMap.delete(conversationId);
    void this.broadcastAliveSet();
  }

  getSessionIdByConversation(conversationId: string): string | undefined {
    const sessionId = this.conversationSessionMap.get(conversationId);
    if (sessionId && this.sessions.has(sessionId)) return sessionId;
    if (sessionId) this.conversationSessionMap.delete(conversationId);
    return undefined;
  }

  /**
   * 存活会话的 conversationId 集合（绿线语义）：running/pending 恒在；非 running 的收尾距今
   * < aliveWindow 档位也亮，'off' 档仅 running。不依赖 session 在内存——销毁后窗内仍亮，
   * 与 retain/release/orphan 生命周期判定（release/maybeCollectOrphan）零关联。
   */
  getAliveConversationIds(): string[] {
    const windowMs = this.aliveWindowMs ?? ALIVE_WINDOW_DEFAULT_MS;
    const now = Date.now();
    const alive: string[] = [];
    for (const [convId, sid] of this.conversationSessionMap) {
      if (this.sessions.get(sid)?.isRunning()) {
        alive.push(convId);
        continue;
      }
      if (windowMs === 0) continue;
      const last = this.lastActivityAt.get(convId);
      if (last !== undefined && now - last < windowMs) alive.push(convId);
    }
    return alive;
  }

  /** 正在执行 turn 的会话 conversationId 集合（恢复会话备份前的防护查询用） */
  getRunningConversationIds(): string[] {
    const running: string[] = [];
    for (const [convId, sid] of this.conversationSessionMap) {
      if (this.sessions.get(sid)?.isRunning()) running.push(convId);
    }
    return running;
  }

  /** 掐灭/解除挂起时同步熄灭绿线：清「最近活跃」记录并重广播（broadcastAliveSet 自带无变化去重；下次活动照常重新点亮） */
  clearConversationActivity(conversationId: string): void {
    this.lastActivityAt.delete(conversationId);
    void this.broadcastAliveSet();
  }

  /** 使用即兑现：发消息 settle 时自动清 pinnedAt，绿线转自动窗（刚活动本来就亮，视觉无跳变）；失败只影响钉住标记，不阻塞会话流转 */
  private redeemConversationPin(conversationId: string): void {
    void (async () => {
      const found = await getByIdGlobal(conversationId);
      if (!found?.conv.pinnedAt) return;
      await setPinnedAt(found.workspaceId, conversationId, null);
    })().catch((error) => {
      this.logger.warn(`settle 兑现清挂起标记(${conversationId.substring(0, 8)})失败（已忽略）:`, error);
    });
  }

  /** 存活集合变化才广播（全量列表，前端整体替换；失败不影响主链）；档位缓存未热时先异步读盘 */
  private async broadcastAliveSet(): Promise<void> {
    await this.resolveAliveWindowMs();
    const key = this.getAliveConversationIds().sort().join(',');
    if (key === this.lastAliveKey) return;
    this.lastAliveKey = key;
    broadcastAliveConversations(key ? key.split(',') : []);
  }

  private async resolveAliveWindowMs(): Promise<void> {
    if (this.aliveWindowMs !== null) return;
    try {
      const settings = await loadSettings();
      this.aliveWindowMs = ALIVE_WINDOW_MS[settings.ui?.aliveWindow ?? '1h'] ?? ALIVE_WINDOW_DEFAULT_MS;
    } catch (error) {
      this.logger.warn('读取 aliveWindow 档位失败（按缺省 1h 处理）:', error);
      this.aliveWindowMs = ALIVE_WINDOW_DEFAULT_MS;
    }
  }

  /** aliveWindow 档位变更接线点：失效缓存并立即按新窗重算广播（设置页保存走这里热生效） */
  invalidateAliveWindowCache(): void {
    this.aliveWindowMs = null;
    void this.broadcastAliveSet();
  }

  /** 扫描顺手清理过窗条目（'off' 档全清）；缓存未热时跳过一轮，防按缺省档误删长档位记录 */
  private pruneExpiredActivity(): void {
    if (this.aliveWindowMs === null) return;
    const now = Date.now();
    for (const [convId, last] of this.lastActivityAt) {
      if (now - last >= this.aliveWindowMs) this.lastActivityAt.delete(convId);
    }
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
  private async _destroySession(sessionId: string, source: SessionCloseSource): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const conversationIds: string[] = [];
    for (const [convId, sid] of this.conversationSessionMap) {
      if (sid === sessionId) {
        this.conversationSessionMap.delete(convId);
        conversationIds.push(convId);
      }
    }
    this.sessions.delete(sessionId);
    this.refCounts.delete(sessionId);
    this.holds.delete(sessionId);
    this.clearOrphanTimer(sessionId);
    void this.broadcastAliveSet();

    try {
      await session.close();
    } catch (error) {
      // close() 内部（adapter.abort()）已经吞掉 harness 聚合异常，这里只是双重兜底，
      // 确保 release()/closeSession() 的调用方（tipc handler）永远不会收到未处理 rejection。
      this.logger.warn('pi 会话关闭时出错（已忽略）:', error);
    }
    this.logger.info('pi 会话已关闭:', sessionId.substring(0, 8));

    // 动态 import 规避调度器加载时序/循环依赖；fire-and-forget，失败不阻塞销毁
    if (source === 'natural' && conversationIds.length > 0) {
      for (const conversationId of conversationIds) {
        this.logger.info('会话自然销毁，通知调度器', conversationId);
        void import('../../services/scheduler/scheduler-service.js')
          .then((m) => m.getSchedulerService().handleSessionClose(conversationId))
          .catch((error: unknown) => {
            this.logger.warn(`通知调度器会话关闭失败（已忽略）: ${conversationId}`, error);
          });
      }
    }

    // 会话收尾关闭 agent 窗口；动态 import 对齐调度器模式，closeAll（应用退出）不走本方法
    if (conversationIds.length > 0) {
      for (const conversationId of conversationIds) {
        void import('../../services/browser/session-tab-cleanup.js')
          .then((m) => m.cleanupSessionTabs(conversationId))
          .catch((error: unknown) => {
            this.logger.warn(`会话收尾清理失败（已忽略）: ${conversationId}`, error);
          });
      }
    }
  }

  /**
   * app 退出路径：不能因为某个 session 卡在 abort() 收尾（例如等待模型 API 请求超时）
   * 而阻塞进程退出，对每个 session 加超时兜底；超时或出错都只 warn 不外抛，
   * 保证不产生未处理 rejection。
   */
  closeAll(): void {
    const sessions = Array.from(this.sessions.values());
    clearInterval(this.aliveScanTimer);
    this.conversationSessionMap.clear();
    this.sessions.clear();
    this.refCounts.clear();
    this.holds.clear();
    for (const timer of this.orphanTimers.values()) clearTimeout(timer);
    this.orphanTimers.clear();

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

  /**
   * 热更新指定 workspaceId 下所有活跃 PiSession 的附加路径。
   * 每次调用都重算 [primary, ...enabled] 全量覆盖 env.allowedPaths。
   */
  updateWorkspacePaths(workspaceId: string, enabledPaths: string[]): void {
    for (const session of this.sessions.values()) {
      if (session.getWorkspaceId() === workspaceId) {
        session.updateWorkspacePaths(enabledPaths);
      }
    }
  }

  /** 工作区配置（能力包开关等）变更后对标定工作区的活跃会话标脏，下轮 sendMessage 前重走 start() 消费新配置 */
  markWorkspaceSessionsDirty(workspaceId: string): void {
    for (const session of this.sessions.values()) {
      if (session.getWorkspaceId() === workspaceId) {
        session.markSnapshotDirty();
      }
    }
  }

  /**
   * 设置快照域变更分发：permissionMode 走热 setter，其余命中域对受影响会话标脏，
   * 各会话在下轮 sendMessage（idle）前自行重建，不无差别杀会话。
   */
  applySettingsSnapshotDiff(diff: SettingsSnapshotDiff, next: AppSettings): void {
    for (const session of this.sessions.values()) {
      if (diff.permissionModeChanged && session.getRole() === 'main') {
        void session.setPermissionMode(next.ai.permissionMode);
      }
      const affected = isSessionSnapshotAffected(diff, {
        role: session.getRole(),
        configModelSelection: session.getConfigModelSelection(),
        currentModelSelection: session.getCurrentModelSelection(),
        subAgentProfileId: session.getSubAgentProfileId(),
      }, next);
      if (affected) {
        this.logger.info(`设置快照域变更，会话 ${session.getSessionId().substring(0, 8)} 受影响`);
        session.markSnapshotDirty();
      }
    }
    if (diff.unattendedChanged) {
      // 仅作用活跃 main 会话（子会话固定 autoExecute 不碰；执行会话语义重合叠加无冲突）；
      // 权限判定链不改（decideToolPermission 首分支 autoExecute 即全放行），只做模式接管 + 欠账清偿
      for (const session of this.sessions.values()) {
        if (session.getRole() !== 'main') continue;
        if (next.ai.unattended) {
          const released = session.resolveAllPendingPermissions(true);
          session.takeOverForUnattended();
          if (released > 0) {
            this.logger.info(`无人值守开启：会话 ${session.getSessionId().substring(0, 8)} 放行挂起权限请求 ${released} 条`);
          }
        } else {
          session.restoreFromUnattended();
        }
      }
      if (next.ai.unattended) {
        const skipped = resolveAllPendingInterventionsUnattended();
        if (skipped > 0) {
          this.logger.info(`无人值守开启：批量跳过挂起介入 ${skipped} 条`);
          void import('../../services/feishu/feishu-notify-outlet.js')
            .then((m) => m.feishuNotifyOutlet.pushDirect({
              title: '无人值守已开启',
              summary: `已自动跳过 ${skipped} 条挂起人工介入，相关会话将自行换路`,
            }))
            .catch((error) => this.logger.warn('无人值守开启推送失败:', error));
        }
      } else {
        void import('../unattended-retry.js')
          .then((m) => m.releaseAllUnattendedRetries())
          .catch((error) => this.logger.warn('无人值守关闭取消在途重试失败:', error));
      }
      this.logger.info(`无人值守开关切换为 ${next.ai.unattended}`);
    }
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
