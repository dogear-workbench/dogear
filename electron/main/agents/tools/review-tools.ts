/**
 * 首页报告 MCP Server 工具（dogear-memory-review，历史代号 review）
 *
 * 工具：ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport
 * 全是薄 IO，零分析逻辑——判断、归并、分流（沉淀进记忆 vs 待办进报告）全在提示词里引导 agent。
 * 沉淀进记忆由独立的 dogear-memory server（RecallMemory/SaveMemory/ForgetMemory）承担。
 */
import fs from 'node:fs/promises';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { listDigests, readDigest } from '../../services/memory/digest-store.js';
import { readReport, saveReport } from '../../services/memory/review-store.js';
import { traceSourceFromLines } from '../../services/memory/trace-source.js';
import { getSessionJsonlPath } from '../../services/memory/session-paths.js';
import { registerTools } from './tool-registry.js';

registerTools([
  { name: 'ListDigests', description: '列出本工作区所有会话摘要卡（含 createdAt）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'ReadDigest', description: '读取单张摘要卡（含条目与回溯 uuid）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'TraceSource', description: '按 uuid 回溯原始会话原文，供查证含义', server: 'dogear-memory-review', category: 'memory' },
  { name: 'ReadReport', description: '读取当前首页报告（拿 updatedAt 与正文，用于增量）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'WriteReport', description: '覆盖写入首页报告（纯净 markdown，给用户看）', server: 'dogear-memory-review', category: 'memory' },
]);

function errText(prefix: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

/**
 * 创建首页报告 MCP Server
 * @param workspaceId 工作区 ID（读写摘要卡 / 报告）
 * @param workspacePath 工作区绝对路径（定位原始会话 JSONL 用）
 * @param onSaved 可选：WriteReport 成功时回调（worker 用来判断是否真正落报告）
 */
export function createReviewMcpServer(workspaceId: string, workspacePath: string, onSaved?: () => void) {
  return createSdkMcpServer({
    name: 'dogear-memory-review',
    version: '2.0.0',
    tools: [
      tool(
        'ListDigests',
        '列出本工作区所有会话摘要卡（sessionId · createdAt · 标题）。用它和报告的 updatedAt 对比，判断哪些是新卡（createdAt 晚于 updatedAt 即新，不管几张都要处理）。',
        {},
        async () => {
          try {
            const list = await listDigests(workspaceId);
            const text = list.length
              ? list.map((d) => `- ${d.sessionId} · ${d.createdAt} · ${d.title}`).join('\n')
              : '(无摘要卡)';
            return { content: [{ type: 'text' as const, text }] };
          } catch (error) {
            return errText('列出摘要卡失败', error);
          }
        },
      ),

      tool(
        'ReadDigest',
        '读取单张摘要卡，返回概述 + 条目（每条带回溯 uuid）。',
        { sessionId: z.string().describe('摘要卡的 SDK 会话 ID') },
        async (args) => {
          try {
            const card = await readDigest(workspaceId, args.sessionId);
            if (!card) return { content: [{ type: 'text' as const, text: '(无此摘要卡)' }] };
            const itemsText = card.items.map((i) => `- [${i.kind}] ${i.text} ⟶ ${i.uuid}`).join('\n');
            return {
              content: [{
                type: 'text' as const,
                text: `标题：${card.title}\ncreatedAt：${card.createdAt}\n\n## 概述\n${card.summary}\n\n## 条目\n${itemsText}`,
              }],
            };
          } catch (error) {
            return errText('读取摘要卡失败', error);
          }
        },
      ),

      tool(
        'TraceSource',
        '按 uuid 回溯原始会话，返回该消息及前后对话原文。拿不准某条含义时用它查证；找不到则不要据此条臆断。',
        {
          sessionId: z.string().describe('出处的 SDK 会话 ID'),
          uuid: z.string().describe('出处 uuid（取自摘要卡条目）'),
        },
        async (args) => {
          try {
            const file = getSessionJsonlPath(workspacePath, args.sessionId);
            const raw = await fs.readFile(file, 'utf-8');
            const lines = raw.split('\n').filter(Boolean);
            const r = traceSourceFromLines(lines, args.uuid, 2);
            if (!r.found) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `未在会话 ${args.sessionId} 中找到 uuid ${args.uuid} 对应原文。请勿据此条臆断，宁可不写。`,
                }],
              };
            }
            const text = r.messages
              .map((m) => `[${m.role}${m.uuid === args.uuid ? ' · ★目标' : ''}]\n${m.text}`)
              .join('\n\n');
            return { content: [{ type: 'text' as const, text }] };
          } catch (error) {
            return errText('回溯原文失败', error);
          }
        },
      ),

      tool(
        'ReadReport',
        '读取当前首页报告。返回 updatedAt（上次更新时间，用于判断哪些摘要卡是新的）和正文 markdown。无报告时返回「(无报告)」，据此走全量分支。',
        {},
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

      tool(
        'WriteReport',
        '覆盖写入首页报告（updatedAt 由工具自动生成）。markdown 是给用户看的纯净报告：' +
        '只放需用户主动处理的待办/中断（简述）、近 5 天做了哪些、建议、最新少量沉淀。' +
        '不要放链条/refs/sessionId（那些进记忆）。增量更新：没变的段落原样保留。',
        {
          markdown: z.string().min(1).describe('报告正文（纯净 markdown，无 frontmatter）'),
        },
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
    ],
  });
}
