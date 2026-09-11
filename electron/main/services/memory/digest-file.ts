// 存量 digest.md 解析与迁移写入：生产已停止，消费方仅剩历史迁移脚本与智能分类链路（step6 一并删除）
import fs from 'node:fs/promises';
import path from 'node:path';
import { getGroupDir } from './background-store.js';
import { broadcastGroupDataChanged } from '../renderer-broadcast-lazy.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';
import type { SourceSeen } from './state-card.js';
import type { DigestTags } from '../../types.js';

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

export interface GroupDigestCard {
  groupId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourcesSeen: SourceSeen[];
  summary: string;
  items: GroupDigestItem[];
  keyOutputs: GroupDigestKeyOutput[];
  tags?: DigestTags;
}

const SOURCE_SEP = ',';
const SESSION_UUID_SEP = '#';
const ITEM_SEP = ' ⟶ ';
const ITEM_RE = /^- \[(.+?)\] ([\s\S]*?) ⟶ (\S+)$/;
const KEY_OUTPUT_RE = /^- (.+?) :: (.+?)(?:\s+←\s+(\S+))?$/;

/** 组卡文件：<wsData>/groups/<groupId>/digest.md */
export function getGroupDigestPath(wsId: string, groupId: string): string {
  return path.join(getGroupDir(wsId, groupId), 'digest.md');
}

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

  let sourcesSeen: SourceSeen[] = [];
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
