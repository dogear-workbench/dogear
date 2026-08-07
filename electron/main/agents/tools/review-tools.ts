/**
 * 首页报告 MCP Server 工具（dogear-memory-review，历史代号 review）
 *
 * 工具：ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport
 * 全是薄 IO，零分析逻辑——判断、归并、分流（沉淀进记忆 vs 待办进报告）全在提示词里引导 agent。
 * 沉淀进记忆由独立的 dogear-memory server（RecallMemory/SaveMemory/ForgetMemory）承担。
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
      'ListDigests',
      '列出本工作区所有组卡（按组聚合）：每行格式「- groupId · createdAt · 标题 · N会话」。用它和报告的 updatedAt 对比，判断哪些是新组卡（createdAt 晚于 updatedAt 即新）。',
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
      'ReadDigest',
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
      'TraceSource',
      '按 uuid 回溯原始会话，返回该消息及前后对话原文。拿不准某条含义时用它查证；找不到则不要据此条臆断。',
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
      'ReadReport',
      '读取当前首页报告。返回 updatedAt（上次更新时间，用于判断哪些组卡是新的）和正文 markdown。无报告时返回「(无报告)」，据此走全量分支。',
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
      'WriteReport',
      '覆盖写入首页报告（updatedAt 由工具自动生成）。markdown 是给用户看的纯净报告，按四段结构写：' +
      '「最近做了什么」（按主题合并，不按天罗列，不写"已完成"字眼）、' +
      '「需要你处理」（没做的 + 搁置的，合并一类；已解决的直接删除）、' +
      '「持续观察」（做完但等反馈验证效果的）、' +
      '「建议」（不是待办复述，是主动推理的下一步方向 / 健壮性优化 / 风险点，用来启发用户）。' +
      '不放链条 / refs / sessionId（那些进记忆）；不写"最新沉淀"段（沉淀走 SaveMemory）。' +
      '报告是当前状态快照不是历史归档：每次重写都要主动裁剪——已解决的整条删除、已有结果的观察项归档到记忆或直接删、语义重复的合并、"和上次一样"的段落也要重新审视是否还该留，不能因为没变就默认保留。',
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
