/**
 * 引用会话/组背景 MCP Server 工具（dogear-reference）
 *
 * 只装到「子会话」——主 agent 靠 CreateSession 派新会话消化后回摘要，避免污染主上下文。
 *
 * 工具：
 * - ReadReferenceSession：读任意 sessionId 的去噪原文（可尾切 / 区间切）
 * - ReadGroupBackground：读本组 background.md 的结构化字段
 * - ListSiblingSessions：列组内兄弟会话（不含派出这个子会话的父会话本身、不含子会话）
 */
import fs from 'node:fs/promises';
import { z } from 'zod';
import { readCleanTranscript } from '../pi-session/transcript-adapter.js';
import { getPiSessionRepository } from '../pi-session/pi-session-repository.js';
import { readGroupBackground } from '../../services/memory/background-store.js';
import { readGroupDigest } from '../../services/memory/group-digest-store.js';
import * as conversationService from '../../services/conversation-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

export interface ReferenceToolsOpts {
  workspaceId: string;
  workspacePath: string;
  groupId: string;
  /** 派出这个子会话的父会话 conversationId，用于从兄弟列表里排除 */
  parentConversationId: string;
}

export function createReferenceToolDefs(opts: ReferenceToolsOpts): ToolDef[] {
  const { workspaceId, groupId, parentConversationId } = opts;

  return [
    defineTool(
      'ReadReferenceSession',
      '读指定 SDK 会话的去噪原文。'
        + '不传 tail/range 返回全量；tail=N 返回后 N 条；range=[start, end) 按去噪后 index 切。'
        + '返回值前几行是 meta（count / totalCount），下面才是正文。'
        + '正文里每块以 `## [role · ts · uuid] ` 开头。'
        + '会话不存在或读失败时返回 error 字符串——原样交回给主 agent，不要臆断。',
      z.object({
        sessionId: z.string().describe('目标会话的 SDK sessionId'),
        tail: z.number().int().positive().optional().describe('尾 N 条（去噪后计数）'),
        rangeStart: z.number().int().nonnegative().optional().describe('起始 index（含），与 rangeEnd 配合使用，闭开区间 [rangeStart, rangeEnd)'),
        rangeEnd: z.number().int().nonnegative().optional().describe('结束 index（不含），与 rangeStart 配合使用'),
      }),
      async (args) => {
        const range = (args.rangeStart != null && args.rangeEnd != null)
          ? [args.rangeStart, args.rangeEnd] as [number, number]
          : undefined;
        const r = await readCleanTranscript(workspaceId, args.sessionId, {
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
      'ReadGroupBackground',
      '读本组 background.md（结构化背景）。'
        + '返回 topic / progress / keyDecisions[] / openQuestions[]。'
        + '当前组：closure 已注入，无需入参。'
        + '如果 background 尚未生成（例如组卡刚创建、还没跑过组提炼），返回明确的 null 说明——'
        + '此时可以退回 ReadGroupDigest 组卡 + ListSiblingSessions 拿组内会话再逐个 ReadReferenceSession 消化。',
      z.object({}),
      async () => {
        const bg = await readGroupBackground(workspaceId, groupId);
        if (!bg) {
          return {
            content: [{
              type: 'text' as const,
              text: `(本组 background.md 尚未生成 · groupId=${groupId}) 请退回 ReadGroupDigest + ListSiblingSessions 兜底。`,
            }],
          };
        }
        const decisions = bg.keyDecisions.length
          ? bg.keyDecisions.map((d) => `- ${d}`).join('\n')
          : '(无)';
        const questions = bg.openQuestions.length
          ? bg.openQuestions.map((q) => `- ${q}`).join('\n')
          : '(无)';
        return {
          content: [{
            type: 'text' as const,
            text:
              `groupId=${bg.groupId} updatedAt=${bg.updatedAt}\n\n` +
              `## 主题\n${bg.topic}\n\n` +
              `## 当前进展\n${bg.progress}\n\n` +
              `## 关键决策（已拍板，不该重议）\n${decisions}\n\n` +
              `## 待议问题（未决 / 搁置）\n${questions}`,
          }],
        };
      },
    ),

    defineTool(
      'ListSiblingSessions',
      '列出本组的兄弟会话（不含派出你的父会话本身、不含子会话、不含已归档）。'
        + '每条给出 sessionId / conversationTitle / lastActivity / isActive（近 5 分钟有活动）/ hasDigestCoverage（是否已被组卡收录）。'
        + '拿到 sessionId 后可以配合 ReadReferenceSession 逐个消化。',
      z.object({}),
      async () => {
        try {
          const parentConv = await conversationService.getById(workspaceId, parentConversationId);
          const parentSessionId = parentConv?.sessionId ?? null;

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
  placeholder: [{ workspaceId: '', groupId: '', parentConversationId: '' }],
});
