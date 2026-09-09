import { createHash } from 'node:crypto';

export function resolveProfileKey(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function buildPersistentPartition(profileKey: string): string {
  const digest = createHash('sha256').update(profileKey).digest('hex').slice(0, 32);
  return `persist:dogear-browser-${digest}`;
}
