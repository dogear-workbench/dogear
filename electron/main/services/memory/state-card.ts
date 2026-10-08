// 话题状态卡纯数据层：类型 + zod 增量 schema + 解析/序列化 + 合并函数
// background.md 新 schema（topic 版本链 + 六类条目区 + sourcesSeen）；模型只产增量，合并全为纯代码
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';

// ─── 类型 ───

export type TopicCardCategory =
  | 'completed'
  | 'inProgress'
  | 'decisions'
  | 'blockers'
  | 'nextSteps'
  | 'openQuestions';

export const TOPIC_CARD_CATEGORIES: TopicCardCategory[] = [
  'completed',
  'inProgress',
  'decisions',
  'blockers',
  'nextSteps',
  'openQuestions',
];

const CATEGORY_TITLES: Record<TopicCardCategory, string> = {
  completed: '已完成',
  inProgress: '进行中',
  decisions: '已拍板',
  blockers: '阻碍',
  nextSteps: '下一步',
  openQuestions: '待议',
};

const TITLE_TO_CATEGORY = new Map(
  Object.entries(CATEGORY_TITLES).map(([cat, title]) => [title, cat as TopicCardCategory]),
);

export interface SourceSeen {
  sessionId: string;
  conversationId: string;
  mtime: number;
}

export interface TopicCardEntry {
  id: string;
  text: string;
  source: string;
  ts: string;
}

export interface TopicVersion {
  text: string;
  source: string;
  ts: string;
}

export interface TopicStateCard {
  groupId: string;
  updatedAt: string;
  sourcesSeen: SourceSeen[];
  topicHistory: TopicVersion[];
  pendingTopicChanges: TopicVersion[];
  entries: Record<TopicCardCategory, TopicCardEntry[]>;
}

// ─── 增量 zod schema（Step 2 抽取任务输出结构）───

export const StateIncrementItemSchema = z.object({
  text: z.string().min(1),
  uuid: z.string().min(1),
});

export const StateIncrementSchema = z.object({
  topicChange: z
    .object({
      text: z.string().min(1),
      quote: z.string().optional(),
      uuid: z.string().optional(),
    })
    .optional(),
  completed: z.array(StateIncrementItemSchema).default([]),
  inProgress: z.array(StateIncrementItemSchema).default([]),
  decisions: z.array(StateIncrementItemSchema).default([]),
  blockers: z.array(StateIncrementItemSchema).default([]),
  nextSteps: z.array(StateIncrementItemSchema).default([]),
  openQuestions: z.array(StateIncrementItemSchema).default([]),
  // 跨类退休：被解决/取代的现有条目 id（不限类别），合并时从原类移入 completed 并加「（已解决）」后缀
  resolved: z.array(z.string().min(1)).default([]),
  // 仅 group.title 为空时作为首次命名生效一次（消费在合并调用侧）
  initialTitle: z.string().min(1).optional(),
});

export type StateIncrement = z.infer<typeof StateIncrementSchema>;

// ─── 工具 ───

const SOURCE_ARROW = ' ⟵ ';
const ENTRY_RE = /^- (.+?) ⟵ (\S+) \(([^()]*)\)$/;

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function strOf(v: Frontmatter[string] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
}

function parseJsonArray<T>(v: Frontmatter[string] | undefined, fallback: T[] = []): T[] {
  const raw = strOf(v);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw.replace(/\\"/g, '"'));
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function entryId(text: string, source: string, ts: string): string {
  return createHash('sha1').update(JSON.stringify([text, source, ts])).digest('hex').slice(0, 12);
}

export function makeEntry(text: string, source: string, ts: string): TopicCardEntry {
  const t = normalizeText(text);
  return { id: entryId(t, source, ts), text: t, source, ts };
}

export function makeVersion(text: string, source: string, ts: string): TopicVersion {
  return { text: normalizeText(text), source, ts };
}

function sourceRef(conversationId: string, uuid?: string): string {
  return uuid ? `${conversationId}#${uuid}` : conversationId;
}

export function emptyTopicStateCard(groupId: string, ts?: string): TopicStateCard {
  return {
    groupId,
    updatedAt: ts ?? new Date().toISOString(),
    sourcesSeen: [],
    topicHistory: [],
    pendingTopicChanges: [],
    entries: { completed: [], inProgress: [], decisions: [], blockers: [], nextSteps: [], openQuestions: [] },
  };
}

// ─── 序列化 / 解析 ───

function entryLine(e: TopicCardEntry): string {
  return `- ${e.text}${SOURCE_ARROW}${e.source} (${e.ts})`;
}

export function serializeTopicStateCard(card: TopicStateCard): string {
  const fm: Frontmatter = {
    groupId: card.groupId,
    updatedAt: card.updatedAt,
    sourcesSeenJson: JSON.stringify(card.sourcesSeen),
    pendingTopicChangesJson: JSON.stringify(card.pendingTopicChanges),
  };

  let body = '## 话题背景\n';
  if (card.topicHistory.length) {
    body += card.topicHistory.map((v) => `- ${v.text}${SOURCE_ARROW}${v.source} (${v.ts})`).join('\n') + '\n';
  }
  body += '\n## 当前状态\n';
  for (const cat of TOPIC_CARD_CATEGORIES) {
    body += `\n### ${CATEGORY_TITLES[cat]}\n`;
    const items = card.entries[cat];
    if (items.length) body += items.map(entryLine).join('\n') + '\n';
  }
  return stringifyFrontmatter(fm, body);
}

export function parseTopicStateCard(raw: string): TopicStateCard | null {
  const { fm, body } = parseFrontmatter(raw);
  const groupId = strOf(fm.groupId);
  // 无 sourcesSeenJson 的是旧 4 字段格式卡，不再解析（当作无卡，状态重新积累）
  if (!groupId || fm.sourcesSeenJson === undefined) return null;

  const card = emptyTopicStateCard(groupId);
  card.updatedAt = strOf(fm.updatedAt);
  card.sourcesSeen = parseJsonArray<SourceSeen>(fm.sourcesSeenJson);
  card.pendingTopicChanges = parseJsonArray<TopicVersion>(fm.pendingTopicChangesJson);

  let section: 'topic' | 'entries' | null = null;
  let category: TopicCardCategory | null = null;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '## 话题背景') {
      section = 'topic';
      category = null;
      continue;
    }
    if (t === '## 当前状态') {
      section = 'entries';
      category = null;
      continue;
    }
    if (t.startsWith('### ')) {
      category = section === 'entries' ? TITLE_TO_CATEGORY.get(t.slice(4).trim()) ?? null : null;
      continue;
    }
    const m = t.match(ENTRY_RE);
    if (!m) continue;
    if (section === 'topic') {
      card.topicHistory.push({ text: m[1].trim(), source: m[2], ts: m[3] });
    } else if (section === 'entries' && category) {
      card.entries[category].push(makeEntry(m[1], m[2], m[3]));
    }
  }
  return card;
}

// ─── 合并函数 ───

/** 合并 existing sourcesSeen 与新 mtime（按 sessionId 覆盖）；保留未在 dirty 中且仍存在的 source */
export function mergeSourcesSeen(
  existing: SourceSeen[],
  dirtyConversations: Array<{ conversationId: string; sessionId: string; mtime: number }>,
): SourceSeen[] {
  const map = new Map<string, SourceSeen>();
  for (const s of existing) map.set(s.sessionId, s);
  for (const d of dirtyConversations) {
    map.set(d.sessionId, { sessionId: d.sessionId, conversationId: d.conversationId, mtime: d.mtime });
  }
  return Array.from(map.values());
}

function appendEntryUnique(card: TopicStateCard, category: TopicCardCategory, entry: TopicCardEntry): void {
  const bucket = card.entries[category];
  const dup = bucket.some((e) => e.source === entry.source && e.text === entry.text);
  if (!dup) bucket.push(entry);
}

function cloneCard(card: TopicStateCard): TopicStateCard {
  return structuredClone(card);
}

/** 逐类 append 增量（同来源同 text 去重）+ resolved 跨类退休（移入 completed 加「（已解决）」后缀）+ topicChange 分流 */
export function mergeIncrement(
  card: TopicStateCard,
  increment: StateIncrement,
  opts: { conversationId: string; ts?: string },
): TopicStateCard {
  const next = cloneCard(card);
  const ts = opts.ts ?? new Date().toISOString();

  for (const id of increment.resolved) {
    for (const cat of TOPIC_CARD_CATEGORIES) {
      const idx = next.entries[cat].findIndex((e) => e.id === id);
      if (idx < 0) continue;
      const [entry] = next.entries[cat].splice(idx, 1);
      const text = entry.text.endsWith('（已解决）') ? entry.text : `${entry.text}（已解决）`;
      next.entries.completed.push({ ...entry, text });
      break;
    }
  }

  for (const cat of TOPIC_CARD_CATEGORIES) {
    for (const item of increment[cat]) {
      appendEntryUnique(next, cat, makeEntry(item.text, sourceRef(opts.conversationId, item.uuid), ts));
    }
  }

  if (increment.topicChange) {
    const version = makeVersion(
      increment.topicChange.text,
      sourceRef(opts.conversationId, increment.topicChange.uuid),
      ts,
    );
    // quote 为用户原话证据 → 直接生效；纯模型推断 → 待确认
    if (increment.topicChange.quote?.trim()) {
      appendTopicVersion(next, version);
    } else {
      addPendingTopicChange(next, version);
    }
  }

  next.updatedAt = ts;
  return next;
}

/** 追加 topic 版本链（mutating）；与末位同文本不重复追加 */
export function appendTopicVersion(card: TopicStateCard, version: TopicVersion): TopicStateCard {
  const last = card.topicHistory[card.topicHistory.length - 1];
  if (last && last.text === version.text) return card;
  card.topicHistory.push(version);
  return card;
}

export function addPendingTopicChange(card: TopicStateCard, version: TopicVersion): TopicStateCard {
  const dup = card.pendingTopicChanges.some((v) => v.text === version.text);
  if (!dup) card.pendingTopicChanges.push(version);
  return card;
}

export function confirmPendingTopicChange(card: TopicStateCard, index: number): TopicStateCard | null {
  const [version] = card.pendingTopicChanges.splice(index, 1);
  if (!version) return null;
  appendTopicVersion(card, version);
  return card;
}

export function rejectPendingTopicChange(card: TopicStateCard, index: number): TopicStateCard | null {
  const [version] = card.pendingTopicChanges.splice(index, 1);
  return version ? card : null;
}
