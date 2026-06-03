/**
 * 会话提炼 MCP Server 工具（dogear-memory-digest）
 *
 * DIGEST_SESSION agent 用：CleanTranscript / ReadExistingDigest / SaveDigest
 * 一次性 headless query 自主调用，把一段会话 JSONL 提炼成「会话摘要卡」。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { cleanTranscript } from '../../services/memory/transcript-cleaner.js';
import { saveCleanedBackup } from '../../services/memory/digest-store.js';
import { registerTools } from './tool-registry.js';

registerTools([
  {
    name: 'CleanTranscript',
    description: '对指定会话做确定性去噪，返回干净逐字稿',
    server: 'dogear-memory-digest',
    category: 'memory',
  },
]);

/**
 * 创建会话提炼 MCP Server
 * @param workspaceId 工作区 ID（落卡 / 留底用）
 * @param workspacePath 工作区绝对路径（定位 JSONL 用）
 */
export function createDigestTools(workspaceId: string, workspacePath: string) {
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
    ],
  });
}
