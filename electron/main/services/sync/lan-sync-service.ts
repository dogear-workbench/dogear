import { app } from 'electron';
import { loadSettings } from '../settings-service.js';
import { getDataDir, readSyncState } from './sync-state.js';
import { handleIncomingPairRequest, initSelfHello } from './pairing.js';
import { getDiscoveryError, getPeers, onPeersChanged, startDiscovery, stopDiscovery, type PeerInfo } from './discovery.js';
import { DEFAULT_SYNC_PORT, startSyncServer, type RunningSyncServer } from './server.js';
import { enabledWorkspaceIdsOf } from './workspace-map.js';
import { excludesFromSyncOptions } from './manifest.js';

export interface LanSyncStatus {
  running: boolean;
  httpPort?: number;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  error?: string;
  discoveryError?: string;
}

let server: RunningSyncServer | null = null;
let status: LanSyncStatus = {
  running: false,
  deviceId: '',
  deviceName: '',
  appVersion: '',
};

const statusListeners = new Set<(status: LanSyncStatus) => void>();

// 非 Electron 运行时（如验证脚本）getVersion 不可用，降级占位版本号
function currentAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return 'dev';
  }
}

function notifyStatus(): void {
  for (const cb of statusListeners) {
    try {
      cb({ ...status });
    } catch (error) {
      console.error('[lan-sync] status 回调失败:', error);
    }
  }
}

export function startLanSync(): Promise<void> {
  return startLanSyncInternal().catch((error) => {
    status = {
      ...status,
      running: false,
      error: error instanceof Error ? error.message : String(error),
    };
    console.error('[lan-sync] 启动失败（不影响主功能）:', error);
    notifyStatus();
  });
}

async function startLanSyncInternal(): Promise<void> {
  if (server) return;
  const hello = await initSelfHello(currentAppVersion());
  const dataDir = getDataDir();
  const base = {
    dataDir,
    getSelfHello: () => hello,
    getManifestOptions: async (requesterDeviceId: string) => {
      const current = await loadSettings();
      // workspaces/ 按请求方的映射表过滤（enabled=true 的本端 wsid）；未建映射 → 全部工作区目录不同步
      const state = await readSyncState();
      // 同步范围排除来自本端 settings.syncOptions（含 stocks/feishu optionalDirs），
      // 与主动发起侧（orchestrator）共用同一转换；userSyncPaths 驱动 __ws-external__ 虚拟条目收集
      return {
        enabledWorkspaceIds: enabledWorkspaceIdsOf(state.peers[requesterDeviceId]?.workspaceMap),
        excludes: excludesFromSyncOptions(current.syncOptions),
        userSyncPaths: current.syncOptions?.userSyncPaths,
      };
    },
    handlePairRequest: handleIncomingPairRequest,
  };

  let runningServer: RunningSyncServer;
  try {
    runningServer = await startSyncServer({ ...base, port: DEFAULT_SYNC_PORT });
  } catch (error) {
    console.warn('[lan-sync] 默认端口占用，退避随机端口:', error instanceof Error ? error.message : error);
    runningServer = await startSyncServer({ ...base, port: 0 });
  }
  server = runningServer;

  startDiscovery({
    deviceId: hello.deviceId,
    deviceName: hello.deviceName ?? hello.deviceId,
    appVersion: hello.appVersion,
    port: runningServer.port,
  });

  status = {
    running: true,
    httpPort: runningServer.port,
    deviceId: hello.deviceId,
    deviceName: hello.deviceName ?? '',
    appVersion: hello.appVersion,
    discoveryError: getDiscoveryError() ?? undefined,
  };
  notifyStatus();
}

export async function stopLanSync(): Promise<void> {
  stopDiscovery();
  if (server) {
    const closing = server;
    server = null;
    await closing.close().catch(() => {});
  }
  status = { ...status, running: false };
  delete status.httpPort;
  notifyStatus();
}

export function getLanSyncStatus(): LanSyncStatus {
  return { ...status };
}

export function listPeers(): PeerInfo[] {
  return getPeers();
}

export function onLanSyncStatusChanged(cb: (status: LanSyncStatus) => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export { onPeersChanged };
