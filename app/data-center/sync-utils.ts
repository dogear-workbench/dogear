import type { PairingRequestInfo } from '@/electron/main/services/sync/pairing';
import { toast } from 'sonner';

/** 与主进程 apply.ts 的 shortDeviceId 同规则：去连字符取前 6 位 */
export function shortDeviceIdText(deviceId: string): string {
  return deviceId.replaceAll('-', '').slice(0, 6);
}

export function peerDisplayName(name: string | undefined, deviceId: string): string {
  return name && name.trim().length > 0 ? name : `设备 ${shortDeviceIdText(deviceId)}`;
}

export function pairRequestDisplayName(request: PairingRequestInfo): string {
  return peerDisplayName(request.peer.deviceName, request.peer.deviceId);
}

export function copyRelPath(relPath: string): void {
  void navigator.clipboard
    .writeText(relPath)
    .then(() => toast.success('已复制路径'))
    .catch(() => toast.error('复制失败'));
}
