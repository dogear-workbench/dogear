import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { showConfirm } from '@/stores/confirm-store';
import type { SyncReport } from '@/electron/main/services/sync/orchestrator';
import type { PairingRequestInfo } from '@/electron/main/services/sync/pairing';
import type { LanSyncStatus } from '@/electron/main/services/sync/lan-sync-service';
import type { PeerInfo } from '@/electron/main/services/sync/discovery';
import type { SyncState } from '@/electron/main/services/sync/sync-state';
import type { SyncOptions } from '@/electron/main/services/settings-types';

/** 与主进程 pairing.ts 的 PENDING_TTL_MS 一致：超时的入站配对请求不再展示 */
export const PAIR_REQUEST_TTL_MS = 150_000;

interface SyncStoreState {
  status: LanSyncStatus | null;
  peers: PeerInfo[];
  syncOptions: SyncOptions | null;
  syncState: SyncState | null;
  runningSync: { peerId: string; startedAt: number } | null;
  lastReport: SyncReport | null;
  pendingPairRequests: PairingRequestInfo[];
  outgoingPairing: { deviceId: string; code: string } | null;
  /** 通知中心「前往同步」跳转请求：自增值，数据中心页消费后归零 */
  syncPanelFocusAt: number;

  /** 数据中心页挂载时调用：拉全量 + 订阅主进程 syncEvent，返回取消订阅 */
  subscribe: () => () => void;
  refresh: () => Promise<void>;
  runSync: (peerId: string) => Promise<void>;
  requestPair: (peer: PeerInfo) => Promise<void>;
  confirmPairRequest: (requestId: string) => Promise<void>;
  rejectPairRequest: (requestId: string) => Promise<void>;
  updateSyncOptions: (patch: Partial<SyncOptions> & { removeDeviceId?: string }) => Promise<void>;
  requestSyncPanelFocus: () => void;
  consumeSyncPanelFocus: () => void;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: null,
  peers: [],
  syncOptions: null,
  syncState: null,
  runningSync: null,
  lastReport: null,
  pendingPairRequests: [],
  outgoingPairing: null,
  syncPanelFocusAt: 0,

  subscribe: () => {
    void get().refresh();
    return rendererEvents.syncEvent.listen((payload) => {
      switch (payload.kind) {
        case 'status':
          set({ status: payload.status });
          break;
        case 'peers':
          set({ peers: payload.peers });
          break;
        case 'sync':
          if (payload.event.kind === 'started') {
            set({ runningSync: { peerId: payload.event.peerId, startedAt: payload.event.startedAt } });
          } else {
            set({ runningSync: null, lastReport: payload.event.report });
            void get().refresh();
          }
          break;
        case 'pair-request':
          set((s) => ({
            pendingPairRequests: [
              ...s.pendingPairRequests.filter((r) => r.requestId !== payload.request.requestId),
              payload.request,
            ],
          }));
          break;
        case 'pairing-completed': {
          const outcome = payload.outcome;
          set((s) => ({
            outgoingPairing: outcome.direction === 'outgoing' ? null : s.outgoingPairing,
            pendingPairRequests:
              outcome.direction === 'incoming'
                ? s.pendingPairRequests.filter((r) => r.peer.deviceId !== outcome.deviceId)
                : s.pendingPairRequests,
          }));
          if (outcome.ok) {
            toast.success(`已与 ${outcome.deviceName ?? '对端设备'} 完成配对`);
            void get().refresh();
          } else if (outcome.error) {
            toast.error('配对未完成', { description: outcome.error });
          }
          break;
        }
      }
    });
  },

  refresh: async () => {
    try {
      const [status, peers, syncState, running, requests, settingsResult] = await Promise.all([
        client.getSyncStatus({}),
        client.getPeers({}),
        client.getSyncState({}),
        client.getRunningSync({}),
        client.getPendingPairRequests({}),
        client.getSettings(),
      ]);
      set({
        status,
        peers: peers ?? [],
        syncState,
        runningSync: running ?? null,
        pendingPairRequests: requests ?? [],
        syncOptions: settingsResult.settings?.syncOptions ?? null,
      });
    } catch (error) {
      console.error('[sync] 状态拉取失败:', error);
    }
  },

  runSync: async (peerId) => {
    try {
      let report = await client.runSync({ peerId });
      if (report.status === 'blocked' && report.confirmRequired === 'protocol-version-mismatch') {
        const ok = await showConfirm(
          '协议版本不一致',
          `${report.warnings[0] ?? '对端协议版本与本端不同'}，同步可能损坏数据。仍要继续吗？`,
        );
        if (!ok) return;
        report = await client.runSync({ peerId, confirmVersionMismatch: true });
      }
      set({ lastReport: report, runningSync: null });
      if (report.status === 'completed') {
        const extra = [
          report.conflicts.length > 0 ? `冲突 ${report.conflicts.length}` : null,
          report.skipped.length > 0 ? `跳过 ${report.skipped.length}` : null,
        ].filter(Boolean);
        toast.success(`同步完成：拉取 ${report.pulled} · 推送 ${report.pushed}`, {
          description: extra.length > 0 ? extra.join(' · ') : undefined,
        });
      } else if (report.status === 'failed') {
        toast.error('同步失败', { description: report.error });
      } else if (report.status === 'in-progress') {
        toast.info('已有同步正在进行，请稍后再试');
      }
    } catch (error) {
      toast.error('同步失败', { description: String(error) });
    }
  },

  requestPair: async (peer) => {
    try {
      const { code } = await client.requestPair({
        deviceId: peer.deviceId,
        host: peer.host,
        port: peer.port,
        deviceName: peer.name,
      });
      set({ outgoingPairing: { deviceId: peer.deviceId, code } });
    } catch (error) {
      toast.error('发起配对失败', { description: String(error) });
    }
  },

  confirmPairRequest: async (requestId) => {
    set((s) => ({ pendingPairRequests: s.pendingPairRequests.filter((r) => r.requestId !== requestId) }));
    try {
      const r = await client.confirmPairRequest({ requestId });
      if (!r.ok) {
        toast.warning('配对请求已失效', { description: '对端可能已取消或超时' });
        return;
      }
      void get().refresh();
    } catch (error) {
      toast.error('确认配对失败', { description: String(error) });
    }
  },

  rejectPairRequest: async (requestId) => {
    set((s) => ({ pendingPairRequests: s.pendingPairRequests.filter((r) => r.requestId !== requestId) }));
    try {
      await client.rejectPairRequest({ requestId });
    } catch (error) {
      console.error('[sync] 拒绝配对失败:', error);
    }
  },

  updateSyncOptions: async (patch) => {
    try {
      const sync = await client.setSyncOptions(patch);
      set({ syncOptions: sync });
    } catch (error) {
      toast.error('保存同步设置失败', { description: String(error) });
    }
  },

  requestSyncPanelFocus: () => set({ syncPanelFocusAt: Date.now() }),

  consumeSyncPanelFocus: () => set({ syncPanelFocusAt: 0 }),
}));
