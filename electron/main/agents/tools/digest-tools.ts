/**
 * 会话逐字稿清洗 MCP Server 工具（dogear-memory-digest）
 *
 * 仅保留 CleanTranscript——被 GROUP_DIGEST_SESSION agent 调用。
 * ReadExistingDigest / SaveDigest 已被 ReadGroupDigest / SaveGroupDigest 替代，已删除。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { cleanTranscript } from '../../services/memory/transcript-cleaner.js';
import { getWorkspaceDataDir } from '../../services/conversation-service.js';
import { registerTools } from './tool-registry.js';

/** 留底干净逐字稿到 <wsDataDir>/digests/_cleaned/<sessionId>.md（供排查；与组卡同目录） */
async function saveCleanedBackup(wsId: string, sessionId: string, transcript: string): Promise<void> {
  const dir = path.join(getWorkspaceDataDir(wsId), 'digests', '_cleaned');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${sessionId}.md`), transcript, 'utf-8');
}

registerTools([
  {
    name: 'CleanTranscript',
    description: '对指定会话做确定性去噪，返回干净逐字稿',
    server: 'dogear-memory-digest',
    category: 'memory',
  },
]);

/**
 * 创建 CleanTranscript MCP Server
 * @param workspaceId 工作区 ID（留底用）
 * @param workspacePath 工作区绝对路径（定位 JSONL 用）
 * @param _onSaved 保留参数兼容旧调用，目前不使用
 */
export function createDigestTools(
  workspaceId: string, workspacePath: string, _onSaved?: () => void,
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
    ],
  });
}
