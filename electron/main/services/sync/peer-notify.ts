import { loadSettings } from '../settings-service.js';
import { getNotificationCenterService } from '../notification-center-service.js';
import { onPeersChanged, type PeerInfo } from './discovery.js';

const seen = new Set<string>();
let initialized = false;

/**
 * 已配对对端上线即通知（对端不配对不通知，配对完成当下用户就在面板前无需再提示）。
 * seen 记录本次会话内所有见过的设备：首次出现即通知一次，之后上下线不再打扰。
 */
export function initPeerOnlineNotifications(): void {
  if (initialized) return;
  initialized = true;
  onPeersChanged((peers) => {
    for (const peer of peers) {
      if (seen.has(peer.deviceId)) continue;
      seen.add(peer.deviceId);
      void notifyIfPaired(peer);
    }
  });
}

async function notifyIfPaired(peer: PeerInfo): Promise<void> {
  try {
    const settings = await loadSettings();
    const paired = settings.syncOptions?.pairedDevices.find((d) => d.deviceId === peer.deviceId);
    if (!paired) return;
    await getNotificationCenterService().add({
      type: 'sync',
      dedupeKey: `sync:${peer.deviceId}:online`,
      title: `检测到 ${paired.deviceName ?? peer.name} 在线`,
      summary: '可能有新数据，点击前往同步',
      owner: { kind: 'system' },
      ownerLabel: '设备同步',
    });
  } catch (error) {
    console.error('[lan-sync] 对端上线通知失败:', error);
  }
}
