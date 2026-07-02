import type { ConversationUsageEntry, ContextSnapshot } from '@/types/usage';

type Usage = ConversationUsageEntry['usage'];

/** contextWindow → 简洁标签：200000→'200k'，1000000→'1M' */
export function formatLabel(window: number): string {
  if (window >= 1_000_000) return `${(window / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${Math.round(window / 1000)}k`;
}

/** token 数缩写：15632→'15.6k'，900000→'900k'，<1000 原样 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = (n / 1000).toFixed(1).replace(/\.0$/, '');
  return `${k}k`;
}

/**
 * 解析当前上下文占用与上限，来自 SDK 真实快照 latestContext（query.getContextUsage）。
 * 无快照（旧对话或采集失败）返回 used=null，UI 据此不画进度条。
 * autoCompactWindow：用户在 profile 里设置的自动压缩窗口（CLAUDE_CODE_AUTO_COMPACT_WINDOW），
 * >0 时把进度条上限收窄到这个 token 数并重算占比，反映"离压缩还有多远"。
 */
export interface ContextInfo {
  used: number | null;
  limit: number;
  percentage: number;
  label: string;
}

export function resolveContext(
  latestContext: ContextSnapshot | undefined,
  autoCompactWindow = 0,
): ContextInfo {
  if (!latestContext || latestContext.totalTokens <= 0) {
    return { used: null, limit: 0, percentage: 0, label: '' };
  }
  const rawLimit = latestContext.maxTokens > 0 ? latestContext.maxTokens : 0;
  // autoCompactWindow 上限受模型实际上下文窗口约束（SDK 文档: "该值上限为模型的实际上下文窗口"）
  const effectiveWindow = autoCompactWindow > 0
    ? (rawLimit > 0 ? Math.min(autoCompactWindow, rawLimit) : autoCompactWindow)
    : 0;
  const limit = effectiveWindow > 0 ? effectiveWindow : rawLimit;
  // 上限被 autoCompactWindow 覆盖后，SDK 上报的 percentage 不再适用，按 used/limit 重算
  const percentage = limit !== rawLimit
    ? (latestContext.totalTokens / limit) * 100
    : (latestContext.percentage > 0
        ? latestContext.percentage
        : (limit > 0 ? (latestContext.totalTokens / limit) * 100 : 0));
  return {
    used: latestContext.totalTokens,
    limit,
    percentage,
    label: limit > 0 ? formatLabel(limit) : '',
  };
}

/**
 * 缓存命中率 = cacheRead / (input + cacheRead)。
 * 传单轮 usage 或会话级 totals（同字段形状）均可。
 */
export function cacheHitRate(usage: Pick<Usage, 'inputTokens' | 'cacheReadInputTokens'>): number {
  const denom = usage.inputTokens + usage.cacheReadInputTokens;
  if (denom <= 0) return 0;
  return usage.cacheReadInputTokens / denom;
}

/** 会话级 cache_creation 5m / 1h 累计（按所有 entry 加和；缺失时为 0） */
export interface CacheCreationTotals {
  ephemeral5mInputTokens: number;
  ephemeral1hInputTokens: number;
  hasAnyDetail: boolean;
}

export function aggregateCacheCreation(entries: ConversationUsageEntry[]): CacheCreationTotals {
  let m5 = 0, h1 = 0, hasAny = false;
  for (const e of entries) {
    const cc = e.usage.cacheCreation;
    if (!cc) continue;
    hasAny = true;
    m5 += cc.ephemeral5mInputTokens;
    h1 += cc.ephemeral1hInputTokens;
  }
  return { ephemeral5mInputTokens: m5, ephemeral1hInputTokens: h1, hasAnyDetail: hasAny };
}

/** 重读文件聚合项 */
export interface ReadActivityItem {
  file: string;
  count: number;
  /** 距上次读这个文件，间隔了多少个 entry（最近一次到再前一次）；count<2 时为 null */
  lastIntervalEntries: number | null;
  /** 最近两次读这个文件之间是否跨过 compact 事件 */
  crossedCompact: boolean;
}

/**
 * 跨所有 entry 聚合 Read 工具命中的 file_path。
 * 入参为 entries + compactMarkers（不需要原始 lines，文件归属信息已在 entry.toolActivity 里）。
 * lastIntervalEntries / crossedCompact 由 entry.turnIndex 与 compactMarker.afterTurnIndex 派生。
 */
export function aggregateReadActivity(
  entries: ConversationUsageEntry[],
  compactMarkers: { afterTurnIndex: number }[],
): ReadActivityItem[] {
  const sorted = [...entries].sort((a, b) => a.turnIndex - b.turnIndex);
  const compactTurns = compactMarkers.map(m => m.afterTurnIndex).sort((a, b) => a - b);
  // file → [turnIndex 升序列表]
  const fileTurns = new Map<string, number[]>();
  for (const e of sorted) {
    for (const call of e.toolActivity?.calls ?? []) {
      if (call.name !== 'Read' || !call.files?.length) continue;
      for (const f of call.files) {
        if (!fileTurns.has(f)) fileTurns.set(f, []);
        fileTurns.get(f)!.push(e.turnIndex);
      }
    }
  }

  const items: ReadActivityItem[] = [];
  for (const [file, turns] of fileTurns) {
    const count = turns.length;
    let lastIntervalEntries: number | null = null;
    let crossedCompact = false;
    if (count >= 2) {
      const last = turns[turns.length - 1];
      const prev = turns[turns.length - 2];
      lastIntervalEntries = last - prev;
      crossedCompact = compactTurns.some(t => t >= prev && t < last);
    }
    items.push({ file, count, lastIntervalEntries, crossedCompact });
  }
  return items.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

/** 权限等待聚合项 */
export interface PermissionWaitAggregate {
  toolName: string;
  totalCount: number;
  totalWaitMs: number;
  avgWaitMs: number;
  decisions: { allow: number; deny: number; always_allow: number; allow_session: number };
}

export function aggregatePermissionWaits(
  entries: ConversationUsageEntry[],
): PermissionWaitAggregate[] {
  const map = new Map<string, PermissionWaitAggregate>();
  for (const e of entries) {
    for (const w of e.permissionWaits ?? []) {
      let agg = map.get(w.toolName);
      if (!agg) {
        agg = {
          toolName: w.toolName,
          totalCount: 0,
          totalWaitMs: 0,
          avgWaitMs: 0,
          decisions: { allow: 0, deny: 0, always_allow: 0, allow_session: 0 },
        };
        map.set(w.toolName, agg);
      }
      agg.totalCount += 1;
      agg.totalWaitMs += w.waitMs;
      agg.decisions[w.decision] += 1;
    }
  }
  for (const agg of map.values()) {
    agg.avgWaitMs = agg.totalCount > 0 ? agg.totalWaitMs / agg.totalCount : 0;
  }
  return [...map.values()].sort((a, b) => b.totalWaitMs - a.totalWaitMs);
}

/** 毫秒格式化：<1s 显 ms，<60s 显 s.s，否则显 mm:ss */
export function formatWaitMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

