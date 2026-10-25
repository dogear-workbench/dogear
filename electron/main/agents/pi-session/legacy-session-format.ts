/**
 * 存量 harness 会话（0.99.2 v3/v4 JSONL）的自持解析，供 storage-migrator 一次性转换用。
 * 不 import 0.99.2 库符号；解析语义与迁移前的 session-history-reader 实现一致：
 * v3 = parentId 树（timestamp ISO string、leaf/targetId 指针、compaction firstKeptEntryId 截断）；
 * v4 = lane/seq 结构（timestamp ms、tip 由 pi.branch.tip main value 维护、value/list 内部状态行丢弃）。
 * 产出当前可见 branch 的单链 entries（旧→新顺序）与 usage 行。
 */
import type { Usage } from '@earendil-works/pi-ai';

export class LegacyFormatError extends Error {}

interface RawEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface LegacyUsageRow {
  usage: Usage;
}

export interface ParsedLegacySession {
  format: 'v3' | 'v4';
  sessionId: string;
  createdAt: number;
  cwd: string;
  branch: RawEntry[];
  usageRows: LegacyUsageRow[];
  /** pi.* 内部状态行（value/list，含 pi.branch.tip / 流式帧 / lane 状态等），有意丢弃 */
  droppedInternalLines: number;
  /** 不在当前可见 branch 上的 entry 行（旧分支/compaction 截断前缀）与未知类型 entry */
  droppedOffBranchEntries: number;
}

function fail(filePath: string, message: string): never {
  throw new LegacyFormatError(`${filePath}: ${message}`);
}

function parseJsonLine(line: string, filePath: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    fail(filePath, `line ${lineNumber} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

// ─── v3（0.83 parentId 树）───

function parseV3Header(line: unknown, filePath: string): { id: string; createdAt: number; cwd: string } {
  const header = asRecord(line);
  if (!header || header.type !== 'session' || header.version !== 3) fail(filePath, 'first line is not a v3 session header');
  if (typeof header.id !== 'string' || !header.id) fail(filePath, 'session header is missing id');
  if (typeof header.timestamp !== 'string') fail(filePath, 'session header is missing timestamp');
  if (typeof header.cwd !== 'string') fail(filePath, 'session header is missing cwd');
  const createdAt = Date.parse(header.timestamp);
  if (!Number.isFinite(createdAt)) fail(filePath, 'session header timestamp is invalid');
  return { id: header.id, createdAt, cwd: header.cwd };
}

function parseV3EntryLine(line: unknown, filePath: string, lineNumber: number): RawEntry {
  const entry = asRecord(line);
  if (!entry) fail(filePath, `line ${lineNumber} is not a valid session entry`);
  if (typeof entry.type !== 'string') fail(filePath, `line ${lineNumber} is missing entry type`);
  if (typeof entry.id !== 'string' || !entry.id) fail(filePath, `line ${lineNumber} is missing entry id`);
  if (entry.parentId !== null && typeof entry.parentId !== 'string') fail(filePath, `line ${lineNumber} has invalid parentId`);
  if (typeof entry.timestamp !== 'string') fail(filePath, `line ${lineNumber} is missing timestamp`);
  return {
    id: entry.id,
    parentId: entry.parentId as string | null,
    type: entry.type,
    timestamp: Date.parse(entry.timestamp),
    payload: entry,
  };
}

// 逐行复刻 0.83 上游 getPathToRootOrCompaction（leaf 行定当前 leaf 指针、不进 branch）
function resolveV3Branch(entries: RawEntry[], filePath: string): RawEntry[] {
  const realEntries = entries.filter((entry) => entry.type !== 'leaf');
  const byId = new Map(realEntries.map((entry) => [entry.id, entry]));
  const leafLine = [...entries].reverse().find((entry) => entry.type === 'leaf');
  const leafId = leafLine
    ? typeof leafLine.payload.targetId === 'string' ? leafLine.payload.targetId : null
    : realEntries.length ? realEntries[realEntries.length - 1].id : null;
  if (leafId === null) return [];
  if (!byId.has(leafId)) fail(filePath, `Entry ${leafId} not found`);
  const path: RawEntry[] = [];
  let stopAtEntryId: string | null = null;
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    if (stopAtEntryId !== null && current.id === stopAtEntryId) break;
    if (current.type === 'compaction') {
      const payload = current.payload as { retainedTail?: unknown; firstKeptEntryId?: unknown };
      if (payload.retainedTail) break;
      stopAtEntryId = typeof payload.firstKeptEntryId === 'string' ? payload.firstKeptEntryId : null;
    }
    if (!current.parentId) break;
    const parent = byId.get(current.parentId);
    if (!parent) fail(filePath, `Entry ${current.parentId} not found`);
    current = parent;
  }
  return path;
}

// ─── v4（0.99.2 lane/seq 结构）───

function parseV4Header(line: unknown, filePath: string): { id: string; createdAt: number; cwd: string } {
  const header = asRecord(line);
  if (!header || header.v !== 4 || header.kind !== 'header') fail(filePath, 'first line is not a v4 session header');
  if (typeof header.id !== 'string' || !header.id) fail(filePath, 'session header is missing id');
  if (typeof header.createdAt !== 'number' || !Number.isFinite(header.createdAt)) fail(filePath, 'session header is missing createdAt');
  if (typeof header.cwd !== 'string') fail(filePath, 'session header is missing cwd');
  return { id: header.id, createdAt: header.createdAt, cwd: header.cwd };
}

function parseV4Write(write: unknown, filePath: string, lineNumber: number): RawEntry | null {
  const record = asRecord(write);
  if (!record) fail(filePath, `line ${lineNumber} is not a valid session write`);
  if (record.kind !== 'entry') return null;
  if (typeof record.id !== 'string' || !record.id) fail(filePath, `line ${lineNumber} is missing entry id`);
  if (record.parentId !== null && typeof record.parentId !== 'string') fail(filePath, `line ${lineNumber} has invalid parentId`);
  if (typeof record.type !== 'string') fail(filePath, `line ${lineNumber} is missing entry type`);
  if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) fail(filePath, `line ${lineNumber} is missing timestamp`);
  return {
    id: record.id,
    parentId: record.parentId as string | null,
    type: record.type,
    timestamp: record.timestamp,
    payload: record,
  };
}

function isBranchTipValue(write: unknown): boolean {
  const record = asRecord(write);
  return record !== null && record.kind === 'value' && record.namespace === 'pi.branch.tip' && record.key === 'main';
}

// 复刻 buildContextEntries 语义：tip 到根的 parent 链，保留最后一个 compaction 及其后
function resolveV4Branch(entriesById: Map<string, RawEntry>, tip: string | null, filePath: string): RawEntry[] {
  const path: RawEntry[] = [];
  const seen = new Set<string>();
  let current = tip !== null ? entriesById.get(tip) : undefined;
  if (tip !== null && !current) fail(filePath, `Entry ${tip} not found`);
  while (current) {
    if (seen.has(current.id)) fail(filePath, `Entry ${current.id} has cyclic parent chain`);
    seen.add(current.id);
    path.unshift(current);
    if (!current.parentId) break;
    const parent = entriesById.get(current.parentId);
    if (!parent) fail(filePath, `Entry ${current.parentId} not found`);
    current = parent;
  }
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === 'compaction') return path.slice(i);
  }
  return path;
}

/** 仅末行非空损坏容忍（append-only 半写行），与迁移前读取端行为一致 */
function splitTolerantLines(content: string, filePath: string): string[] {
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) fail(filePath, 'missing session header');
  return lines;
}

export function parseLegacySession(content: string, filePath: string): ParsedLegacySession {
  const lines = splitTolerantLines(content, filePath);
  const first = parseJsonLine(lines[0], filePath, 1);
  const isFirstV4 = (asRecord(first)?.v === 4);
  if (isFirstV4) return parseV4(lines, filePath);
  return parseV3(lines, filePath);
}

function parseV3(lines: string[], filePath: string): ParsedLegacySession {
  const header = parseV3Header(parseJsonLine(lines[0], filePath, 1), filePath);
  const entries: RawEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      entries.push(parseV3EntryLine(parseJsonLine(lines[i], filePath, i + 1), filePath, i + 1));
    } catch (error) {
      if (i === lines.length - 1 && error instanceof LegacyFormatError) break;
      throw error;
    }
  }
  const branch = resolveV3Branch(entries, filePath);
  return {
    format: 'v3',
    sessionId: header.id,
    createdAt: header.createdAt,
    cwd: header.cwd,
    branch,
    usageRows: [],
    droppedInternalLines: 0,
    droppedOffBranchEntries: entries.length - branch.length,
  };
}

function parseV4(lines: string[], filePath: string): ParsedLegacySession {
  const header = parseV4Header(parseJsonLine(lines[0], filePath, 1), filePath);
  const entriesById = new Map<string, RawEntry>();
  const usageRows: LegacyUsageRow[] = [];
  let mainTip: string | null = null;
  let droppedInternalLines = 0;
  for (let i = 1; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = parseJsonLine(lines[i], filePath, i + 1);
      const writes = Array.isArray(parsed) ? parsed : [parsed];
      for (const write of writes) {
        if (isBranchTipValue(write)) {
          const record = write as { op?: unknown; value?: unknown };
          mainTip = record.op === 'set' && typeof record.value === 'string' ? record.value : null;
          droppedInternalLines++;
          continue;
        }
        const entry = parseV4Write(write, filePath, i + 1);
        if (entry) {
          entriesById.set(entry.id, entry);
          continue;
        }
        const record = asRecord(write);
        if (record && record.kind === 'usage' && asRecord(record.usage)) {
          usageRows.push({ usage: record.usage as Usage });
          continue;
        }
        droppedInternalLines++;
      }
    } catch (error) {
      if (i === lines.length - 1 && error instanceof LegacyFormatError) break;
      throw error;
    }
  }
  const allEntries = [...entriesById.values()];
  const branch = resolveV4Branch(entriesById, mainTip, filePath);
  return {
    format: 'v4',
    sessionId: header.id,
    createdAt: header.createdAt,
    cwd: header.cwd,
    branch,
    usageRows,
    droppedInternalLines,
    droppedOffBranchEntries: allEntries.length - branch.length,
  };
}
