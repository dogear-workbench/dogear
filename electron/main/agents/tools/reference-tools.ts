/**
 * 跨会话检索 + 组协作工具
 *
 * dogear-history（跨会话检索，常驻组）：绑定工作区即注册，不可关，与基础工具同性质——通用检索是基础设施。
 * - dogear__ListTopics：列工作区全部话题（零模型纯本地 IO，跨话题检索入口）
 * - dogear__ReadReferenceSession：读任意 sessionId 的去噪原文（可尾切 / 区间切）
 *
 * dogear-group-context（组状态卡组）：归会话组包，会话属于组且包开时注册。
 * - dogear__ReadGroupBackground：读本组 background.md 的条目化状态卡
 *
 * dogear-sibling（兄弟会话组）：归 Agent 协作包。
 * - dogear__ListSiblingSessions：列组内兄弟会话（子会话排除派自己的父会话；主会话无父会话，列全部同组非子会话）
 */
import fs from 'node:fs/promises';
import { z } from 'zod';
import { readCleanTranscript } from '../pi-session/transcript-adapter.js';
import { getPiSessionRepository } from '../pi-session/pi-session-repository.js';
import { readTopicStateCard, getStaleConversations } from '../../services/memory/background-store.js';
import { fmtTs, sourceLabel, topicOriginLabel, CATEGORY_LABELS, deriveStaleList, staleListText } from '../group-context-builder.js';
import { ensureGroupFresh } from '../../services/memory/state-extract-trigger.js';
import { TOPIC_CARD_CATEGORIES, type TopicCardEntry, type TopicVersion } from '../../services/memory/state-card.js';
import * as conversationService from '../../services/conversation-service.js';
import { listGroups } from '../../services/group-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

const READ_SYNC_WAIT_MS = 120_000;

const COMPLETED_KEEP = 8;

/** 跨会话检索常驻组：只依赖 workspaceId，不需要 groupId / 会话身份 */
export function createHistorySearchToolDefs(workspaceId: string): ToolDef[] {
  return [
    defineTool(
      'dogear__ListTopics',
      '列出工作区全部话题',
      '列出当前工作区的全部话题（含已归档）：每个话题一行 groupId + 话题一句话 + 更新时间 + 主会话数 + 归档状态。零模型纯本地读取，用于跨话题检索时先定位目标话题，再用 dogear__ReadGroupBackground / dogear__ReadReferenceSession 深挖。',
      z.object({}),
      async () => {
        try {
          const [groups, convs] = await Promise.all([
            listGroups(workspaceId),
            conversationService.getByWorkspaceId(workspaceId, { includeArchived: true }),
          ]);
          const mainConvCount = new Map<string, number>();
          for (const c of convs) {
            if (c.groupId && c.role !== 'sub') {
              mainConvCount.set(c.groupId, (mainConvCount.get(c.groupId) ?? 0) + 1);
            }
          }
          const rows: Array<{ groupId: string; label: string; updatedAt: string; mainConvs: number; archived: boolean; sortTs: number }> = [];
          for (const g of groups) {
            let label = g.title?.trim() || '(未命名话题)';
            let updatedAtTs = g.updatedAt;
            try {
              const card = await readTopicStateCard(workspaceId, g.id);
              const topic = card?.topicHistory[card.topicHistory.length - 1];
              if (topic?.text) label = topic.text;
              if (card?.updatedAt) updatedAtTs = Date.parse(card.updatedAt) || updatedAtTs;
            } catch { /* 单组状态卡读失败不阻塞列表，回退组标题 */ }
            rows.push({
              groupId: g.id,
              label,
              updatedAt: fmtTs(new Date(updatedAtTs).toISOString()),
              mainConvs: mainConvCount.get(g.id) ?? 0,
              archived: g.archivedAt !== undefined,
              sortTs: updatedAtTs,
            });
          }
          rows.sort((a, b) => (a.archived === b.archived ? b.sortTs - a.sortTs : a.archived ? 1 : -1));
          if (!rows.length) {
            return { content: [{ type: 'text' as const, text: `(工作区 ${workspaceId} 暂无话题)` }] };
          }
          const lines = rows.map((r) =>
            `- groupId=${r.groupId} · ${r.label} · 更新 ${r.updatedAt} · 主会话 ${r.mainConvs}${r.archived ? ' · 已归档' : ''}`,
          );
          return {
            content: [{ type: 'text' as const, text: `共 ${rows.length} 个话题（workspaceId=${workspaceId}，活跃在前、按更新时间倒序）：\n${lines.join('\n')}` }],
          };
        } catch (e) {
          return {
            content: [{ type: 'text' as const, text: `列话题失败: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          };
        }
      },
    ),

    defineTool(
      'dogear__ReadReferenceSession',
      '读取会话去噪原文',
      '读指定会话的去噪原文（可尾切或区间切）。仅用于需要查看其他会话的完整对话内容时。',
      z.object({
        sessionId: z.string().describe('目标会话的 SDK sessionId'),
        workspaceId: z.string().optional().describe('目标会话所属工作区 id；引用跨工作区会话时从 <conversation> 标签取'),
        tail: z.number().int().positive().optional().describe('返回最后 N 条；不传则返回全量'),
        rangeStart: z.number().int().nonnegative().optional().describe('区间起始（含），与 rangeEnd 配合使用；不传则不切区间'),
        rangeEnd: z.number().int().nonnegative().optional().describe('区间结束（不含），与 rangeStart 配合使用'),
      }),
      async (args) => {
        const range = (args.rangeStart != null && args.rangeEnd != null)
          ? [args.rangeStart, args.rangeEnd] as [number, number]
          : undefined;
        const r = await readCleanTranscript(args.workspaceId ?? workspaceId, args.sessionId, {
          tail: args.tail,
          range,
        });
        if (!r.ok) {
          return {
            content: [{ type: 'text' as const, text: `读会话失败: ${r.error}` }],
            isError: true,
          };
        }
        return {
          content: [{
            type: 'text' as const,
            text: `sessionId=${args.sessionId} count=${r.count} totalCount=${r.totalCount} lastTimestamp=${r.lastTimestamp}\n\n${r.text}`,
          }],
        };
      },
    ),
  ];
}

export interface ReferenceToolsOpts {
  workspaceId: string;
  groupId: string;
  /** 派出这个子会话的父会话 conversationId，用于从兄弟列表里排除。主会话没有父会话 */
  parentConversationId?: string;
  /** 当前会话自身的 conversationId：话题状态抽取与未提炼列表排除自己，避免抽自己正在进行的对话 */
  selfConversationId?: string;
}

export function createGroupContextToolDefs(opts: ReferenceToolsOpts): ToolDef[] {
  const { workspaceId, groupId, selfConversationId } = opts;

  return [
    defineTool(
      'dogear__ReadGroupBackground',
      '读取话题状态卡',
      '读取当前会话组的话题状态卡（返回唯一最新卡）：生效话题（含确立时间）+ 话题版本链 + 六类状态条目（均带来源与时间）。默认精简返回：版本链只记计数、已完成只留最近 8 条（防活跃话题膨胀），需要完整历史时传 full: true。存在未提炼会话时会现场抽取并等待，可能需 30s~2min。仅用于需要了解当前组最新整体状态时。',
      z.object({
        full: z.boolean().optional().describe('true 返回全量（完整版本链 + 全部已完成条目）；缺省精简返回'),
      }),
      async (args) => {
        const fresh = await ensureGroupFresh(workspaceId, groupId, READ_SYNC_WAIT_MS, selfConversationId);
        const card = await readTopicStateCard(workspaceId, groupId);
        if (!card) {
          return {
            content: [{
              type: 'text' as const,
              text: `(本组话题状态卡尚未生成${fresh.synced ? '' : '，且本次同步抽取未能完成'} · groupId=${groupId})`,
            }],
          };
        }
        const withMeta = (source: string, ts: string) => `（${[sourceLabel(source), fmtTs(ts)].filter(Boolean).join(' · ')}）`;
        const topicLines: string[] = [];
        const topic = card.topicHistory[card.topicHistory.length - 1];
        if (topic) {
          const first = card.topicHistory[0];
          topicLines.push(
            `## 话题背景（生效）`,
            topic.text,
            `确立于 ${fmtTs(first?.ts ?? topic.ts)}，${topicOriginLabel(topic.source)}`,
          );
          if (card.topicHistory.length > 1) {
            if (args.full) {
              topicLines.push(
                '',
                `## 话题版本链（共 ${card.topicHistory.length} 版，末位生效）`,
                ...card.topicHistory.map((v: TopicVersion) => `- ${v.text}${withMeta(v.source, v.ts)}`),
              );
            } else {
              topicLines.push(
                '',
                `## 话题版本链（共 ${card.topicHistory.length} 版，末版即上方生效话题；完整链传 full: true）`,
              );
            }
          }
        }
        const entryLines: string[] = [];
        for (const cat of TOPIC_CARD_CATEGORIES) {
          const items = card.entries[cat];
          if (!items.length) continue;
          entryLines.push(`### ${CATEGORY_LABELS[cat]}`);
          if (cat === 'completed' && !args.full && items.length > COMPLETED_KEEP) {
            entryLines.push(...items.slice(-COMPLETED_KEEP).map((e: TopicCardEntry) => `- ${e.text}${withMeta(e.source, e.ts)}`));
            entryLines.push(`- …另有 ${items.length - COMPLETED_KEEP} 条更早的已完成条目（完整列表传 full: true；深挖历史可用 dogear__ReadReferenceSession）`);
          } else {
            entryLines.push(...items.map((e: TopicCardEntry) => `- ${e.text}${withMeta(e.source, e.ts)}`));
          }
        }
        const parts = [
          `groupId=${card.groupId} updatedAt=${fmtTs(card.updatedAt)}`,
          '',
          ...topicLines,
        ];
        if (!fresh.synced) {
          let staleCount = 0;
          let staleList = '';
          try {
            const stale = await getStaleConversations(workspaceId, groupId, selfConversationId);
            staleCount = stale.length;
            staleList = staleListText(await deriveStaleList(workspaceId, stale));
          } catch { /* 列表派生失败不阻塞返回 */ }
          parts.push(
            '',
            `【未能同步】以下为提炼至 ${fmtTs(card.updatedAt)} 的状态${staleCount ? `，另有 ${staleCount} 个会话未提炼，可能包含更晚的事实` : '，本次抽取未能完成'}：`,
          );
          if (staleList) parts.push(staleList);
          parts.push(
            fresh.timedOut
              ? `（同步等待超过 ${READ_SYNC_WAIT_MS / 1000}s，抽取仍在后台进行，可稍后重试本工具获取最新卡）`
              : '（抽取失败，可稍后重试本工具；深挖会话原文可用 dogear__ReadReferenceSession）',
          );
        }
        if (entryLines.length) {
          parts.push('', '## 当前状态', ...entryLines);
        } else if (!topicLines.length) {
          parts.push('(状态卡为空，尚无任何提炼记录)');
        }
        if (card.pendingTopicChanges.length) {
          parts.push(
            '',
            `## 待确认话题变更（${card.pendingTopicChanges.length} 条，等用户在话题面板裁决，不要自行当已生效事实）`,
            ...card.pendingTopicChanges.map((v: TopicVersion) => `- ${v.text}${withMeta(v.source, v.ts)}`),
          );
        }
        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      },
    ),
  ];
}

export function createSiblingToolDefs(opts: ReferenceToolsOpts): ToolDef[] {
  const { workspaceId, groupId, parentConversationId } = opts;

  return [
    defineTool(
      'dogear__ListSiblingSessions',
      '列出组内兄弟会话',
      '列出当前会话组内的兄弟会话（不含父/子会话和已归档）。仅用于需要了解组内还有哪些活跃会话时。',
      z.object({}),
      async () => {
        try {
          const parentSessionId = parentConversationId
            ? (await conversationService.getById(workspaceId, parentConversationId))?.sessionId ?? null
            : null;

          const allConvs = await conversationService.getByWorkspaceId(workspaceId);
          const siblings = allConvs.filter((c) =>
            c.groupId === groupId
            && c.role !== 'sub'
            && c.id !== parentConversationId
            && !!c.sessionId,
          );

          // 状态卡的 sourcesSeen 用来判断该会话是否已被提炼
          const card = await readTopicStateCard(workspaceId, groupId);
          const coveredSids = new Set((card?.sourcesSeen ?? []).map((s) => s.sessionId));

          const now = Date.now();
          const rows: string[] = [];
          for (const c of siblings) {
            const sid = c.sessionId!;
            if (sid === parentSessionId) continue; // 兜底防御
            let mtime = 0;
            try {
              const sessionPath = await getPiSessionRepository().getSessionPath(workspaceId, sid);
              const stat = await fs.stat(sessionPath);
              mtime = stat.mtimeMs;
            } catch { /* session 不存在，视为无活动 */ }
            const isActive = mtime > 0 && now - mtime < ACTIVE_THRESHOLD_MS;
            const hasStateCoverage = coveredSids.has(sid);
            const lastActivity = mtime ? new Date(mtime).toISOString() : '(未知)';
            rows.push(
              `- sessionId=${sid} · title=${c.title} · lastActivity=${lastActivity}`
                + ` · isActive=${isActive} · hasStateCoverage=${hasStateCoverage}`,
            );
          }

          const text = rows.length
            ? `本组共 ${rows.length} 个兄弟会话（groupId=${groupId}）：\n${rows.join('\n')}`
            : `(本组当前无其他兄弟会话，groupId=${groupId})`;
          return { content: [{ type: 'text' as const, text }] };
        } catch (e) {
          return {
            content: [{
              type: 'text' as const,
              text: `列兄弟会话失败: ${e instanceof Error ? e.message : String(e)}`,
            }],
            isError: true,
          };
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-history',
  label: '跨会话检索',
  create: createHistorySearchToolDefs,
  placeholder: [''],
});

registerToolGroup({
  server: 'dogear-group-context',
  label: '会话组状态',
  create: createGroupContextToolDefs,
  placeholder: [{ workspaceId: '', groupId: '' }],
});

registerToolGroup({
  server: 'dogear-sibling',
  label: '兄弟会话',
  create: createSiblingToolDefs,
  placeholder: [{ workspaceId: '', groupId: '' }],
});
