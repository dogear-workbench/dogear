import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { readSyncState, writeSyncState } from './sync-state.js';
import { SYNC_APP_ID, SYNC_PROTOCOL_VERSION, type HandshakeHello } from './protocol.js';

export async function getOrCreateDeviceId(): Promise<string> {
  const state = await readSyncState();
  if (state.deviceId) return state.deviceId;
  const deviceId = randomUUID();
  await writeSyncState({ ...state, deviceId });
  return deviceId;
}

export function resolveDeviceName(settingsDeviceName?: string): string {
  const name = settingsDeviceName?.trim();
  return name && name.length > 0 ? name : os.hostname();
}

export function buildHello(deviceId: string, deviceName: string, appVersion: string): HandshakeHello {
  return {
    appId: SYNC_APP_ID,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    appVersion,
    deviceId,
    deviceName,
  };
}
