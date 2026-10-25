/**
 * 记忆召回使用统计（本地 JSON，不参与同步/备份）
 *
 * - 存 configDir/memory-stats.json（在 sync 清单白名单之外，天然本机独占）
 * - RecallMemory 命中即记 slug + 时间戳；体检工具读它判死重
 * - 统计自 since（首次记录时间）起收集，早于 since 的「从未使用」只覆盖统计期，报告须带此保留意见
 */
import path from 'node:path';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import { getConfigDir } from '../settings-service.js';
import type { MemoryScope } from './memory-types.js';

export interface MemoryUsageEntry {
  count: number;
  lastUsed: string;
}

export interface MemoryUsageFile {
  version: 1;
  since: string;
  entries: Record<string, MemoryUsageEntry>;
}

function getUsagePath(): string {
  return path.join(getConfigDir(), 'memory-stats.json');
}

export function usageKey(scope: MemoryScope, workspaceId: string, slug: string): string {
  return scope === 'global' ? `global/${slug}` : `ws/${workspaceId}/${slug}`;
}

export async function readMemoryUsage(): Promise<MemoryUsageFile | null> {
  const data = await safeJsonRead<MemoryUsageFile | null>(getUsagePath(), null);
  if (!data || data.version !== 1 || typeof data.entries !== 'object' || data.entries === null) return null;
  return data;
}

export async function recordRecallUsage(
  workspaceId: string,
  topics: Array<{ slug: string; scope: MemoryScope }>,
): Promise<void> {
  if (topics.length === 0) return;
  const existing = (await readMemoryUsage()) ?? {
    version: 1 as const,
    since: new Date().toISOString(),
    entries: {},
  };
  const now = new Date().toISOString();
  for (const t of topics) {
    const key = usageKey(t.scope, workspaceId, t.slug);
    const prev = existing.entries[key];
    existing.entries[key] = { count: (prev?.count ?? 0) + 1, lastUsed: now };
  }
  await safeJsonWrite(getUsagePath(), existing);
}
