// 组级摘要卡存储
// 路径：<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { broadcastGroupDataChanged } from '../renderer-broadcast-lazy.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';
import type { DigestTags } from '../../types.js';

// ─── 类型定义 ───

export type GroupDigestItemKind = '决策' | '想法' | '注意' | '搁置';

export interface GroupDigestSource {
  sessionId: string;
  uuid: string;
}

export interface GroupDigestItem {
  kind: GroupDigestItemKind;
  text: string;
  sources: GroupDigestSource[];
}

export interface GroupDigestKeyOutput {
  path: string;
  oneLine: string;
  sessionId?: string;
}

export interface GroupDigestSourceSeen {
  sessionId: string;
  conversationId: string;
  mtime: number;
}

export interface GroupDigestCard {
  groupId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourcesSeen: GroupDigestSourceSeen[];
  summary: string;
  items: GroupDigestItem[];
  keyOutputs: GroupDigestKeyOutput[];
  tags?: DigestTags;
}

export interface GroupDigestSummary {
  groupId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
}

// ─── 序列化常量 ───

const SOURCE_SEP = ',';
const SESSION_UUID_SEP = '#';
const ITEM_SEP = ' ⟶ ';
// item 行：`- [kind] text ⟶ sessionId#uuid,sessionId2#uuid2`
const ITEM_RE = /^- \[(.+?)\] ([\s\S]*?) ⟶ (\S+)$/;
// keyOutput 行：`- path :: oneLine` 或 `- path :: oneLine ← sessionId`
const KEY_OUTPUT_RE = /^- (.+?) :: (.+?)(?:\s+←\s+(\S+))?$/;

// ─── 路径 ───

/** 工作区所有组共用的父目录：<wsData>/groups/ */
export function getGroupsRootDir(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'groups');
}

/** 单个组的目录：<wsData>/groups/<groupId>/ */
export function getGroupDir(wsId: string, groupId: string): string {
  return path.join(getGroupsRootDir(wsId), groupId);
}

/** 组卡文件：<wsData>/groups/<groupId>/digest.md */
export function getGroupDigestPath(wsId: string, groupId: string): string {
  return path.join(getGroupDir(wsId, groupId), 'digest.md');
}

export async function readGroupDigestRaw(wsId: string, groupId: string): Promise<string | null> {
  try {
    return await fs.readFile(getGroupDigestPath(wsId, groupId), 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

// ─── 纯函数：序列化 / 解析 ───

export function serializeGroupDigest(card: GroupDigestCard): string {
  const fm: Frontmatter = {
    groupId: card.groupId,
    title: card.title,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    sourcesSeenJson: JSON.stringify(card.sourcesSeen),
    keyOutputsJson: JSON.stringify(card.keyOutputs),
  };
  if (card.tags) {
    fm.tagsJson = JSON.stringify(card.tags);
  }

  const itemLines = card.items.map((i) => {
    const sourceStr = i.sources
      .map((s) => `${s.sessionId}${SESSION_UUID_SEP}${s.uuid}`)
      .join(SOURCE_SEP);
    return `- [${i.kind}] ${i.text.replace(/\s*\n\s*/g, ' ')}${ITEM_SEP}${sourceStr}`;
  });

  const keyOutputLines = card.keyOutputs.map((o) => {
    const suffix = o.sessionId ? ` ← ${o.sessionId}` : '';
    return `- ${o.path} :: ${o.oneLine}${suffix}`;
  });

  const body =
    `## 概述\n${card.summary}\n\n## 想法 / 注意 / 决策\n` +
    (itemLines.length ? itemLines.join('\n') + '\n' : '') +
    `\n## 关键产出\n` +
    (keyOutputLines.length ? keyOutputLines.join('\n') + '\n' : '');

  return stringifyFrontmatter(fm, body);
}

export function parseGroupDigest(raw: string): GroupDigestCard | null {
  const { fm, body } = parseFrontmatter(raw);
  const groupId = strOf(fm.groupId);
  if (!groupId) return null;

  const summaryMatch = body.match(/## 概述\s*\n([\s\S]*?)(?:\n## |\s*$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  const items: GroupDigestItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(ITEM_RE);
    if (m) {
      const sourceParts = m[3].split(SOURCE_SEP).map((p) => {
        const idx = p.indexOf(SESSION_UUID_SEP);
        if (idx < 0) return null;
        return { sessionId: p.slice(0, idx), uuid: p.slice(idx + 1) } as GroupDigestSource;
      }).filter((s): s is GroupDigestSource => s !== null);
      items.push({ kind: m[1] as GroupDigestItemKind, text: m[2].trim(), sources: sourceParts });
    }
  }

  // 优先从 frontmatter JSON 读 keyOutputs（比正文解析更可靠）
  let keyOutputs: GroupDigestKeyOutput[] = [];
  const keyOutputsJson = strOf(fm.keyOutputsJson);
  if (keyOutputsJson) {
    try {
      const parsed = JSON.parse(keyOutputsJson.replace(/\\"/g, '"'));
      if (Array.isArray(parsed)) keyOutputs = parsed;
    } catch { /* 降级到正文解析 */ }
  }
  if (keyOutputs.length === 0) {
    const koSection = body.match(/## 关键产出\s*\n([\s\S]*?)(?:\n## |\s*$)/);
    if (koSection) {
      for (const line of koSection[1].split(/\r?\n/)) {
        const m = line.match(KEY_OUTPUT_RE);
        if (m) keyOutputs.push({ path: m[1].trim(), oneLine: m[2].trim(), sessionId: m[3] });
      }
    }
  }

  // 从 frontmatter JSON 读 sourcesSeen
  let sourcesSeen: GroupDigestSourceSeen[] = [];
  const sourcesSeenJson = strOf(fm.sourcesSeenJson);
  if (sourcesSeenJson) {
    try {
      const parsed = JSON.parse(sourcesSeenJson.replace(/\\"/g, '"'));
      if (Array.isArray(parsed)) sourcesSeen = parsed;
    } catch { /* 损坏时返回空 */ }
  }

  let tags: DigestTags | undefined;
  const tagsJson = strOf(fm.tagsJson);
  if (tagsJson) {
    try {
      const parsed = JSON.parse(tagsJson.replace(/\\"/g, '"'));
      if (
        parsed &&
        typeof parsed.primary === 'string' &&
        Array.isArray(parsed.secondary) &&
        parsed.scores &&
        typeof parsed.scores === 'object' &&
        !Array.isArray(parsed.scores)
      ) {
        tags = parsed as DigestTags;
      }
    } catch { /* JSON 损坏：忽略 tags */ }
  }

  return {
    groupId,
    title: strOf(fm.title),
    createdAt: strOf(fm.createdAt),
    updatedAt: strOf(fm.updatedAt),
    sourcesSeen,
    summary,
    items,
    keyOutputs,
    tags,
  };
}

function strOf(v: Frontmatter[string] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
}

// ─── 读写 ───

export async function saveGroupDigest(wsId: string, card: GroupDigestCard): Promise<void> {
  await fs.mkdir(getGroupDir(wsId, card.groupId), { recursive: true });
  await fs.writeFile(getGroupDigestPath(wsId, card.groupId), serializeGroupDigest(card), 'utf-8');
  broadcastGroupDataChanged(wsId, card.groupId);
}

export async function readGroupDigest(wsId: string, groupId: string): Promise<GroupDigestCard | null> {
  try {
    const raw = await fs.readFile(getGroupDigestPath(wsId, groupId), 'utf-8');
    return parseGroupDigest(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** 列出某工作区所有组卡摘要（按 updatedAt 降序），扫 groups/<groupId>/digest.md */
export async function listGroupDigests(wsId: string): Promise<GroupDigestSummary[]> {
  const root = getGroupsRootDir(wsId);
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const out: GroupDigestSummary[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name.startsWith('_')) continue;
    const digestFile = path.join(root, dirent.name, 'digest.md');
    try {
      const raw = await fs.readFile(digestFile, 'utf-8');
      const card = parseGroupDigest(raw);
      if (card) {
        out.push({
          groupId: card.groupId,
          title: card.title,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          sessionCount: card.sourcesSeen.length,
        });
      }
    } catch {
      continue;
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export async function deleteGroupDigest(wsId: string, groupId: string): Promise<void> {
  try {
    await fs.unlink(getGroupDigestPath(wsId, groupId));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

/**
 * 合并 existing sourcesSeen 与 dirtyConversations 的新 mtime（按 sessionId 覆盖）。
 * 保留未在 dirty 中且仍存在的 source（不删除）。
 * 调用方负责提前剔除已删除的 sessionId。
 */
export function mergeSourcesSeen(
  existing: GroupDigestSourceSeen[],
  dirtyConversations: Array<{ conversationId: string; sessionId: string; mtime: number }>,
): GroupDigestSourceSeen[] {
  const map = new Map<string, GroupDigestSourceSeen>();
  for (const s of existing) map.set(s.sessionId, s);
  for (const d of dirtyConversations) {
    map.set(d.sessionId, { sessionId: d.sessionId, conversationId: d.conversationId, mtime: d.mtime });
  }
  return Array.from(map.values());
}
