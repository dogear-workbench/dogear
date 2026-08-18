/**
 * 会话逐字稿清洗 MCP Server 工具（dogear-memory-digest）
 *
 * 仅保留 dogear__CleanTranscript——被 GROUP_DIGEST_SESSION agent 调用。
 * ReadExistingDigest / SaveDigest 已被 dogear__ReadGroupDigest / dogear__SaveGroupDigest 替代，已删除。
 */
import { z } from 'zod';
import { readCleanTranscript } from '../../agents/pi-session/transcript-adapter.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


export function createDigestToolDefs(
  workspaceId: string, _workspacePath: string, _onSaved?: () => void,
): ToolDef[] {
  return [
    defineTool(
      'dogear__CleanTranscript',
      '清洗会话逐字稿',
      '对指定会话做确定性去噪，返回干净逐字稿（已剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，每段带完整 uuid）。',
      z.object({ sessionId: z.string().describe('Harness 会话 ID') }),
      async (args) => {
        const result = await readCleanTranscript(workspaceId, args.sessionId);
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

registerToolGroup({
  server: 'dogear-memory-digest',
  label: '逐字稿清洗',
  create: createDigestToolDefs,
  placeholder: ['', ''],
});
