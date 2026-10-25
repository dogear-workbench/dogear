/**
 * 跨会话 + 共享文件检索（零模型）：多词 OR 匹配（任一词命中即候选，结果标注命中词），
 * 三类源按优先级扫描（主会话 → 共享区文件 → 子会话），预算三闸跨源共用，触顶即停保证高优先级源先扫；
 * 相关度分层排序：文件命中 > 标题命中的会话 > 其余（层内按命中词数降序、同分按 recency）。
 * 会话原文一律经 session-history-reader 解析（全局红线：任何模块不得直接 JSON.parse 会话文件）；
 * 只搜 user/assistant 讨论文本不搜 toolResult（工具输出噪音占绝对多数），剥注入块防引用内容误命中
 * （与 topic-digest-service 共用 session-text-strip）。覆盖率必须如实报告。
 */
import {
  readSessionBranchFile,
  type SessionBranchEntry,
} from '../agents/pi-session/session-history-reader.js';
import { getPiSessionRepository } from '../agents/pi-session/pi-session-repository.js';
import * as conversationService from './conversation-service.js';
import type { ConversationIndex } from './conversation-service.js';
import { listGroups } from './group-service.js';
import { listNativeFiles, readNativeFile, parseSourcePointer } from './group-shared-service.js';
import type { Group, NativeFileEntry } from '../types.js';
import { stripInjectedBlocks } from './session-text-strip.js';

const MAX_FILES = 150;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_MS = 10_000;
const DEFAULT_LIMIT = 30;
const MAX_MATCHES_PER_SESSION = 3;
const SNIPPET_CONTEXT_CHARS = 120;
const MAX_QUERIES = 5;
const MAX_FILE_HITS = 5;
const FILE_CONTENT_MAX_CHARS = 8 * 1024;
const TAIL_PREVIEW_CHARS = 200;
const MAX_SCAN_FILE_BYTES = 1024 * 1024;
const SHARED_TEXT_EXTENSIONS = /\.(md|txt)$/i;

export function fmtTs(v: string | number): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface SessionSearchMatch {
  role: 'user' | 'assistant';
  timestamp: number;
  snippet: string;
}

export interface FileSearchHit {
  kind: 'file';
  relPath: string;
  groupId: string;
  groupTitle: string;
  snippet: string;
  content: string;
  truncated: boolean;
  /** 源会话指针（文件首行 <!-- source-session: <id> -->；存量文件无此字段） */
  sourceSessionId?: string;
  matchedTerms: string[];
  mtime: number;
}

export interface SessionSearchHit {
  kind: 'session';
  sessionId: string;
  conversationId: string;
  title: string;
  updatedAt: number;
  archived: boolean;
  groupId: string | null;
  titleMatched: boolean;
  tailPreview: string | null;
  matchedTerms: string[];
  matches: SessionSearchMatch[];
}

export type SearchStoppedBy = 'completed' | 'files' | 'bytes' | 'time';

export interface SessionSearchResult {
  queries: string[];
  totalCandidates: number;
  scanned: number;
  stoppedBy: SearchStoppedBy;
  elapsedMs: number;
  fileHits: FileSearchHit[];
  sessionHits: SessionSearchHit[];
}

interface SearchTerm {
  raw: string;
  lower: string;
}

function normalizeQueries(queries: string[]): string[] {
  const cleaned = (queries ?? []).map((q) => q.trim()).filter((q) => q.length >= 2);
  if (!cleaned.length) throw new Error('检索关键词至少需要 2 个字符');
  if (cleaned.length > MAX_QUERIES) throw new Error(`检索关键词最多 ${MAX_QUERIES} 个`);
  return cleaned;
}

function parseTimeFilter(value: string | undefined, label: string): number | undefined {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) throw new Error(`${label} 时间格式无效：${value}（支持 ISO 或 YYYY-MM-DD）`);
  return ts;
}

function extractMessageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const t = (block as { text?: unknown }).text;
      if (typeof t === 'string') text += t;
    }
  }
  return text;
}

function buildSnippet(text: string, hitStart: number, hitLength: number): string {
  const start = Math.max(0, hitStart - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(text.length, hitStart + hitLength + SNIPPET_CONTEXT_CHARS);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

function matchTerms(text: string, terms: SearchTerm[]): SearchTerm[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.lower));
}

/** snippet 用最早出现的命中词定位 */
function firstHitPosition(text: string, matched: SearchTerm[]): { pos: number; length: number } {
  const lower = text.toLowerCase();
  let pos = Number.POSITIVE_INFINITY;
  let length = 0;
  for (const t of matched) {
    const p = lower.indexOf(t.lower);
    if (p >= 0 && p < pos) {
      pos = p;
      length = t.lower.length;
    }
  }
  return { pos, length };
}

function truncateContent(raw: string): { content: string; truncated: boolean } {
  if (raw.length <= FILE_CONTENT_MAX_CHARS) return { content: raw, truncated: false };
  let content = raw.slice(0, FILE_CONTENT_MAX_CHARS);
  const last = content.charCodeAt(content.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) content = content.slice(0, -1);
  return { content, truncated: true };
}

interface SessionMatchOutcome {
  matchedTerms: SearchTerm[];
  matches: SessionSearchMatch[];
}

function matchSessionEntries(entries: SessionBranchEntry[], terms: SearchTerm[]): SessionMatchOutcome | null {
  const matches: SessionSearchMatch[] = [];
  const matched = new Map<string, SearchTerm>();
  for (const entry of entries) {
    if (matches.length >= MAX_MATCHES_PER_SESSION) break;
    if (entry.type !== 'message') continue;
    const role = entry.message.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const clean = stripInjectedBlocks(extractMessageText(entry.message));
    if (!clean) continue;
    const hitTerms = matchTerms(clean, terms);
    if (!hitTerms.length) continue;
    const { pos, length } = firstHitPosition(clean, hitTerms);
    matches.push({ role, timestamp: entry.timestamp, snippet: buildSnippet(clean, pos, length) });
    for (const t of hitTerms) matched.set(t.lower, t);
  }
  if (!matches.length) return null;
  return { matchedTerms: [...matched.values()], matches };
}

function extractTailPreview(entries: SessionBranchEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
    const text = stripInjectedBlocks(extractMessageText(entry.message));
    if (text) return text.slice(0, TAIL_PREVIEW_CHARS);
  }
  return null;
}

function isTitleMatched(title: string, terms: SearchTerm[]): boolean {
  return matchTerms(title, terms).length > 0;
}

class ScanBudget {
  scanned = 0;
  bytesRead = 0;
  stoppedBy: SearchStoppedBy = 'completed';

  constructor(private startedAt: number) {}

  exhausted(): boolean {
    if (this.scanned >= MAX_FILES) {
      this.stoppedBy = 'files';
      return true;
    }
    if (Date.now() - this.startedAt >= MAX_MS) {
      this.stoppedBy = 'time';
      return true;
    }
    return false;
  }

  wouldExceedBytes(size: number): boolean {
    if (this.bytesRead + size > MAX_BYTES) {
      this.stoppedBy = 'bytes';
      return true;
    }
    return false;
  }
}

function groupDisplayTitle(group: Group): string {
  return group.title?.trim() || '(未命名话题)';
}

/**
 * 多词 OR + 三源分层检索。queries 每词 trim 后 <2 字符抛错（工具层转 isError）；
 * limit 只截断最终输出的会话命中数（扫描期仅受三闸约束，保证分层排序的输入完整）。
 */
export async function searchSessions(
  workspaceId: string,
  opts: {
    queries: string[];
    groupId?: string;
    limit?: number;
    after?: string;
    before?: string;
  },
): Promise<SessionSearchResult> {
  const terms: SearchTerm[] = normalizeQueries(opts.queries).map((raw) => ({ raw, lower: raw.toLowerCase() }));
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const afterTs = parseTimeFilter(opts.after, 'after');
  const beforeTs = parseTimeFilter(opts.before, 'before');
  const startedAt = Date.now();

  const [convs, groups, files] = await Promise.all([
    conversationService.getByWorkspaceId(workspaceId, { includeArchived: true }),
    listGroups(workspaceId),
    getPiSessionRepository().listSessionFiles(workspaceId),
  ]);
  const archivedGroupIds = new Set(groups.filter((g) => g.archivedAt !== undefined).map((g) => g.id));
  const fileBySessionId = new Map(files.map((f) => [f.sessionId, f]));
  const inTimeRange = (ts: number) =>
    (afterTs === undefined || ts > afterTs) && (beforeTs === undefined || ts < beforeTs);

  // getByWorkspaceId 已按 updatedAt 倒序，过滤后保持 recency 顺序
  const filterConvs = (isSub: boolean) => convs.filter((c) =>
    (isSub ? c.role === 'sub' : c.role !== 'sub')
    && !!c.sessionId
    && (opts.groupId ? c.groupId === opts.groupId : true)
    && inTimeRange(Date.parse(c.updatedAt)));
  const mainConvs = filterConvs(false);
  const subConvs = filterConvs(true);

  const budget = new ScanBudget(startedAt);
  const sessionHits: SessionSearchHit[] = [];
  const fileHits: FileSearchHit[] = [];

  interface SharedCandidate {
    group: Group;
    title: string;
    entry: NativeFileEntry;
  }
  const sharedCandidates: SharedCandidate[] = [];
  for (const group of groups) {
    if (opts.groupId && group.id !== opts.groupId) continue;
    let listing: { files: NativeFileEntry[] };
    try {
      listing = await listNativeFiles(workspaceId, group.id);
    } catch {
      continue;
    }
    const title = groupDisplayTitle(group);
    for (const f of listing.files) {
      if (!SHARED_TEXT_EXTENSIONS.test(f.relPath) || f.size > MAX_SCAN_FILE_BYTES) continue;
      if (!inTimeRange(f.mtime)) continue;
      sharedCandidates.push({ group, title, entry: f });
    }
  }

  const scanConversations = async (candidates: ConversationIndex[]): Promise<void> => {
    for (const conv of candidates) {
      if (budget.exhausted()) return;
      const file = fileBySessionId.get(conv.sessionId!);
      if (!file) continue;
      if (budget.wouldExceedBytes(file.sizeBytes)) return;
      let entries: SessionBranchEntry[];
      try {
        entries = await readSessionBranchFile(file.filePath);
      } catch {
        budget.scanned++;
        continue;
      }
      budget.scanned++;
      budget.bytesRead += file.sizeBytes;
      const outcome = matchSessionEntries(entries, terms);
      if (!outcome) continue;
      const title = conv.title?.trim() || `会话 ${conv.id.slice(-6)}`;
      sessionHits.push({
        kind: 'session',
        sessionId: conv.sessionId!,
        conversationId: conv.id,
        title,
        updatedAt: Date.parse(conv.updatedAt),
        archived: conv.groupId ? archivedGroupIds.has(conv.groupId) : false,
        groupId: conv.groupId ?? null,
        titleMatched: isTitleMatched(title, terms),
        tailPreview: extractTailPreview(entries),
        matchedTerms: outcome.matchedTerms.map((t) => t.raw),
        matches: outcome.matches,
      });
    }
  };

  const scanSharedFiles = async (): Promise<void> => {
    for (const { group, title, entry } of sharedCandidates) {
      if (budget.exhausted()) return;
      if (budget.wouldExceedBytes(entry.size)) return;
      let raw: string;
      try {
        raw = await readNativeFile(workspaceId, group.id, entry.relPath);
      } catch {
        budget.scanned++;
        continue;
      }
      budget.scanned++;
      budget.bytesRead += entry.size;
      const matched = matchTerms(raw, terms);
      if (!matched.length) continue;
      const { pos, length } = firstHitPosition(raw, matched);
      fileHits.push({
        kind: 'file',
        relPath: entry.relPath,
        groupId: group.id,
        groupTitle: title,
        snippet: buildSnippet(raw, pos, length),
        ...truncateContent(raw),
        sourceSessionId: parseSourcePointer(raw),
        matchedTerms: matched.map((t) => t.raw),
        mtime: entry.mtime,
      });
    }
  };

  await scanConversations(mainConvs);
  if (budget.stoppedBy === 'completed') await scanSharedFiles();
  if (budget.stoppedBy === 'completed') await scanConversations(subConvs);

  const byTermCount = (a: { matchedTerms: string[] }, b: { matchedTerms: string[] }) =>
    b.matchedTerms.length - a.matchedTerms.length;
  fileHits.sort((a, b) => byTermCount(a, b) || b.mtime - a.mtime);
  sessionHits.sort((a, b) =>
    (a.titleMatched === b.titleMatched ? 0 : a.titleMatched ? -1 : 1)
    || byTermCount(a, b)
    || b.updatedAt - a.updatedAt);

  return {
    queries: terms.map((t) => t.raw),
    totalCandidates: mainConvs.length + subConvs.length + sharedCandidates.length,
    scanned: budget.scanned,
    stoppedBy: budget.stoppedBy,
    elapsedMs: Date.now() - startedAt,
    fileHits: fileHits.slice(0, MAX_FILE_HITS),
    sessionHits: sessionHits.slice(0, limit),
  };
}
