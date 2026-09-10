// 话题状态卡纯数据层：类型 + zod 增量 schema + 解析/序列化 + 合并函数
// background.md 新 schema（topic 版本链 + 六类条目区 + sourcesSeen）；模型只产增量，合并全为纯代码
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';
import type { GroupDigestSourceSeen } from './group-digest-store.js';

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
  sourcesSeen: GroupDigestSourceSeen[];
  topicHistory: TopicVersion[];
  pendingTopicChanges: TopicVersion[];
  entries: Record<TopicCardCategory, TopicCardEntry[]>;
}

export interface LegacyBackground {
  groupId: string;
  updatedAt: string;
  topic: string;
  progress: string;
  keyDecisions: string[];
  openQuestions: string[];
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
  resolved: z.array(z.string().min(1)).default([]),
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

function legacySectionItems(sectionText: string): string[] {
  if (!sectionText || sectionText === '(无)') return [];
  return sectionText
    .split(/\r?\n/)
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
}

function parseLegacyBackgroundFields(fm: Frontmatter, body: string, groupId: string): LegacyBackground {
  const section = (title: string): string => {
    const m = body.match(new RegExp(`## ${title}\\s*\\n([\\s\\S]*?)(?:\\n## |\\s*$)`));
    return m ? m[1].trim() : '';
  };
  return {
    groupId,
    updatedAt: strOf(fm.updatedAt),
    topic: section('主题') || strOf(fm.topic),
    progress: section('当前进展') || strOf(fm.progress),
    keyDecisions: parseJsonArray(fm.keyDecisionsJson, legacySectionItems(section('关键决策'))),
    openQuestions: parseJsonArray(fm.openQuestionsJson, legacySectionItems(section('待议问题'))),
  };
}

export function convertLegacyBackground(bg: LegacyBackground): TopicStateCard {
  const ts = bg.updatedAt || new Date().toISOString();
  const card = emptyTopicStateCard(bg.groupId, ts);
  const topic = normalizeText(bg.topic);
  if (topic) card.topicHistory.push(makeVersion(topic, 'legacy', ts));
  card.entries.inProgress.push(
    ...bg.progress.split(/\r?\n/).map((l) => normalizeText(l)).filter(Boolean).map((l) => makeEntry(l, 'legacy', ts)),
  );
  card.entries.decisions.push(
    ...bg.keyDecisions.map((t) => normalizeText(t)).filter(Boolean).map((t) => makeEntry(t, 'legacy', ts)),
  );
  card.entries.openQuestions.push(
    ...bg.openQuestions.map((t) => normalizeText(t)).filter(Boolean).map((t) => makeEntry(t, 'legacy', ts)),
  );
  return card;
}

export function parseTopicStateCard(raw: string): TopicStateCard | null {
  const { fm, body } = parseFrontmatter(raw);
  const groupId = strOf(fm.groupId);
  if (!groupId) return null;

  // 旧 4 字段格式（无 sourcesSeenJson）→ 迁移为状态卡
  if (fm.sourcesSeenJson === undefined) {
    return convertLegacyBackground(parseLegacyBackgroundFields(fm, body, groupId));
  }

  const card = emptyTopicStateCard(groupId);
  card.updatedAt = strOf(fm.updatedAt);
  card.sourcesSeen = parseJsonArray<GroupDigestSourceSeen>(fm.sourcesSeenJson);
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

function appendEntryUnique(card: TopicStateCard, category: TopicCardCategory, entry: TopicCardEntry): void {
  const bucket = card.entries[category];
  const dup = bucket.some((e) => e.source === entry.source && e.text === entry.text);
  if (!dup) bucket.push(entry);
}

/** 无来源追溯的条目批量追加（legacy 兼容写入 / 旧格式迁移），同 source 同 text 去重 */
export function appendPlainEntries(
  card: TopicStateCard,
  category: TopicCardCategory,
  texts: string[],
  source: string,
  ts: string,
): TopicStateCard {
  for (const t of texts) {
    const normalized = normalizeText(t);
    if (!normalized) continue;
    appendEntryUnique(card, category, makeEntry(normalized, source, ts));
  }
  return card;
}

function cloneCard(card: TopicStateCard): TopicStateCard {
  return structuredClone(card);
}

/** 逐类 append 增量（同来源同 text 去重）+ resolved 条目迁移（inProgress → completed）+ topicChange 分流 */
export function mergeIncrement(
  card: TopicStateCard,
  increment: StateIncrement,
  opts: { conversationId: string; ts?: string },
): TopicStateCard {
  const next = cloneCard(card);
  const ts = opts.ts ?? new Date().toISOString();

  for (const id of increment.resolved) {
    const from = next.entries.inProgress;
    const idx = from.findIndex((e) => e.id === id);
    if (idx >= 0) {
      const [entry] = from.splice(idx, 1);
      next.entries.completed.push(entry);
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
