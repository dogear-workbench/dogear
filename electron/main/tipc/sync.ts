// electron/main/tipc/sync.ts
import { tipc } from '@egoist/tipc/main';
import { shell } from 'electron';
import { broadcastToWindows } from '../services/renderer-broadcast.js';
import {
  getLanSyncStatus,
  listPeers,
  onLanSyncStatusChanged,
  onPeersChanged,
} from '../services/sync/lan-sync-service.js';
import {
  beginPairing,
  confirmPairRequest,
  getOutgoingPairingCode,
  getPendingPairRequests,
  onPairRequest,
  onPairingCompleted,
  rejectPairRequest,
} from '../services/sync/pairing.js';
import {
  getRunningSync,
  onSyncProgress,
  runSync,
  type SyncReport,
} from '../services/sync/orchestrator.js';
import { readSyncState, getDataDir } from '../services/sync/sync-state.js';
import { resolveWithinDataDir } from '../services/sync/apply.js';
import { loadSettings, saveSettings, type SyncOptions } from '../services/settings-service.js';
import type { SyncEventPayload } from './renderer-handlers.js';

const t = tipc.create();

function emitSyncEvent(payload: SyncEventPayload): void {
  broadcastToWindows((h) => h.syncEvent.send(payload));
}

export const syncRouter = {
  getSyncStatus: t.procedure
    .input<Record<string, never>>()
    .action(async () => getLanSyncStatus()),

  getPeers: t.procedure
    .input<Record<string, never>>()
    .action(async () => listPeers()),

  getSyncState: t.procedure
    .input<Record<string, never>>()
    .action(async () => readSyncState()),

  getRunningSync: t.procedure
    .input<Record<string, never>>()
    .action(async () => getRunningSync()),

  runSync: t.procedure
    .input<{
      peerId: string;
      confirmVersionMismatch?: boolean;
      /** 同步方向：pull=仅拉取（默认）；push=仅推送；both=双向 */
      direction?: 'both' | 'pull' | 'push';
      /** 双改冲突裁决表（双向/推送档）：key=relPath；缺条目的冲突本轮挂起 */
      conflictResolutions?: Record<string, 'local' | 'remote'>;
    }>()
    .action(async ({ input }): Promise<SyncReport> => {
      const peer = listPeers().find((p) => p.deviceId === input.peerId);
      if (!peer) {
        return {
          status: 'failed',
          ok: false,
          peerId: input.peerId,
          pulled: 0,
          pushed: 0,
          conflicts: [],
          skipped: [],
          warnings: [],
          error: '对端不在线或尚未发现，无法同步',
          durationMs: 0,
          finishedAt: Date.now(),
        };
      }
      return runSync(
        { deviceId: peer.deviceId, host: peer.host, port: peer.port, deviceName: peer.name },
        {
          confirmVersionMismatch: input.confirmVersionMismatch,
          direction: input.direction,
          conflictResolutions: input.conflictResolutions,
        },
      );
    }),

  /** 在系统文件管理器中定位数据目录内文件（冲突副本换回用）：relPath 必须落在数据目录内，防路径逃逸 */
  revealSyncFile: t.procedure
    .input<{ relPath: string }>()
    .action(async ({ input }) => {
      const abs = resolveWithinDataDir(getDataDir(), input.relPath);
      if (!abs) return { success: false as const, error: 'unsafe path' };
      shell.showItemInFolder(abs);
      return { success: true as const };
    }),

  /** 发起配对：立即返回本端展示码供比对，结果经 pairing-completed 事件推送（请求挂着等对端确认，不可 await） */
  requestPair: t.procedure
    .input<{ deviceId: string; host: string; port: number; deviceName?: string }>()
    .action(async ({ input }) => {
      const { code, result } = beginPairing(input);
      result.catch((error) => console.error('[lan-sync] 配对流程异常:', error));
      return { code };
    }),

  getPairCode: t.procedure
    .input<{ deviceId?: string }>()
    .action(async ({ input }) => ({ code: getOutgoingPairingCode(input?.deviceId) })),

  getPendingPairRequests: t.procedure
    .input<Record<string, never>>()
    .action(async () => getPendingPairRequests()),

  confirmPairRequest: t.procedure
    .input<{ requestId: string }>()
    .action(async ({ input }) => ({ ok: await confirmPairRequest(input.requestId) })),

  rejectPairRequest: t.procedure
    .input<{ requestId: string; reason?: string }>()
    .action(async ({ input }) => ({ ok: await rejectPairRequest(input.requestId, input.reason) })),

  /**
   * 精确更新 syncOptions 节而非整体替换 settings：配对由异步事件回写 pairedDevices，
   * 前端若拿旧快照走 updateSettings 会踩掉刚写入的配对
   */
  setSyncOptions: t.procedure
    .input<Partial<SyncOptions> & { removeDeviceId?: string }>()
    .action(async ({ input }): Promise<SyncOptions> => {
      const settings = await loadSettings();
      const sync = settings.syncOptions!;
      if (input.deviceName !== undefined) sync.deviceName = input.deviceName;
      if (input.syncStocksData !== undefined) sync.syncStocksData = input.syncStocksData === true;
      if (input.syncFeishu !== undefined) sync.syncFeishu = input.syncFeishu === true;
      if (input.removeDeviceId) {
        sync.pairedDevices = sync.pairedDevices.filter((d) => d.deviceId !== input.removeDeviceId);
      }
      await saveSettings(settings);
      const { broadcastSettingsChanged } = await import('../main-app.js');
      broadcastSettingsChanged();
      return sync;
    }),
};

/** 服务层事件 → 渲染层广播接线（registerTipcHandlers 调用一次） */
export function registerSyncBroadcaster(): void {
  onLanSyncStatusChanged((status) => emitSyncEvent({ kind: 'status', status }));
  onPeersChanged((peers) => emitSyncEvent({ kind: 'peers', peers }));
  onSyncProgress((event) => emitSyncEvent({ kind: 'sync', event }));
  onPairRequest((request) => emitSyncEvent({ kind: 'pair-request', request }));
  onPairingCompleted((outcome) => emitSyncEvent({ kind: 'pairing-completed', outcome }));
}
