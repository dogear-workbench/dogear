import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as bridge from '../delegation-bridge.js';
import { registerTools } from './tool-registry.js';

registerTools([
  { name: 'SubmitDelivery', description: '子会话提交交付物（前提是已 WriteGroupFile）', server: 'dogear-sub-agent', category: 'other' },
  { name: 'AskParent', description: '子会话遇到歧义时反问父会话（一次仅能挂起一个问题，回复前不可再问）', server: 'dogear-sub-agent', category: 'other' },
]);

export function createSubAgentTools(opts: {
  workspaceId: string;
  groupId: string;
  childConversationId: string;
  outputPath: string;
}) {
  return createSdkMcpServer({
    name: 'dogear-sub-agent',
    version: '1.0.0',
    tools: [
      tool(
        'SubmitDelivery',
        '向父会话提交交付物。前提：已用 WriteGroupFile 把交付物文件写入 outputPath；outputPath 必须与派遣时一致。',
        {
          summary: z.string().min(1).max(2000).describe('一句话总结你这次交付的内容（≤500 字推荐，硬上限 2000 字符）'),
          outputPath: z.string().min(1).describe('你写入交付物的共享区相对路径，必须与派遣时的 outputPath 一致'),
        },
        async (args) => {
          try {
            await bridge.submitDelivery(opts.childConversationId, args.summary, args.outputPath);
            return {
              content: [{ type: 'text' as const, text: `✅ 交付已提交（${args.outputPath}）` }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: message }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'AskParent',
        '遇到歧义、缺少关键信息时反问父会话。挂起当前回合直到父会话调 ReplyToChild 回应；同一时刻只能挂起一个问题。父会话不可见时（如关闭了 tab）此调用会失败。',
        {
          question: z.string().min(1).describe('要问父会话的问题（自然语言）'),
        },
        async (args) => {
          try {
            const answer = await bridge.askParent(opts.childConversationId, args.question);
            return {
              content: [{ type: 'text' as const, text: `📨 主会话回复：\n${answer}` }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `AskParent 失败：${message}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
