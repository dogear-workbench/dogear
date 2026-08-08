/**
 * 组级摘要卡 MCP Server 工具（dogear-group-digest，Phase 3）
 *
 * GROUP_DIGEST_SESSION agent 用：ReadGroupDigest + SaveGroupDigest + SaveGroupBackground
 * digest.md 是给人看 + 首页复盘用；background.md 是给「组内新会话」派子会话读的结构化背景
 */
import { z } from 'zod';
import {
  readGroupDigest, saveGroupDigest, mergeSourcesSeen,
  type GroupDigestCard,
  getGroupDigestPath,
} from '../../services/memory/group-digest-store.js';
import {
  saveGroupBackground, getBackgroundPath, type GroupBackground,
} from '../../services/memory/background-store.js';
import {
  buildSessionUuidIndex, validateItemSources, type SourceProblem,
} from '../../services/memory/source-fidelity.js';
import { requireActiveGroup } from '../../services/group-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


function formatFidelityError(problems: SourceProblem[]): string {
  const lines: string[] = [`保真度校验失败，以下 ${problems.length} 条引用无效：`, ''];
  for (const p of problems) {
    lines.push(`item[${p.itemIndex}]「${p.itemText}」  ${p.sessionId}#${p.uuid}`);
    if (p.kind === 'session_missing') {
      lines.push(`  ✗ session_missing：找不到会话 ${p.sessionId} 的逐字稿文件`);
    } else if (p.kind === 'uuid_not_found') {
      lines.push(`  ✗ uuid_not_found：该 uuid 在会话 ${p.sessionId} 的去噪逐字稿里不存在`);
    } else {
      lines.push(`  ✗ wrong_session：该 uuid 真正属于会话 ${p.correctSessionId}，请把 sessionId 改为 ${p.correctSessionId}`);
    }
  }
  lines.push('');
  lines.push('修复步骤：');
  lines.push('1. 调 CleanTranscript(sessionId) 重新查证该会话，uuid 在 "## [role · ts · uuid]" 的第三段');
  lines.push('2. wrong_session 类型只需把 source.sessionId 改为上面给出的正确会话 id');
  lines.push('3. 若确实查不到对应消息，删掉这条 source；若某条 item 的 sources 全部无效则删掉整条 item');
  return lines.join('\n');
}

export function createGroupDigestToolDefs(
  workspaceId: string,
  _workspacePath: string,
  groupId: string,
  dirtyConversations: Array<{ conversationId: string; sessionId: string; mtime: number }>,
  onDigestSaved?: () => void,
  onBackgroundSaved?: () => void,
): ToolDef[] {
  return [
    defineTool(
      'ReadGroupDigest',
      '读取组摘要卡',
      '读取本组现有的组卡。无组卡时返回「(无组卡)」。groupId 必须等于上下文中给定的 groupId。',
      z.object({ groupId: z.string() }),
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

    defineTool(
      'SaveGroupDigest',
      '保存组摘要卡',
      '写入本组组卡。sourcesSeen 由工具自动用 task payload 的 dirtyConversations 合并已有 sourcesSeen 后维护；重复写覆盖旧卡。',
      z.object({
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
      }),
      async (args) => {
        try {
          if (args.groupId !== groupId) {
            return { content: [{ type: 'text' as const, text: `Error: groupId 必须是 ${groupId}` }], isError: true };
          }
          await requireActiveGroup(workspaceId, groupId);
          if (args.items.length > 0) {
            const sessionIds = [...new Set(args.items.flatMap((item) => item.sources.map((s) => s.sessionId)))];
            const index = await buildSessionUuidIndex(workspaceId, sessionIds);
            const problems = validateItemSources(index, args.items);
            if (problems.length > 0) {
              return { content: [{ type: 'text' as const, text: formatFidelityError(problems) }], isError: true };
            }
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
          onDigestSaved?.();
          return {
            content: [{ type: 'text' as const, text: `已保存组卡 → ${getGroupDigestPath(workspaceId, groupId)}（${args.items.length} items / ${args.keyOutputs.length} keyOutputs）` }],
          };
        } catch (e) {
          return { content: [{ type: 'text' as const, text: `保存组卡失败: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
      },
    ),

    defineTool(
      'SaveGroupBackground',
      '保存组背景摘要',
      '写入本组 background.md（给下一个新会话读的结构化背景）。'
        + '4 字段：topic 一句话组主题；progress 2-3 句当前进展；'
        + 'keyDecisions 数组罗列已拍板的决策（避免下个新会话重议）；'
        + 'openQuestions 数组罗列未决/搁置的问题。'
        + 'groupId 必须等于上下文中给定的 groupId。',
      z.object({
        groupId: z.string(),
        topic: z.string().min(1),
        progress: z.string().min(1),
        keyDecisions: z.array(z.string().min(1)),
        openQuestions: z.array(z.string().min(1)),
      }),
      async (args) => {
        try {
          if (args.groupId !== groupId) {
            return { content: [{ type: 'text' as const, text: `Error: groupId 必须是 ${groupId}` }], isError: true };
          }
          await requireActiveGroup(workspaceId, groupId);
          const bg: GroupBackground = {
            groupId,
            updatedAt: new Date().toISOString(),
            topic: args.topic,
            progress: args.progress,
            keyDecisions: args.keyDecisions,
            openQuestions: args.openQuestions,
          };
          await saveGroupBackground(workspaceId, bg);
          onBackgroundSaved?.();
          return {
            content: [{
              type: 'text' as const,
              text: `已保存 background → ${getBackgroundPath(workspaceId, groupId)}（${args.keyDecisions.length} decisions / ${args.openQuestions.length} questions）`,
            }],
          };
        } catch (e) {
          return {
            content: [{ type: 'text' as const, text: `保存 background 失败: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          };
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-group-digest',
  label: '组卡管理',
  create: createGroupDigestToolDefs,
  placeholder: ['', '', '', []],
});
