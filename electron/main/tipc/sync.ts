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
import { broadcastPeersSnapshot, getDeviceSnapshot, scanNow } from '../services/sync/discovery.js';
import {
  beginPairing,
  confirmPairRequest,
  getOutgoingPairingCode,
  getPendingPairRequests,
  onPairRequest,
  onPairingCompleted,
  rejectPairRequest,
  unpairDevice,
} from '../services/sync/pairing.js';
import {
  getRunningSync,
  onSyncProgress,
  runSync,
  type SyncReport,
} from '../services/sync/orchestrator.js';
import { readSyncState, writeSyncState, getDataDir, withSyncStateLock } from '../services/sync/sync-state.js';
import { resolveWithinDataDir } from '../services/sync/apply.js';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import { applySyncOptionsPatch, loadSettings, saveSettings, type SyncOptions } from '../services/settings-service.js';
import { listWorkspaceDirForSync, statWorkspaceDirForSync, type SyncDirListing, type SyncDirStats } from '../services/sync/ws-tree.js';
import { normalizeDisabledSyncItems } from '../services/settings-types.js';
import type { SyncEventPayload } from './renderer-handlers.js';

const t = tipc.create();

function emitSyncEvent(payload: SyncEventPayload): void {
  broadcastToWindows((h) => h.syncEvent.send(payload));
}

export const syncRouter = {
  getSyncStatus: t.procedure
    .input<Record<string, never>>()
    .action(async () => getLanSyncStatus()),

  /** 设备总览快照（含离线已配对常驻条目）；拉取与事件推送同一数据源，store 不自己拼装 */
  getPeersSnapshot: t.procedure
    .input<Record<string, never>>()
    .action(async () => getDeviceSnapshot()),

  /** 手动寻找设备：mDNS 一轮 + 已配对设备地址探测，耗时约 2~3s（UI 需 loading 态）；完成后快照经 peersChanged 事件另行广播 */
  scanPeers: t.procedure
    .input<Record<string, never>>()
    .action(async () => scanNow()),

  /** 解除配对：仅删本端 pairedDevices（sync-state 基线/映射保留）；同步进行中拒绝 */
  unpair: t.procedure
    .input<{ deviceId: string }>()
    .action(async ({ input }) => {
      await unpairDevice(input.deviceId);
      const { broadcastSettingsChanged } = await import('../main-app.js');
      broadcastSettingsChanged();
      broadcastPeersSnapshot();
      return { ok: true as const };
    }),

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

  // ── 工作区映射与选择性同步（step3）──

  /** 工作区同步开关（仅对已建映射的本端工作区有效；关掉后两端已有数据不动，只是不再互通） */
  setWorkspaceSync: t.procedure
    .input<{ peerId: string; localWsid: string; enabled: boolean }>()
    .action(async ({ input }) => {
      return withSyncStateLock(getDataDir(), async () => {
        const state = await readSyncState();
        const peer = state.peers[input.peerId];
        const entry = peer?.workspaceMap?.[input.localWsid];
        if (!peer || !entry) return { success: false as const, error: '该工作区尚未建立映射' };
        entry.enabled = input.enabled;
        await writeSyncState(state);
        return { success: true as const };
      });
    }),

  /**
   * 建立映射：mode=new（本端新建工作区条目，path 用用户选的本地目录）| existing（映射到已有）。
   * remoteWsid 缺省同 id 直通的语义仅在显式建条目后生效；建映射同时从忽略列表移除（改选）。
   */
  mapWorkspace: t.procedure
    .input<{
      peerId: string;
      remoteWsid: string;
      mode: 'new' | 'existing';
      localWsid?: string;
      localPath?: string;
      localName?: string;
    }>()
    .action(async ({ input }) => {
      let localWsid: string;
      if (input.mode === 'new') {
        if (!input.localPath) return { success: false as const, error: '缺少本地目录' };
        const name = input.localName?.trim()
          || input.localPath.split(/[/\\]/).filter(Boolean).pop()
          || '工作区';
        localWsid = await workspaceJsonService.add({
          name,
          path: input.localPath,
          additionalPaths: [],
          isDefault: false,
          createdAt: new Date().toISOString(),
        });
      } else {
        if (!input.localWsid) return { success: false as const, error: '缺少要映射的本端工作区' };
        const ws = await workspaceJsonService.getById(input.localWsid);
        if (!ws) return { success: false as const, error: '本端工作区不存在' };
        localWsid = input.localWsid;
      }

      return withSyncStateLock(getDataDir(), async () => {
        const state = await readSyncState();
        const peer = state.peers[input.peerId] ?? { deviceId: input.peerId, lastSyncAt: 0 };
        state.peers[input.peerId] = peer;
        peer.workspaceMap ??= {};
        peer.workspaceMap[localWsid] = { remoteWsid: input.remoteWsid, enabled: true };
        peer.ignoredRemoteWorkspaces = (peer.ignoredRemoteWorkspaces ?? []).filter((id) => id !== input.remoteWsid);
        await writeSyncState(state);
        return { success: true as const, localWsid };
      });
    }),

  /** 断开映射：仅删表项，两端已有数据不动；重新建映射后靠同步自然收敛 */
  unmapWorkspace: t.procedure
    .input<{ peerId: string; localWsid: string }>()
    .action(async ({ input }) => {
      return withSyncStateLock(getDataDir(), async () => {
        const state = await readSyncState();
        const peer = state.peers[input.peerId];
        if (!peer?.workspaceMap?.[input.localWsid]) return { success: false as const, error: '该工作区尚未建立映射' };
        delete peer.workspaceMap[input.localWsid];
        await writeSyncState(state);
        return { success: true as const };
      });
    }),

  /** 待映射区选「不同步」：不再提示也不再同步，可解除 */
  ignoreRemoteWorkspace: t.procedure
    .input<{ peerId: string; remoteWsid: string }>()
    .action(async ({ input }) => {
      return withSyncStateLock(getDataDir(), async () => {
        const state = await readSyncState();
        const peer = state.peers[input.peerId] ?? { deviceId: input.peerId, lastSyncAt: 0 };
        state.peers[input.peerId] = peer;
        const list = peer.ignoredRemoteWorkspaces ?? (peer.ignoredRemoteWorkspaces = []);
        if (!list.includes(input.remoteWsid)) list.push(input.remoteWsid);
        await writeSyncState(state);
        return { success: true as const };
      });
    }),

  unignoreRemoteWorkspace: t.procedure
    .input<{ peerId: string; remoteWsid: string }>()
    .action(async ({ input }) => {
      return withSyncStateLock(getDataDir(), async () => {
        const state = await readSyncState();
        const peer = state.peers[input.peerId];
        if (!peer) return { success: false as const, error: '对端不存在' };
        peer.ignoredRemoteWorkspaces = (peer.ignoredRemoteWorkspaces ?? []).filter((id) => id !== input.remoteWsid);
        await writeSyncState(state);
        return { success: true as const };
      });
    }),

  /** 工作区同步面板数据：已映射区（含两端名称）+ 已忽略区（含对端元信息） */
  getWorkspaceSyncOverview: t.procedure
    .input<{ peerId: string }>()
    .action(async ({ input }) => {
      const [state, workspaces] = await Promise.all([readSyncState(), workspaceJsonService.getAll()]);
      const peer = state.peers[input.peerId];
      const localNameById = new Map(workspaces.map((w) => [w.id, w.name] as const));
      const remoteMetaById = new Map((peer?.remoteWorkspaceMeta ?? []).map((m) => [m.wsid, m] as const));
      const mapped = Object.entries(peer?.workspaceMap ?? {})
        .filter(([, entry]) => !!entry)
        .map(([localWsid, entry]) => ({
          localWsid,
          localName: localNameById.get(localWsid),
          remoteWsid: entry.remoteWsid ?? localWsid,
          remoteName: remoteMetaById.get(entry.remoteWsid ?? localWsid)?.name,
          enabled: entry.enabled,
        }));
      const ignored = (peer?.ignoredRemoteWorkspaces ?? []).map((wsid) => {
        const meta = remoteMetaById.get(wsid);
        return meta ?? { wsid };
      });
      return { mapped, ignored };
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

  /** 同步范围用户勾选树：单层列目录（懒加载）+ .git 检测；空 path 工作区（临时会话）不可用 */
  getSyncWorkspaceDir: t.procedure
    .input<{ workspaceId: string; relPath?: string }>()
    .action(async ({ input }): Promise<SyncDirListing & { error?: string }> => {
      const workspace = await workspaceJsonService.getById(input.workspaceId);
      if (!workspace || workspace.path === '') return { hasGit: false, entries: [], error: '工作区不存在' };
      try {
        return await listWorkspaceDirForSync(workspace.path, input.relPath ?? '');
      } catch (error) {
        return { hasGit: false, entries: [], error: String(error) };
      }
    }),

  /** 勾选目录的子树规模统计（文件数/总字节，超上限截断）：提醒误勾巨型目录 */
  getSyncWorkspaceDirStats: t.procedure
    .input<{ workspaceId: string; relPath: string }>()
    .action(async ({ input }): Promise<SyncDirStats & { error?: string }> => {
      const workspace = await workspaceJsonService.getById(input.workspaceId);
      if (!workspace || workspace.path === '') return { fileCount: 0, totalBytes: 0, truncated: false, error: '工作区不存在' };
      try {
        return await statWorkspaceDirForSync(workspace.path, input.relPath);
      } catch (error) {
        return { fileCount: 0, totalBytes: 0, truncated: false, error: String(error) };
      }
    }),

  /**
   * 精确更新 syncOptions 节而非整体替换 settings：配对由异步事件回写 pairedDevices，
   * 前端若拿旧快照走 updateSettings 会踩掉刚写入的配对
   */
  setSyncOptions: t.procedure
    .input<Partial<SyncOptions> & { removeDeviceId?: string }>()
    .action(async ({ input }): Promise<SyncOptions> => {
      // 防呆：只放行已知字段且类型正确的输入（渲染层异常/被篡改的调用不至于污染设置），
      // disabledSyncItems 再过 SyncItemId 白名单清洗；syncOptionsRev 由主进程维护，不接受前端直写
      const patch: Partial<SyncOptions> & { removeDeviceId?: string } = {};
      if (typeof input.deviceName === 'string') patch.deviceName = input.deviceName;
      if (typeof input.syncStocksData === 'boolean') patch.syncStocksData = input.syncStocksData;
      if (typeof input.syncFeishu === 'boolean') patch.syncFeishu = input.syncFeishu;
      if (input.disabledSyncItems !== undefined) {
        patch.disabledSyncItems = normalizeDisabledSyncItems(input.disabledSyncItems);
      }
      if (typeof input.syncConflictCopies === 'boolean') patch.syncConflictCopies = input.syncConflictCopies;
      if (typeof input.syncShadowGit === 'boolean') patch.syncShadowGit = input.syncShadowGit;
      // userSyncPaths 由 applySyncOptionsPatch 内 normalizeUserSyncPaths 清洗（非法形态/穿越段滤除）
      if (input.userSyncPaths !== undefined && input.userSyncPaths !== null && typeof input.userSyncPaths === 'object') {
        patch.userSyncPaths = input.userSyncPaths;
      }
      if (typeof input.removeDeviceId === 'string' && input.removeDeviceId !== '') {
        patch.removeDeviceId = input.removeDeviceId;
      }
      const settings = await loadSettings();
      // 范围字段实际变化时 applySyncOptionsPatch 自动 syncOptionsRev++（两端统一靠 rev LWW），
      // disabledSyncItems 白名单清洗也在此完成
      settings.syncOptions = applySyncOptionsPatch(settings.syncOptions!, patch);
      await saveSettings(settings);
      const { broadcastSettingsChanged } = await import('../main-app.js');
      broadcastSettingsChanged();
      return settings.syncOptions;
    }),
};

/** 服务层事件 → 渲染层广播接线（registerTipcHandlers 调用一次） */
export function registerSyncBroadcaster(): void {
  onLanSyncStatusChanged((status) => emitSyncEvent({ kind: 'status', status }));
  onPeersChanged((snapshot) => emitSyncEvent({ kind: 'peers', peers: snapshot.peers }));
  onSyncProgress((event) => emitSyncEvent({ kind: 'sync', event }));
  onPairRequest((request) => emitSyncEvent({ kind: 'pair-request', request }));
  onPairingCompleted((outcome) => emitSyncEvent({ kind: 'pairing-completed', outcome }));
}
