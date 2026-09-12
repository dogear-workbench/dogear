/**
 * 会话启动时把所属组的概况拼到 systemPrompt 的 append 末尾。
 * 话题状态段只注入轻量头（topic + 未提炼标题 + 强指引）；完整卡唯一出口是 dogear__ReadGroupBackground 工具。
 * 文件清单与单文件内容靠 dogear__ListGroupFiles 工具按需获取（避免 prompt 膨胀）。
 */

import * as groupService from '../services/group-service.js';
import * as conversationService from '../services/conversation-service.js';
import {
  getStaleConversations,
  readTopicStateCard,
  type StaleConversation,
} from '../services/memory/background-store.js';
import type { TopicCardCategory } from '../services/memory/state-card.js';
import { mainLogger } from './logger.js';

const logger = mainLogger.child('group-context-builder');

// 未提炼会话列表最多列几条，其余合并计数
const MAX_STALE_LISTED = 5;

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

/** topic 生效版本的来源描述（确立来源） */
export function topicOriginLabel(source: string): string {
  if (source === 'user') return '用户确认';
  if (source === 'legacy') return '早期记录';
  return `来自${sourceLabel(source)}`;
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

async function buildTopicStateSection(wsId: string, groupId: string, selfConversationId?: string): Promise<string> {
  const [card, stale] = await Promise.all([
    readTopicStateCard(wsId, groupId),
    getStaleConversations(wsId, groupId, selfConversationId),
  ]);

  const topic = card?.topicHistory[card.topicHistory.length - 1];
  const parts: string[] = ['### 话题状态'];
  if (topic) {
    const first = card!.topicHistory[0];
    parts.push(
      `【话题背景】（确立于 ${fmtTs(first?.ts ?? topic.ts)}，${topicOriginLabel(topic.source)}）`,
      topic.text,
    );
  } else {
    parts.push('本组还没有提炼过的话题状态，不要虚构。');
  }
  if (stale.length) {
    const rows = await deriveStaleList(wsId, stale);
    parts.push('【最近未提炼会话】', staleListText(rows));
  }
  if (topic || stale.length) {
    const syncNote = stale.length
      ? '（存在未提炼会话时会自动同步，可能需等待；未提炼会话中可能有更晚的事实）'
      : '';
    const topicRef = topic ? '本会话属于上方话题。' : '';
    parts.push(
      `【指引】${topicRef}开局第一轮先调 dogear__ReadGroupBackground 获取话题最新状态${syncNote}；深挖某会话可 dogear__ReadReferenceSession。`,
    );
  }
  return parts.join('\n');
}

/**
 * 构建组上下文片段。selfConversationId 用于话题状态段排除自己；
 * executor（任务执行会话）只注入组头，跳过话题状态 + ReadGroupBackground 指引（无人值守无消费价值）。
 * collabEnabled 为 false（agent-collab 包关闭）时只保留组名一句：共享区引导/话题状态指引会引用未注册的协作工具，避免幻引。
 * 失败时返回空串而非抛错。
 */
export async function buildGroupContextPrompt(
  workspaceId: string,
  groupId: string,
  opts?: { selfConversationId?: string; executor?: boolean; collabEnabled?: boolean },
): Promise<string> {
  try {
    const group = await groupService.getGroup(workspaceId, groupId);
    if (!group) {
      logger.warn(`组未找到，跳过注入: ws=${workspaceId} gid=${groupId}`);
      return '';
    }

    const title = group.title?.trim() || `未命名组（创建于 ${new Date(group.createdAt).toLocaleString('zh-CN')}）`;
    if (opts?.collabEnabled === false) {
      return `## 当前会话组上下文\n\n**组**：${title}`;
    }
    const header =
      `## 当前会话组上下文\n` +
      `\n` +
      `**组**：${title}\n` +
      `\n` +
      `共享区是会话组内跨会话传递文件的区域。遇到不清楚的背景，先用 dogear__ListGroupFiles 列共享区文件清单，需要细看时传 relPath 读单个文件。\n` +
      `当某个阶段告一段落或上下文用量较高时，可以主动写一份阶段总结到共享区（dogear__SaveSharedNote），方便下次接续。这不是强制——只在你判断有价值时做。`;

    if (opts?.executor) return header;

    let stateSection = '';
    try {
      stateSection = await buildTopicStateSection(workspaceId, groupId, opts?.selfConversationId);
    } catch (e) {
      logger.warn('构建话题状态段失败，仅注入组头部:', e);
    }
    return stateSection ? `${header}\n\n${stateSection}` : header;
  } catch (e) {
    logger.warn('构建组上下文失败，跳过注入:', e);
    return '';
  }
}
