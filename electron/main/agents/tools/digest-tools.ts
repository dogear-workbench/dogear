/**
 * 会话提炼 MCP Server 工具（dogear-memory-digest）
 *
 * DIGEST_SESSION agent 用：CleanTranscript / ReadExistingDigest / SaveDigest
 * 一次性 headless query 自主调用，把一段会话 JSONL 提炼成「会话摘要卡」。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { cleanTranscript } from '../../services/memory/transcript-cleaner.js';
import {
  saveCleanedBackup, saveDigest, readDigest, getDigestPath, type DigestCard,
} from '../../services/memory/digest-store.js';
import * as conversationService from '../../services/conversation-service.js';
import { registerTools } from './tool-registry.js';

registerTools([
  {
    name: 'CleanTranscript',
    description: '对指定会话做确定性去噪，返回干净逐字稿',
    server: 'dogear-memory-digest',
    category: 'memory',
  },
  {
    name: 'ReadExistingDigest',
    description: '读取指定会话的旧摘要卡正文（供对比新旧）',
    server: 'dogear-memory-digest',
    category: 'memory',
  },
  {
    name: 'SaveDigest',
    description: '确定性写入会话摘要卡',
    server: 'dogear-memory-digest',
    category: 'memory',
  },
]);

/** 反查 conversations.json，按 sdkSessionId 找 conversationId（找不到返回 undefined） */
async function lookupConversationId(
  workspaceId: string, sdkSessionId: string,
): Promise<string | undefined> {
  try {
    const list = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
    return list.find((c) => c.sdkSessionId === sdkSessionId)?.id;
  } catch {
    return undefined;
  }
}

/**
 * 创建会话提炼 MCP Server
 * @param workspaceId 工作区 ID（落卡 / 留底用）
 * @param workspacePath 工作区绝对路径（定位 JSONL 用）
 * @param onSaved 可选：SaveDigest 成功时回调（handler 用来判断是否真正落卡）
 */
export function createDigestTools(
  workspaceId: string, workspacePath: string, onSaved?: () => void,
) {
  return createSdkMcpServer({
    name: 'dogear-memory-digest',
    version: '1.0.0',
    tools: [
      tool(
        'CleanTranscript',
        '对指定会话做确定性去噪，返回干净逐字稿（已剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，每段带完整 uuid）。同时落一份留底到磁盘供排查。',
        { sdkSessionId: z.string().describe('SDK 会话 ID') },
        async (args) => {
          try {
            const cleaned = await cleanTranscript(workspacePath, args.sdkSessionId);
            await saveCleanedBackup(workspaceId, args.sdkSessionId, cleaned.transcript);
            return {
              content: [{
                type: 'text' as const,
                text:
                  `turnCount=${cleaned.turnCount} ratio=${cleaned.stats.ratio.toFixed(1)}\n` +
                  `lastTimestamp=${cleaned.lastTimestamp}\n\n${cleaned.transcript}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `清洗会话失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'ReadExistingDigest',
        '读取指定会话已有的摘要卡正文，供对比新旧决定重写/增补。无旧卡时返回「(无旧摘要)」。',
        { sessionId: z.string().describe('SDK 会话 ID') },
        async (args) => {
          try {
            const card = await readDigest(workspaceId, args.sessionId);
            if (!card) {
              return { content: [{ type: 'text' as const, text: '(无旧摘要)' }] };
            }
            const itemsText = card.items
              .map((i) => `- [${i.kind}] ${i.text} ⟶ ${i.uuid}`)
              .join('\n');
            return {
              content: [{
                type: 'text' as const,
                text: `标题：${card.title}\n\n## 概述\n${card.summary}\n\n## 条目\n${itemsText}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `读取旧摘要失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'SaveDigest',
        '确定性写入会话摘要卡（frontmatter / 回溯结构由工具拼装，你只填内容字段）。' +
        'items 每条带 uuid（取自干净逐字稿每段 · 后的 uuid）用于回溯。重提炼会覆盖旧卡。',
        {
          sessionId: z.string().describe('SDK 会话 ID'),
          title: z.string().min(1).describe('一句话标题'),
          summary: z.string().min(1).describe('概述：这次会话做了几件事 + 简述'),
          items: z.array(z.object({
            kind: z.enum(['决策', '想法', '注意', '搁置']).describe('条目类型'),
            text: z.string().min(1).describe('条目内容'),
            uuid: z.string().describe('出处 uuid（取自逐字稿每段 · 后的 uuid）'),
          })).describe('想法/注意/决策/搁置条目列表'),
        },
        async (args) => {
          try {
            const cleaned = await cleanTranscript(workspacePath, args.sessionId);
            const conversationId = await lookupConversationId(workspaceId, args.sessionId);
            const card: DigestCard = {
              sessionId: args.sessionId,
              conversationId,
              title: args.title,
              createdAt: new Date().toISOString(),
              sourceMtime: cleaned.sourceMtime,
              turnCount: cleaned.turnCount,
              summary: args.summary,
              items: args.items,
            };
            await saveDigest(workspaceId, card);
            onSaved?.();
            return {
              content: [{
                type: 'text' as const,
                text: `已保存摘要卡 → ${getDigestPath(workspaceId, args.sessionId)}（${args.items.length} 条目）`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `保存摘要卡失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
