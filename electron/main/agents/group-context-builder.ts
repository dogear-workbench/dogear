/**
 * 会话启动时把所属组的概况拼到 systemPrompt 的 append 末尾。
 * 话题状态段：读 background.md 状态卡 + conversations.json 派生未提炼会话列表（纯代码零模型）。
 * 文件清单与单文件内容靠 dogear__ListGroupFiles 工具按需获取（避免 prompt 膨胀）。
 */

import * as groupService from '../services/group-service.js';
import * as conversationService from '../services/conversation-service.js';
import {
  getStaleConversations,
  readTopicStateCard,
  type StaleConversation,
} from '../services/memory/background-store.js';
import {
  TOPIC_CARD_CATEGORIES,
  type TopicCardCategory,
  type TopicCardEntry,
  type TopicStateCard,
} from '../services/memory/state-card.js';
import { mainLogger } from './logger.js';

const logger = mainLogger.child('group-context-builder');

// 注入裁剪：每类最多条数 / 状态段字符上限（超限先砍 completed，再跨类砍最旧，每类保底 1 条）
const MAX_ENTRIES_PER_CATEGORY = 8;
const STATE_SECTION_MAX_CHARS = 2400;
// 未提炼会话列表最多列几条，其余合并计数
const MAX_STALE_LISTED = 5;

// 注入显示顺序（对齐设计文档模板行序）
const CATEGORY_ORDER: TopicCardCategory[] = [
  'inProgress',
  'completed',
  'nextSteps',
  'blockers',
  'decisions',
  'openQuestions',
];
export const CATEGORY_LABELS: Record<TopicCardCategory, string> = {
  inProgress: '进行中',
  completed: '已完成',
  nextSteps: '下一步',
  blockers: '阻碍',
  decisions: '已拍板',
  openQuestions: '待议',
};

export function fmtTs(v: string | number): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 条目来源标注：convId#uuid / user / legacy → 人读短标（ReadGroupBackground 工具输出复用） */
export function sourceLabel(source: string): string {
  if (source === 'user') return '用户';
  if (source === 'legacy') return '';
  return `会话 ${source.split('#')[0].slice(-6)}`;
}

function withSource(text: string, source: string): string {
  const label = sourceLabel(source);
  return label ? `${text}（${label}）` : text;
}

/** topic 生效版本的来源描述（确立来源） */
export function topicOriginLabel(source: string): string {
  if (source === 'user') return '用户确认';
  if (source === 'legacy') return '早期记录';
  return `来自${sourceLabel(source)}`;
}

function isEmptyCard(card: TopicStateCard): boolean {
  return (
    !card.topicHistory.length &&
    TOPIC_CARD_CATEGORIES.every((c) => card.entries[c].length === 0)
  );
}

function pickRecentEntries(card: TopicStateCard): Record<TopicCardCategory, TopicCardEntry[]> {
  const picked = {} as Record<TopicCardCategory, TopicCardEntry[]>;
  for (const cat of TOPIC_CARD_CATEGORIES) {
    picked[cat] = [...card.entries[cat]]
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-MAX_ENTRIES_PER_CATEGORY);
  }
  return picked;
}

function entriesSectionText(entries: Record<TopicCardCategory, TopicCardEntry[]>): string {
  return CATEGORY_ORDER
    .filter((c) => entries[c].length > 0)
    .map((c) => `- ${CATEGORY_LABELS[c]}：${entries[c].map((e) => withSource(e.text, e.source)).join('；')}`)
    .join('\n');
}

/** 状态段总长超预算时先砍 completed（留计数行），仍超再跨类从最旧条目丢起（每类保底 1 条） */
function applyBudget(
  entries: Record<TopicCardCategory, TopicCardEntry[]>,
  otherChars: number,
): { lines: string; completedHidden: number } {
  let completedHidden = 0;
  const overBudget = () => otherChars + entriesSectionText(entries).length > STATE_SECTION_MAX_CHARS;

  if (overBudget() && entries.completed.length) {
    completedHidden = entries.completed.length;
    entries.completed = [];
  }
  while (overBudget()) {
    const oldestCat = TOPIC_CARD_CATEGORIES
      .filter((c) => entries[c].length > 1)
      .sort((a, b) => entries[a][0].ts.localeCompare(entries[b][0].ts))[0];
    if (!oldestCat) break;
    entries[oldestCat].shift();
  }

  const lines = entriesSectionText(entries);
  return { lines, completedHidden };
}

export interface StaleTitleRow {
  mtime: number;
  title: string;
}

/** 未提炼会话 → 标题列表（conversations.json 现场派生，不持久化） */
export async function deriveStaleList(wsId: string, stale: StaleConversation[]): Promise<StaleTitleRow[]> {
  const byId = new Map(
    (await conversationService.getByWorkspaceId(wsId)).map((c) => [c.id, c.title] as const),
  );
  return stale
    .map((s) => ({
      mtime: s.mtime,
      title: byId.get(s.conversationId) ?? `会话 ${s.conversationId.slice(-6)}`,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

export function staleListText(rows: StaleTitleRow[]): string {
  const shown = rows.slice(0, MAX_STALE_LISTED).map((r) => `- ${fmtTs(r.mtime)}「${r.title}」`);
  if (rows.length > MAX_STALE_LISTED) {
    shown.push(`- …另有 ${rows.length - MAX_STALE_LISTED} 个更早会话`);
  }
  return shown.join('\n');
}

async function buildTopicStateSection(wsId: string, groupId: string): Promise<string> {
  const [card, stale] = await Promise.all([
    readTopicStateCard(wsId, groupId),
    getStaleConversations(wsId, groupId),
  ]);

  if (!card || isEmptyCard(card)) {
    const rows = await deriveStaleList(wsId, stale);
    return [
      '### 话题状态（尚未初始化）',
      '本组还没有提炼过的话题背景与状态，不要虚构。',
      '',
      '【最近会话】',
      staleListText(rows),
      '',
      '【指引】了解组内有哪些会话可调 dogear__ListSiblingSessions；深挖某个会话可用 dogear__ReadReferenceSession。',
    ].join('\n');
  }

  const staleNote = stale.length ? ` · 另有 ${stale.length} 个未提炼会话` : '';
  const severe = stale.length > 2 ? '⚠ 未提炼会话较多（重度滞后），以下状态可能明显过期。' : '';

  const topic = card.topicHistory[card.topicHistory.length - 1];
  const first = card.topicHistory[0];
  const entries = pickRecentEntries(card);
  const { lines, completedHidden } = applyBudget(entries, topic?.text.length ?? 0);

  const parts: string[] = ['### 话题状态'];
  if (topic) {
    parts.push(
      `【话题背景】（确立于 ${fmtTs(first?.ts ?? topic.ts)}，${topicOriginLabel(topic.source)}）`,
      topic.text,
    );
  }
  parts.push(`【当前状态】（提炼至 ${fmtTs(card.updatedAt)}${staleNote}）`);
  parts.push(lines || '（暂无条目）');
  if (completedHidden) {
    parts.push(`- 已完成：另有 ${completedHidden} 条较早记录已省略（dogear__ReadGroupBackground 可查）`);
  }
  if (severe) parts.push(severe);
  if (stale.length) {
    const rows = await deriveStaleList(wsId, stale);
    parts.push('【最近未提炼会话】', staleListText(rows));
  }
  parts.push(
    `【指引】${stale.length ? '未提炼会话中可能有更晚的事实，关键决策先与用户确认；' : ''}` +
      '需要最新状态可调 dogear__ReadGroupBackground；需深挖某会话可用 dogear__ReadReferenceSession。',
  );
  return parts.join('\n');
}

/**
 * 构建组上下文片段。失败时返回空串而非抛错。
 */
export async function buildGroupContextPrompt(
  workspaceId: string,
  groupId: string,
): Promise<string> {
  try {
    const group = await groupService.getGroup(workspaceId, groupId);
    if (!group) {
      logger.warn(`组未找到，跳过注入: ws=${workspaceId} gid=${groupId}`);
      return '';
    }

    const title = group.title?.trim() || `未命名组（创建于 ${new Date(group.createdAt).toLocaleString('zh-CN')}）`;
    const header =
      `## 当前会话组上下文\n` +
      `\n` +
      `**组**：${title}\n` +
      `\n` +
      `共享区是会话组内跨会话传递文件的区域。遇到不清楚的背景，先用 dogear__ListGroupFiles 列共享区文件清单，需要细看时传 relPath 读单个文件。\n` +
      `当某个阶段告一段落或上下文用量较高时，可以主动写一份阶段总结到共享区（dogear__SaveSharedNote），方便下次接续或组卡提炼。这不是强制——只在你判断有价值时做。`;

    let stateSection = '';
    try {
      stateSection = await buildTopicStateSection(workspaceId, groupId);
    } catch (e) {
      logger.warn('构建话题状态段失败，仅注入组头部:', e);
    }
    return stateSection ? `${header}\n\n${stateSection}` : header;
  } catch (e) {
    logger.warn('构建组上下文失败，跳过注入:', e);
    return '';
  }
}
