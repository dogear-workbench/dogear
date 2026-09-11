/**
 * Harness session entry 读取的唯一入口（全局决策：Harness 的 session entry / transcript
 * 读取只能经 pi-session/ 内的共享 reader，其他模块不得直接解析 JSONL 或 Harness 内部对象）。
 *
 * 只读当前 branch（根到当前 leaf，遇到 compaction 提前截断），不涉及运行时 AgentHarness 实例，
 * 也就不会踩到 pi-harness-adapter.ts 记录的事件订阅坑。
 *
 * 不经 repository.open()：上游 JsonlSessionStorage 撞上写到一半的 JSONL 尾行会整体抛
 * invalid_entry，错误对象又没有结构化行号，无法定位失败行；因此在此自行逐行解析并复刻上游
 * branch/compaction 语义，仅当损坏行是文件最后一个非空行时丢弃（append-only 末行必然最新），
 * 非末行损坏维持抛错。
 */
import { readFile } from 'node:fs/promises';
import { SessionError, type SessionTreeEntry } from '@earendil-works/pi-agent-core';
import { getPiSessionRepository } from './pi-session-repository.js';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function invalidSession(filePath: string, message: string, cause?: Error): SessionError {
  return new SessionError('invalid_session', `Invalid JSONL session file ${filePath}: ${message}`, cause);
}

function invalidEntry(filePath: string, lineNumber: number, message: string, cause?: Error): SessionError {
  return new SessionError('invalid_entry', `Invalid JSONL session file ${filePath}: line ${lineNumber} ${message}`, cause);
}

function parseHeaderLine(line: string, filePath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSession(filePath, 'first line is not a valid session header', toError(error));
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw invalidSession(filePath, 'first line is not a valid session header');
  }
  const header = parsed as Record<string, unknown>;
  if (header.type !== 'session') {
    throw invalidSession(filePath, 'first line is not a valid session header');
  }
  if (header.version !== 3) throw invalidSession(filePath, 'unsupported session version');
  if (typeof header.id !== 'string' || !header.id) {
    throw invalidSession(filePath, 'session header is missing id');
  }
  if (typeof header.timestamp !== 'string' || !header.timestamp) {
    throw invalidSession(filePath, 'session header is missing timestamp');
  }
  if (typeof header.cwd !== 'string' || !header.cwd) {
    throw invalidSession(filePath, 'session header is missing cwd');
  }
  if (header.parentSession !== undefined && typeof header.parentSession !== 'string') {
    throw invalidSession(filePath, 'session header parentSession must be a string');
  }
  if (
    header.metadata !== undefined &&
    (typeof header.metadata !== 'object' || header.metadata === null || Array.isArray(header.metadata))
  ) {
    throw invalidSession(filePath, 'session header metadata must be an object');
  }
}

function parseEntryLine(line: string, filePath: string, lineNumber: number): SessionTreeEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidEntry(filePath, lineNumber, 'is not valid JSON', toError(error));
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw invalidEntry(filePath, lineNumber, 'is not a valid session entry');
  }
  const entry = parsed as SessionTreeEntry;
  if (typeof entry.type !== 'string') throw invalidEntry(filePath, lineNumber, 'is missing entry type');
  if (typeof entry.id !== 'string' || !entry.id) throw invalidEntry(filePath, lineNumber, 'is missing entry id');
  if (entry.parentId !== null && typeof entry.parentId !== 'string') {
    throw invalidEntry(filePath, lineNumber, 'has invalid parentId');
  }
  if (typeof entry.timestamp !== 'string' || !entry.timestamp) {
    throw invalidEntry(filePath, lineNumber, 'is missing timestamp');
  }
  if (entry.type === 'leaf' && entry.targetId !== null && typeof entry.targetId !== 'string') {
    throw invalidEntry(filePath, lineNumber, 'has invalid targetId');
  }
  return entry;
}

async function loadSessionEntries(
  filePath: string,
): Promise<{ entries: SessionTreeEntry[]; leafId: string | null }> {
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
  parseHeaderLine(lines[0], filePath);
  const entries: SessionTreeEntry[] = [];
  let leafId: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    try {
      const entry = parseEntryLine(lines[i], filePath, i + 1);
      entries.push(entry);
      leafId = entry.type === 'leaf' ? entry.targetId : entry.id;
    } catch (error) {
      if (i === lines.length - 1 && error instanceof SessionError && error.code === 'invalid_entry') break;
      throw error;
    }
  }
  return { entries, leafId };
}

// 逐行复刻上游 JsonlSessionStorage.getPathToRootOrCompaction（含 getLeafId 的 leaf 存在性校验）
function resolveBranch(entries: SessionTreeEntry[], leafId: string | null): SessionTreeEntry[] {
  if (leafId === null) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (!byId.has(leafId)) throw new SessionError('invalid_session', `Entry ${leafId} not found`);
  const path: SessionTreeEntry[] = [];
  let stopAtEntryId: string | null = null;
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    if (stopAtEntryId !== null && current.id === stopAtEntryId) break;
    if (current.type === 'compaction') {
      if (current.retainedTail) break;
      stopAtEntryId = current.firstKeptEntryId ?? null;
    }
    if (!current.parentId) break;
    const parent = byId.get(current.parentId);
    if (!parent) throw new SessionError('invalid_session', `Entry ${current.parentId} not found`);
    current = parent;
  }
  return path;
}

export async function readSessionBranchEntries(
  workspaceId: string,
  sessionId: string,
): Promise<SessionTreeEntry[]> {
  const repository = getPiSessionRepository();
  const filePath = await repository.getSessionPath(workspaceId, sessionId);
  const { entries, leafId } = await loadSessionEntries(filePath);
  return resolveBranch(entries, leafId);
}
