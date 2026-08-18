/**
 * 首页报告 MCP Server 工具（dogear-memory-review，历史代号 review）
 *
 * 工具：dogear__ListDigests / dogear__ReadDigest / dogear__TraceSource / dogear__ReadReport / dogear__WriteReport
 * 全是薄 IO，零分析逻辑——判断、归并、分流（沉淀进记忆 vs 待办进报告）全在提示词里引导 agent。
 * 沉淀进记忆由独立的 dogear-memory server（dogear__RecallMemory/dogear__SaveMemory/dogear__ForgetMemory）承担。
 */
import { z } from 'zod';
import { listGroupDigests, readGroupDigest } from '../../services/memory/group-digest-store.js';
import { readReport, saveReport } from '../../services/memory/review-store.js';
import { readCleanTranscript } from '../pi-session/transcript-adapter.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


function errText(prefix: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

export function createReviewToolDefs(workspaceId: string, _workspacePath: string, onSaved?: () => void): ToolDef[] {
  return [
    defineTool(
      'dogear__ListDigests',
      '列出所有组摘要卡',
      '列出本工作区所有组卡（按组聚合）：每行格式「- groupId · createdAt · 标题 · N会话」。',
      z.object({}),
      async () => {
        try {
          const list = await listGroupDigests(workspaceId);
          const text = list.length
            ? list.map((d) => `- ${d.groupId} · ${d.createdAt} · ${d.title} · ${d.sessionCount}会话`).join('\n')
            : '(无组卡)';
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return errText('列出组卡失败', error);
        }
      },
    ),

    defineTool(
      'dogear__ReadDigest',
      '读取单张组摘要卡',
      '读取单张组卡，返回概述 + items（多源 sources，每条带 sources[{sessionId, uuid}]）+ keyOutputs 段。',
      z.object({ groupId: z.string().describe('组 ID') }),
      async (args) => {
        try {
          const card = await readGroupDigest(workspaceId, args.groupId);
          if (!card) return { content: [{ type: 'text' as const, text: '(无此组卡)' }] };
          const itemsText = card.items.map((i) =>
            `- [${i.kind}] ${i.text} ⟶ ${i.sources.map((s) => `${s.sessionId}#${s.uuid}`).join(', ')}`
          ).join('\n');
          const koText = card.keyOutputs.length
            ? '\n\n## 关键产出\n' + card.keyOutputs.map((o) =>
                `- ${o.path} :: ${o.oneLine}${o.sessionId ? ' ← ' + o.sessionId : ''}`
              ).join('\n')
            : '';
          return {
            content: [{
              type: 'text' as const,
              text: `标题：${card.title}\ncreatedAt：${card.createdAt}\n\n## 概述\n${card.summary}\n\n## items\n${itemsText}${koText}`,
            }],
          };
        } catch (error) {
          return errText('读取组卡失败', error);
        }
      },
    ),

    defineTool(
      'dogear__TraceSource',
      '回溯消息原始出处',
      '按 uuid 回溯原始会话，返回该消息及前后对话原文。',
      z.object({
        sessionId: z.string().describe('出处的 SDK 会话 ID'),
        uuid: z.string().describe('出处 uuid（取自组卡 items.sources）'),
      }),
      async (args) => {
        const r = await readCleanTranscript(workspaceId, args.sessionId, {
          uuid: args.uuid,
          uuidContext: 2,
        });
        if (!r.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: `未在会话 ${args.sessionId} 中找到 uuid ${args.uuid} 对应原文（${r.error}）。请勿据此条臆断，宁可不写。`,
            }],
          };
        }
        return { content: [{ type: 'text' as const, text: r.text }] };
      },
    ),

    defineTool(
      'dogear__ReadReport',
      '读取首页报告',
      '读取当前首页报告。返回 updatedAt（上次更新时间，用于判断哪些组卡是新的）和正文 markdown。无报告时返回「(无报告)」。',
      z.object({}),
      async () => {
        try {
          const report = await readReport(workspaceId);
          if (!report) return { content: [{ type: 'text' as const, text: '(无报告)' }] };
          return {
            content: [{
              type: 'text' as const,
              text: `updatedAt：${report.updatedAt}\n\n${report.markdown}`,
            }],
          };
        } catch (error) {
          return errText('读取报告失败', error);
        }
      },
    ),

    defineTool(
      'dogear__WriteReport',
      '写入首页报告',
      '覆盖写入首页报告（updatedAt 由工具自动生成）。',
      z.object({
        markdown: z.string().min(1).describe('报告正文（纯净 markdown，无 frontmatter）'),
      }),
      async (args) => {
        try {
          const updatedAt = await saveReport(workspaceId, args.markdown);
          onSaved?.();
          return { content: [{ type: 'text' as const, text: `已写入报告（updatedAt=${updatedAt}）` }] };
        } catch (error) {
          return errText('写入报告失败', error);
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-memory-review',
  label: '首页报告',
  create: createReviewToolDefs,
  placeholder: ['', ''],
});
