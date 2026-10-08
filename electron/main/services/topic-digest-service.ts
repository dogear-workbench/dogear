import fs from 'node:fs/promises';
import path from 'node:path';
import * as conversationService from './conversation-service.js';
import { getGroupDir } from './memory/background-store.js';
import { buildSessionHistory, type HistoryMessage } from '../agents/pi-session/history-adapter.js';
import { FAILOVER_CONTINUE_SENTINEL } from '../agents/model-failover.js';
import { mainLogger } from '../agents/logger.js';
import { safeJsonWrite } from './safe-json.js';

export interface DigestTurn {
  input: string;
  inputAt: number;
  conclusion: string | null;
  concludedAt: number | null;
}

export interface DigestSession {
  conversationId: string;
  title: string;
  turns: DigestTurn[];
}

export interface TopicDigest {
  version: 1;
  archivedAt: number;
  sessions: DigestSession[];
}

const DIGEST_VERSION = 1;

function getDigestPath(workspaceId: string, groupId: string): string {
  return path.join(getGroupDir(workspaceId, groupId), 'digest.json');
}

// ─── 注入消息判定（tsconfig rootDir 限制无法共享前端模块，语义对齐
// components/agent-chat/utils.ts 的 isSdkInjectedUserMessage + isInjectedUserMessage）───

function isInjectedUserContent(content: string): boolean {
  if (!content) return false;
  if (content.startsWith(FAILOVER_CONTINUE_SENTINEL)) return true;
  if (/<sender\s+kind="/.test(content)) return true;
  if (content.includes('<task-execution>')) return true;
  if (/<command-name>/.test(content)) return true;
  if (/<local-command-stdout>/.test(content)) return true;
  if (/^\s*\/model\s+\S+/.test(content)) return true;
  return false;
}

// ─── 真人原话剥离（对齐前端 parseUserMessageReferences + extractMessagePreview 的剥离口径）───

const STRIPPED_BLOCK_PATTERNS: RegExp[] = [
  /<referenced_articles>[\s\S]*?<\/referenced_articles>/g,
  /<referenced_files>[\s\S]*?<\/referenced_files>/g,
  /<referenced_conversations>[\s\S]*?<\/referenced_conversations>/g,
  /<referenced_shared_files>[\s\S]*?<\/referenced_shared_files>/g,
  /<referenced_notes>[\s\S]*?<\/referenced_notes>/g,
  /<quoted_snippet\s+source="[^"]*">[\s\S]*?<\/quoted_snippet>/g,
  /<sender\s+kind="[^"]*"[^>]*\/>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g,
  /<task-execution>[\s\S]*?<\/task-execution>/g,
  /\n?（注：引用的会话可能属于其他工作区[^\n]*/g,
];

function stripInjectedBlocks(content: string): string {
  let text = content;
  for (const pattern of STRIPPED_BLOCK_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text.replace(/^\n+/, '').trim();
}

// ─── 轮次提取（对齐前端 turns.ts 的 isHeader 语义；HistoryMessage 无 isMeta /
// isCompactSummary 字段——两者是本地乐观态标记，不落盘）───

function extractTurns(messages: HistoryMessage[]): DigestTurn[] {
  const turns: DigestTurn[] = [];
  let current: DigestTurn | null = null;
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (msg.isCompactBoundary || isInjectedUserContent(msg.content)) continue;
      const input = stripInjectedBlocks(msg.content);
      if (!input) continue;
      current = { input, inputAt: msg.timestamp, conclusion: null, concludedAt: null };
      turns.push(current);
    } else if (current && !msg.isCompactBoundary && msg.content.trim()) {
      current.conclusion = msg.content;
      current.concludedAt = msg.timestamp;
    }
  }
  return turns;
}

// ─── 主/子会话判定（语义对齐前端 lib/conversation-sort.ts 的 buildConversationTree）───

function pickMainConversations(
  conversations: conversationService.ConversationIndex[],
): conversationService.ConversationIndex[] {
  const bySessionId = new Map<string, conversationService.ConversationIndex>();
  for (const conv of conversations) {
    if (conv.sessionId) bySessionId.set(conv.sessionId, conv);
  }
  const parentSessionIdOf = (conv: conversationService.ConversationIndex): string | undefined => {
    const meta = conv.contractMetadata;
    return meta?.createdBy === 'agent' ? meta.parentSessionId : undefined;
  };
  return conversations
    .filter((conv) => {
      const parentSessionId = parentSessionIdOf(conv);
      return !(parentSessionId && bySessionId.has(parentSessionId));
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

// ─── 构建 / 读写 ───

async function resolveArchivedAt(workspaceId: string, groupId: string): Promise<number> {
  const { getGroup } = await import('./group-service.js');
  const group = await getGroup(workspaceId, groupId);
  return group?.archivedAt ?? Date.now();
}

async function buildTopicDigest(workspaceId: string, groupId: string, archivedAt: number): Promise<TopicDigest> {
  const conversations = (await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true }))
    .filter((conv) => conv.groupId === groupId);
  const sessions: DigestSession[] = [];
  for (const conv of pickMainConversations(conversations)) {
    const turns = conv.sessionId ? extractTurns(await buildSessionHistory(workspaceId, conv.sessionId)) : [];
    sessions.push({ conversationId: conv.id, title: conv.title, turns });
  }
  return { version: DIGEST_VERSION, archivedAt, sessions };
}

export async function writeTopicDigest(workspaceId: string, groupId: string, digest: TopicDigest): Promise<void> {
  await safeJsonWrite(getDigestPath(workspaceId, groupId), digest);
}

async function readDigestFile(workspaceId: string, groupId: string): Promise<TopicDigest | null> {
  try {
    const raw = await fs.readFile(getDigestPath(workspaceId, groupId), 'utf-8');
    const parsed = JSON.parse(raw) as TopicDigest;
    if (parsed.version !== DIGEST_VERSION || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function buildAndWrite(workspaceId: string, groupId: string): Promise<TopicDigest> {
  const digest = await buildTopicDigest(workspaceId, groupId, await resolveArchivedAt(workspaceId, groupId));
  try {
    await writeTopicDigest(workspaceId, groupId, digest);
  } catch (error) {
    mainLogger.warn(`[topic-digest] digest 落盘失败 groupId=${groupId}:`, error);
  }
  return digest;
}

export async function readOrBuildTopicDigest(workspaceId: string, groupId: string): Promise<TopicDigest> {
  return (await readDigestFile(workspaceId, groupId)) ?? buildAndWrite(workspaceId, groupId);
}

// 预计算入口：归档成功后调用；失败只告警不阻塞归档（浏览时懒构建兜底）
export async function precacheTopicDigest(workspaceId: string, groupId: string): Promise<void> {
  try {
    await buildAndWrite(workspaceId, groupId);
  } catch (error) {
    mainLogger.warn(`[topic-digest] digest 预计算失败 groupId=${groupId}:`, error);
  }
}
