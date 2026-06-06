// 跨会话复盘卡存储（里程碑 2 Phase B）
// 每工作区单张滚动卡，落 <configDir>/workspaces/<wsId>/review.md
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';

// ─── 复盘卡结构 ───

export interface ReviewRef {
  sessionId: string;
  uuid: string;
}

export interface ReviewItem {
  kind: string; // 未闭环 / 反复出现 / 已否决 / 悬而未决（工具层用 zod 约束枚举）
  text: string;
  refs: ReviewRef[];
}

export interface ReviewCard {
  reviewedAt: string;
  coveredCount: number;
  items: ReviewItem[];
}

const ITEM_SEP = ' ⟶ ';
const REF_SEP = ', ';
// 行格式：- [kind] text ⟶ sess1:uuid1, sess2:uuid2
const ITEM_RE = /^- \[(.+?)\] ([\s\S]*?) ⟶ (.*)$/;

// ─── 路径 ───

export function getReviewPath(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'review.md');
}

// ─── 序列化 / 解析（纯函数，可单测）───

function serializeRefs(refs: ReviewRef[]): string {
  return refs.map((r) => `${r.sessionId}:${r.uuid}`).join(REF_SEP);
}

function parseRefs(s: string): ReviewRef[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/,\s*/)
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx < 0) return null;
      return { sessionId: pair.slice(0, idx), uuid: pair.slice(idx + 1) };
    })
    .filter((r): r is ReviewRef => !!r && !!r.sessionId && !!r.uuid);
}

export function serializeReviewCard(card: ReviewCard): string {
  const fm: Frontmatter = {
    reviewedAt: card.reviewedAt,
    coveredCount: String(card.coveredCount),
  };
  const itemLines = card.items.map(
    (i) => `- [${i.kind}] ${i.text.replace(/\s*\n\s*/g, ' ')}${ITEM_SEP}${serializeRefs(i.refs)}`,
  );
  const body = '## 复盘\n' + (itemLines.length ? itemLines.join('\n') + '\n' : '');
  return stringifyFrontmatter(fm, body);
}

export function parseReviewCard(raw: string): ReviewCard | null {
  const { fm, body } = parseFrontmatter(raw);
  const items: ReviewItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(ITEM_RE);
    if (m) items.push({ kind: m[1], text: m[2].trim(), refs: parseRefs(m[3]) });
  }
  return {
    reviewedAt: strOf(fm.reviewedAt),
    coveredCount: Number(strOf(fm.coveredCount)) || 0,
    items,
  };
}

function strOf(v: Frontmatter[string] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
}

// ─── 读写 ───

export async function saveReview(wsId: string, card: ReviewCard): Promise<void> {
  const dir = getWorkspaceDataDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getReviewPath(wsId), serializeReviewCard(card), 'utf-8');
}

export async function readReview(wsId: string): Promise<ReviewCard | null> {
  try {
    const raw = await fs.readFile(getReviewPath(wsId), 'utf-8');
    return parseReviewCard(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}
