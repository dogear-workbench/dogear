/**
 * 会话逐字稿清洗 MCP Server 工具（dogear-memory-digest）
 *
 * 仅保留 CleanTranscript——被 GROUP_DIGEST_SESSION agent 调用。
 * ReadExistingDigest / SaveDigest 已被 ReadGroupDigest / SaveGroupDigest 替代，已删除。
 */
import { z } from 'zod';
import { readCleanTranscript } from '../../services/memory/transcript-cleaner.js';
import { registerTools } from './tool-registry.js';
import { defineTool, toSdkServer, type ToolDef } from '../pi/tool-adapter.js';

registerTools([
  {
    name: 'CleanTranscript',
    description: '对指定会话做确定性去噪，返回干净逐字稿',
    server: 'dogear-memory-digest',
    category: 'memory',
  },
]);

export function createDigestToolDefs(
  _workspaceId: string, workspacePath: string, _onSaved?: () => void,
): ToolDef[] {
  return [
    defineTool(
      'CleanTranscript',
      '对指定会话做确定性去噪，返回干净逐字稿（已剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，每段带完整 uuid）。',
      z.object({ sdkSessionId: z.string().describe('SDK 会话 ID') }),
      async (args) => {
        const result = await readCleanTranscript(workspacePath, args.sdkSessionId);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: `清洗会话失败: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{
            type: 'text' as const,
            text:
              `turnCount=${result.totalCount} ratio=${result.ratio.toFixed(1)}\n` +
              `lastTimestamp=${result.lastTimestamp}\n\n${result.text}`,
          }],
        };
      },
    ),
  ];
}

export function createDigestTools(
  _workspaceId: string, workspacePath: string, _onSaved?: () => void,
) {
  return toSdkServer('dogear-memory-digest', '1.0.0', createDigestToolDefs(_workspaceId, workspacePath, _onSaved));
}
