/**
 * Harness session entry 读取的唯一入口（全局决策：Harness 的 session entry / transcript
 * 读取只能经 pi-session/ 内的共享 reader，其他模块不得直接解析 JSONL 或 Harness 内部对象）。
 *
 * 解析 pi-durable JsonlStorage 的 main.jsonl（commit 行 writes）而非走 storage API：recover 对
 * 半写尾行会 poison 整个 storage，而读取端只需容忍末行损坏（append-only 末行必然最新），
 * 且 transcript 层还需要文件的 size/mtime，直接读文件最轻。
 *
 * branch 语义：entries 按 durable 递增 id 升序即创建顺序；遇到 pi.compaction（head marker）
 * 从该 entry 起保留（对应 durable findLatestHeadMarker 的 context 下界）。
 */
import { readFile } from 'node:fs/promises';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { INJECTED_ENTRY_KIND } from '../task-types.js';
import { getPiSessionRepository } from './pi-session-repository.js';

/** durable 1.3.0 删除了旧 SessionError；本地保持 (code, message, cause) 形状，消费方按 code 分支 */
export class SessionError extends Error {
  constructor(
    public code: 'not_found' | 'invalid_session' | 'invalid_entry',
    message: string,
    public cause?: Error,
  ) {
    super(message);
  }
}

/** 当前 branch 路径上对展示层有意义的 entry */
export type SessionBranchEntry =
  | { type: 'message'; id: string; timestamp: number; message: AgentMessage }
  | { type: 'compaction'; id: string; timestamp: number; summary: string; reason: string | null };

export type SessionBranchEntryType = SessionBranchEntry['type'];

interface StoredEntry {
  id: number;
  kind: string;
  model?: unknown[];
  data?: unknown;
  head?: unknown;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function invalidSession(filePath: string, message: string, cause?: Error): SessionError {
  return new SessionError('invalid_session', `Invalid JSONL session file ${filePath}: ${message}`, cause);
}

function invalidEntry(filePath: string, lineNumber: number, message: string, cause?: Error): SessionError {
  return new SessionError('invalid_entry', `Invalid JSONL session file ${filePath}: line ${lineNumber} ${message}`, cause);
}

function parseEntryWrite(value: unknown, filePath: string, lineNumber: number): StoredEntry | null {
  if (typeof value !== 'object' || value === null) {
    throw invalidEntry(filePath, lineNumber, 'is not a valid session write');
  }
  const write = value as Record<string, unknown>;
  if (write.type !== 'entry') return null;
  const record = (typeof write.value === 'object' && write.value !== null ? write.value : null) as Record<string, unknown> | null;
  if (!record) throw invalidEntry(filePath, lineNumber, 'entry write is missing value');
  if (typeof record.id !== 'number' || !Number.isSafeInteger(record.id)) {
    throw invalidEntry(filePath, lineNumber, 'is missing entry id');
  }
  if (typeof record.kind !== 'string') throw invalidEntry(filePath, lineNumber, 'is missing entry kind');
  return {
    id: record.id,
    kind: record.kind,
    model: Array.isArray(record.model) ? record.model : undefined,
    data: record.data,
    head: record.head,
  };
}

function messageTextOf(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '')
      : ''))
    .join('');
}

function toBranchEntry(entry: StoredEntry, filePath: string): SessionBranchEntry | null {
  switch (entry.kind) {
    case 'pi.user':
    case INJECTED_ENTRY_KIND:
    case 'pi.assistant':
    case 'pi.tool-result': {
      const message = entry.model?.[0] as AgentMessage | undefined;
      if (!message || typeof (message as { role?: unknown }).role !== 'string') {
        throw invalidSession(filePath, `entry ${entry.id} (${entry.kind}) is missing its model message`);
      }
      const timestamp = (message as { timestamp?: unknown }).timestamp;
      return {
        type: 'message',
        id: String(entry.id),
        timestamp: typeof timestamp === 'number' ? timestamp : 0,
        message,
      };
    }
    case 'pi.compaction': {
      const summaryMessage = entry.model?.[0];
      const data = (entry.data ?? null) as { reason?: unknown } | null;
      return {
        type: 'compaction',
        id: String(entry.id),
        timestamp: typeof (summaryMessage as { timestamp?: unknown })?.timestamp === 'number'
          ? (summaryMessage as { timestamp: number }).timestamp
          : 0,
        summary: messageTextOf(summaryMessage),
        reason: typeof data?.reason === 'string' ? data.reason : null,
      };
    }
    default:
      return null;
  }
}

export async function readSessionBranchFile(
  filePath: string,
): Promise<SessionBranchEntry[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SessionError('not_found', `Session not found: ${filePath}`, toError(error));
    }
    throw error;
  }
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) throw invalidSession(filePath, 'missing session header');
  const entries: StoredEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (error) {
      if (i === lines.length - 1) break;
      throw invalidEntry(filePath, i + 1, 'is not valid JSON', toError(error));
    }
    const commit = (typeof parsed === 'object' && parsed !== null ? parsed : null) as Record<string, unknown> | null;
    const writes = commit && commit.type === 'commit' && Array.isArray(commit.writes)
      ? commit.writes
      : Array.isArray(parsed) ? parsed : [parsed];
    for (const write of writes) {
      const entry = parseEntryWrite(write, filePath, i + 1);
      if (entry) entries.push(entry);
    }
  }
  entries.sort((a, b) => a.id - b.id);
  let branch = entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === 'pi.compaction') {
      branch = entries.slice(i);
      break;
    }
  }
  const out: SessionBranchEntry[] = [];
  for (const entry of branch) {
    const mapped = toBranchEntry(entry, filePath);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function readSessionBranchEntries(
  workspaceId: string,
  sessionId: string,
): Promise<SessionBranchEntry[]> {
  const repository = getPiSessionRepository();
  const filePath = await repository.getSessionPath(workspaceId, sessionId);
  return readSessionBranchFile(filePath);
}
