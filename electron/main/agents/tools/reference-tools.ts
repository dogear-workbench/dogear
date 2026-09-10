/**
 * 引用会话/组背景 MCP Server 工具（dogear-reference）
 *
 * 主会话和子会话都装——有 groupId 时自动注册。主 agent 可直接读历史会话和组背景，不必派子会话中转。
 *
 * 工具：
 * - dogear__ReadReferenceSession：读任意 sessionId 的去噪原文（可尾切 / 区间切）
 * - dogear__ReadGroupBackground：读本组 background.md 的条目化状态卡
 * - dogear__ListSiblingSessions：列组内兄弟会话（子会话排除派自己的父会话；主会话无父会话，列全部同组非子会话）
 */
import fs from 'node:fs/promises';
import { z } from 'zod';
import { readCleanTranscript } from '../pi-session/transcript-adapter.js';
import { getPiSessionRepository } from '../pi-session/pi-session-repository.js';
import { readTopicStateCard } from '../../services/memory/background-store.js';
import { fmtTs, sourceLabel, topicOriginLabel, CATEGORY_LABELS } from '../group-context-builder.js';
import { TOPIC_CARD_CATEGORIES, type TopicCardEntry, type TopicVersion } from '../../services/memory/state-card.js';
import { readGroupDigest } from '../../services/memory/group-digest-store.js';
import * as conversationService from '../../services/conversation-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

export interface ReferenceToolsOpts {
  workspaceId: string;
  workspacePath: string;
  groupId: string;
  /** 派出这个子会话的父会话 conversationId，用于从兄弟列表里排除。主会话没有父会话 */
  parentConversationId?: string;
}

export function createReferenceToolDefs(opts: ReferenceToolsOpts): ToolDef[] {
  const { workspaceId, groupId, parentConversationId } = opts;

  return [
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

    defineTool(
      'dogear__ReadGroupBackground',
      '读取话题状态卡',
      '读取当前会话组的条目化状态卡：生效话题（含确立时间）+ 话题版本链 + 六类状态条目（均带来源与时间）。仅用于需要了解当前组最新整体状态时。',
      z.object({}),
      async () => {
        const card = await readTopicStateCard(workspaceId, groupId);
        if (!card) {
          return {
            content: [{
              type: 'text' as const,
              text: `(本组话题状态卡尚未生成 · groupId=${groupId})`,
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
            topicLines.push(
              '',
              `## 话题版本链（共 ${card.topicHistory.length} 版，末位生效）`,
              ...card.topicHistory.map((v: TopicVersion) => `- ${v.text}${withMeta(v.source, v.ts)}`),
            );
          }
        }
        const entryLines: string[] = [];
        for (const cat of TOPIC_CARD_CATEGORIES) {
          const items = card.entries[cat];
          if (!items.length) continue;
          entryLines.push(`### ${CATEGORY_LABELS[cat]}`);
          entryLines.push(...items.map((e: TopicCardEntry) => `- ${e.text}${withMeta(e.source, e.ts)}`));
        }
        const parts = [
          `groupId=${card.groupId} updatedAt=${fmtTs(card.updatedAt)}`,
          '',
          ...topicLines,
        ];
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

          // 组卡的 sourcesSeen 用来判 hasDigestCoverage
          const card = await readGroupDigest(workspaceId, groupId);
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
            const hasDigestCoverage = coveredSids.has(sid);
            const lastActivity = mtime ? new Date(mtime).toISOString() : '(未知)';
            rows.push(
              `- sessionId=${sid} · title=${c.title} · lastActivity=${lastActivity}`
                + ` · isActive=${isActive} · hasDigestCoverage=${hasDigestCoverage}`,
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
  server: 'dogear-reference',
  label: '跨会话引用',
  create: createReferenceToolDefs,
  placeholder: [{ workspaceId: '', groupId: '' }],
});
