// 会话摘要卡 + 留底干净稿存储（里程碑 2 Phase A，决策 J）
// 挂靠软件管理的工作区数据 <configDir>/workspaces/<wsId>/digests/
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';

// ─── 摘要卡结构（设计 4.3，无 topics）───

export type DigestItemKind = '决策' | '想法' | '注意' | '搁置';

export interface DigestCard {
  sessionId: string;
  conversationId?: string;
  title: string;
  createdAt: string;
  sourceMtime: number;
  turnCount: number;
  summary: string;
  items: { kind: string; text: string; uuid: string }[];
}

const ITEM_SEP = ' ⟶ ';
const ITEM_RE = /^- \[(.+?)\] ([\s\S]*?) ⟶ (\S+)$/;

// ─── 路径 ───

export function getDigestsDir(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'digests');
}

export function getDigestPath(wsId: string, sessionId: string): string {
  return path.join(getDigestsDir(wsId), `${sessionId}.md`);
}

function getCleanedDir(wsId: string): string {
  return path.join(getDigestsDir(wsId), '_cleaned');
}

export function getCleanedBackupPath(wsId: string, sessionId: string): string {
  return path.join(getCleanedDir(wsId), `${sessionId}.md`);
}

// ─── 留底干净稿 ───

export async function saveCleanedBackup(
  wsId: string, sessionId: string, transcript: string,
): Promise<void> {
  const dir = getCleanedDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getCleanedBackupPath(wsId, sessionId), transcript, 'utf-8');
}

// ─── 摘要卡序列化 / 解析（纯函数，可单测）───

export function serializeDigestCard(card: DigestCard): string {
  const fm: Frontmatter = {
    sessionId: card.sessionId,
    title: card.title,
    createdAt: card.createdAt,
    sourceMtime: String(card.sourceMtime),
    turnCount: String(card.turnCount),
  };
  if (card.conversationId) fm.conversationId = card.conversationId;
  const itemLines = card.items.map(
    (i) => `- [${i.kind}] ${i.text.replace(/\s*\n\s*/g, ' ')}${ITEM_SEP}${i.uuid}`,
  );
  const body =
    `## 概述\n${card.summary}\n\n## 想法 / 注意 / 决策\n` +
    (itemLines.length ? itemLines.join('\n') + '\n' : '');
  return stringifyFrontmatter(fm, body);
}

export function parseDigestCard(raw: string): DigestCard | null {
  const { fm, body } = parseFrontmatter(raw);
  const sessionId = strOf(fm.sessionId);
  if (!sessionId) return null;

  const summaryMatch = body.match(/## 概述\s*\n([\s\S]*?)(?:\n## |\s*$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  const items: DigestCard['items'] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(ITEM_RE);
    if (m) items.push({ kind: m[1], text: m[2].trim(), uuid: m[3] });
  }

  const conversationId = strOf(fm.conversationId);
  return {
    sessionId,
    conversationId: conversationId || undefined,
    title: strOf(fm.title),
    createdAt: strOf(fm.createdAt),
    sourceMtime: Number(strOf(fm.sourceMtime)) || 0,
    turnCount: Number(strOf(fm.turnCount)) || 0,
    summary,
    items,
  };
}

function strOf(v: Frontmatter[string] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
}

// ─── 摘要卡读写 ───

export async function saveDigest(wsId: string, card: DigestCard): Promise<void> {
  const dir = getDigestsDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getDigestPath(wsId, card.sessionId), serializeDigestCard(card), 'utf-8');
}

export async function readDigest(wsId: string, sessionId: string): Promise<DigestCard | null> {
  try {
    const raw = await fs.readFile(getDigestPath(wsId, sessionId), 'utf-8');
    return parseDigestCard(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}
