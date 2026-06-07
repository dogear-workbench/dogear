/**
 * 跨会话复盘 MCP Server 工具（dogear-memory-review）
 *
 * 复盘 skill 用：ListDigests / ReadDigest / ReadReviewCard / TraceSource / SaveReviewCard
 * 全是薄 IO，零分析逻辑——判断、归并、保真全在 skill 提示词里引导 agent。
 */
import fs from 'node:fs/promises';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { listDigests, readDigest } from '../../services/memory/digest-store.js';
import { readReview, saveReview, type ReviewCard } from '../../services/memory/review-store.js';
import { traceSourceFromLines } from '../../services/memory/trace-source.js';
import { getSessionJsonlPath } from '../../services/memory/session-paths.js';
import { registerTools } from './tool-registry.js';

registerTools([
  { name: 'ListDigests', description: '列出本工作区所有会话摘要卡（含 createdAt）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'ReadDigest', description: '读取单张摘要卡（含条目与回溯 uuid）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'ReadReviewCard', description: '读取当前复盘卡（拿上次复盘时间与存量清单）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'TraceSource', description: '按 uuid 回溯原始会话原文，供查证含义', server: 'dogear-memory-review', category: 'memory' },
  { name: 'SaveReviewCard', description: '覆盖落盘复盘卡（单张滚动）', server: 'dogear-memory-review', category: 'memory' },
]);

const REVIEW_KINDS = ['未闭环', '反复出现', '已否决', '悬而未决'] as const;

function errText(prefix: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

/**
 * 创建跨会话复盘 MCP Server
 * @param workspaceId 工作区 ID（读写摘要卡 / 复盘卡）
 * @param workspacePath 工作区绝对路径（定位原始会话 JSONL 用）
 * @param onSaved 可选：SaveReviewCard 成功时回调（handler 用来判断是否真正落卡）
 */
export function createReviewMcpServer(workspaceId: string, workspacePath: string, onSaved?: () => void) {
  return createSdkMcpServer({
    name: 'dogear-memory-review',
    version: '1.0.0',
    tools: [
      tool(
        'ListDigests',
        '列出本工作区所有会话摘要卡（sessionId · createdAt · 标题）。用它和复盘卡的 reviewedAt 对比，判断哪些是新卡。',
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
        'ReadReviewCard',
        '读取当前复盘卡。无卡时返回「(无复盘卡)」，据此走全量分支。',
        {},
        async () => {
          try {
            const card = await readReview(workspaceId);
            if (!card) return { content: [{ type: 'text' as const, text: '(无复盘卡)' }] };
            const itemsText = card.items
              .map((i) => `- [${i.kind}] ${i.text} ⟶ ${i.refs.map((r) => `${r.sessionId}:${r.uuid}`).join(', ')}`)
              .join('\n');
            return {
              content: [{
                type: 'text' as const,
                text: `reviewedAt：${card.reviewedAt}\ncoveredCount：${card.coveredCount}\n\n## 复盘\n${itemsText}`,
              }],
            };
          } catch (error) {
            return errText('读取复盘卡失败', error);
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
        'SaveReviewCard',
        '覆盖落盘复盘卡（单张滚动）。reviewedAt 与 coveredCount 由工具自动生成，你只填 items。' +
        '每条 item 必须带至少一个 refs(sessionId+uuid)；计数/原因/挂了多久写进 text。',
        {
          items: z.array(z.object({
            kind: z.enum(REVIEW_KINDS).describe('信号类型'),
            text: z.string().min(1).describe('内容（计数/原因/时长写进这里）'),
            refs: z.array(z.object({
              sessionId: z.string().describe('出处会话 ID'),
              uuid: z.string().describe('出处 uuid'),
            })).min(1).describe('回溯出处，跨卡聚合时可多条'),
          })).describe('四类信号清单'),
        },
        async (args) => {
          try {
            const coveredCount = (await listDigests(workspaceId)).length;
            const card: ReviewCard = {
              reviewedAt: new Date().toISOString(),
              coveredCount,
              items: args.items,
            };
            await saveReview(workspaceId, card);
            onSaved?.();
            return {
              content: [{
                type: 'text' as const,
                text: `已保存复盘卡（${args.items.length} 条，覆盖 ${coveredCount} 张摘要卡）`,
              }],
            };
          } catch (error) {
            return errText('保存复盘卡失败', error);
          }
        },
      ),
    ],
  });
}
