/**
 * 组级摘要卡 MCP Server 工具（dogear-group-digest，Phase 3）
 *
 * GROUP_DIGEST_SESSION agent 用：ReadGroupDigest + SaveGroupDigest
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  readGroupDigest, saveGroupDigest, mergeSourcesSeen,
  type GroupDigestCard,
  getGroupDigestPath,
} from '../../services/memory/group-digest-store.js';
import { registerTools } from './tool-registry.js';

registerTools([
  {
    name: 'ReadGroupDigest',
    description: '读取本组现有的组卡（含 sourcesSeen / summary / items / keyOutputs / tags）',
    server: 'dogear-group-digest',
    category: 'memory',
  },
  {
    name: 'SaveGroupDigest',
    description: '写入本组组卡（sourcesSeen 由工具自动维护）',
    server: 'dogear-group-digest',
    category: 'memory',
  },
]);

export function createGroupDigestTools(
  workspaceId: string,
  workspacePath: string,
  groupId: string,
  dirtyConversations: Array<{ conversationId: string; sessionId: string; mtime: number }>,
  onSaved?: () => void,
) {
  return createSdkMcpServer({
    name: 'dogear-group-digest',
    version: '1.0.0',
    tools: [
      tool(
        'ReadGroupDigest',
        '读取本组现有的组卡。无组卡时返回「(无组卡)」。groupId 必须等于上下文中给定的 groupId。',
        { groupId: z.string() },
        async (args) => {
          try {
            if (args.groupId !== groupId) {
              return { content: [{ type: 'text' as const, text: `Error: groupId 必须是 ${groupId}` }], isError: true };
            }
            const card = await readGroupDigest(workspaceId, groupId);
            if (!card) return { content: [{ type: 'text' as const, text: '(无组卡)' }] };
            const itemsText = card.items.map((i) =>
              `- [${i.kind}] ${i.text} ⟶ ${i.sources.map((s) => `${s.sessionId}#${s.uuid}`).join(',')}`
            ).join('\n');
            const koText = card.keyOutputs.map((o) =>
              `- ${o.path} :: ${o.oneLine}${o.sessionId ? ' ← ' + o.sessionId : ''}`
            ).join('\n');
            const ssText = card.sourcesSeen.map((s) =>
              `- sessionId=${s.sessionId} conv=${s.conversationId} mtime=${s.mtime}`
            ).join('\n');
            return {
              content: [{ type: 'text' as const, text:
                `标题：${card.title}\nupdatedAt：${card.updatedAt}\n\n## sourcesSeen\n${ssText}\n\n## 概述\n${card.summary}\n\n## items\n${itemsText}\n\n## keyOutputs\n${koText}`,
              }],
            };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `读组卡失败: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
          }
        },
      ),

      tool(
        'SaveGroupDigest',
        '写入本组组卡。sourcesSeen 由工具自动用 task payload 的 dirtyConversations 合并已有 sourcesSeen 后维护；重复写覆盖旧卡。',
        {
          groupId: z.string(),
          title: z.string().min(1),
          summary: z.string().min(1),
          items: z.array(z.object({
            kind: z.enum(['决策', '想法', '注意', '搁置']),
            text: z.string().min(1),
            sources: z.array(z.object({
              sessionId: z.string(),
              uuid: z.string(),
            })).min(1),
          })),
          keyOutputs: z.array(z.object({
            path: z.string().min(1),
            oneLine: z.string().min(1),
            sessionId: z.string().optional(),
          })),
          tags: z.object({
            primary: z.string().min(1),
            secondary: z.array(z.string()).max(3),
            scores: z.record(z.string(), z.number().min(0).max(1)),
          }).optional(),
        },
        async (args) => {
          try {
            if (args.groupId !== groupId) {
              return { content: [{ type: 'text' as const, text: `Error: groupId 必须是 ${groupId}` }], isError: true };
            }
            const existing = await readGroupDigest(workspaceId, groupId);
            const newSourcesSeen = mergeSourcesSeen(existing?.sourcesSeen ?? [], dirtyConversations);
            const now = new Date().toISOString();
            const card: GroupDigestCard = {
              groupId,
              title: args.title,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
              sourcesSeen: newSourcesSeen,
              summary: args.summary,
              items: args.items,
              keyOutputs: args.keyOutputs,
              tags: args.tags,
            };
            await saveGroupDigest(workspaceId, card);
            onSaved?.();
            return {
              content: [{ type: 'text' as const, text: `已保存组卡 → ${getGroupDigestPath(workspaceId, groupId)}（${args.items.length} items / ${args.keyOutputs.length} keyOutputs）` }],
            };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `保存组卡失败: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
          }
        },
      ),
    ],
  });
}
