import { z } from 'zod';
import * as conversationService from '../../services/conversation-service.js';
import { conversationRuntimeService } from '../../services/conversation-runtime-service.js';
import { createGroup, requireActiveGroup } from '../../services/group-service.js';
import { getPiSessionManager } from '../pi-session/pi-session-manager.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

/** 挂载上下文：ForkSession 在当前会话所在工作区/话题内平级分出新会话（非 delegation，无父子契约） */
export interface ForkSessionToolOpts {
  workspaceId: string;
  /** 当前会话所在话题组（new-session 的落点） */
  groupId: string;
  /** 当前会话自身 conversationId（模型选择继承来源） */
  conversationId: string;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function clamp(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) : one;
}

export function createForkSessionToolDefs(opts: ForkSessionToolOpts): ToolDef[] {
  return [
    defineTool(
      'dogear__ForkSession',
      '分流出独立平级新会话',
      '在收到用户消息中的 <shunt> 分流标签（action 为 new-session 或 new-topic）时调用：创建一个独立平级的新会话并自动把「分流摘要 + 用户补充」作为它的首条输入发出。' +
        'new-session 落在当前话题组内，new-topic 另起新话题组；均为当前工作区。' +
        '它不是派出子会话：不建立父子契约、当前会话不等待它、它的回复不会回注本会话。' +
        '没有 <shunt> 标签时禁止调用本工具。',
      z.object({
        action: z.enum(['new-session', 'new-topic']).describe('分流动作：new-session=当前话题组内另起会话；new-topic=另起新话题组'),
        summary: z.string().min(1).max(500).describe('分流摘要（<shunt> 标签 summary 属性，作为新会话的首条输入背景）'),
        userMessage: z.string().max(4000).optional().default('').describe('用户补充（<shunt> 标签正文），作为新会话首条输入的用户诉求；无补充则留空'),
        title: z.string().min(1).max(100).optional().describe('新会话标题；缺省用 summary 前 30 字'),
      }),
      async (args) => {
        try {
          const parent = await conversationService.getById(opts.workspaceId, opts.conversationId);
          if (!parent) {
            return errorResult('当前会话不存在，无法分流');
          }

          let groupId = opts.groupId;
          let groupTitle: string | null = null;
          if (args.action === 'new-session') {
            await requireActiveGroup(opts.workspaceId, opts.groupId);
          } else {
            const group = await createGroup(opts.workspaceId, { title: args.title ?? (clamp(args.summary, 30) || '新对话') });
            groupId = group.id;
            groupTitle = group.title ?? null;
          }

          const convTitle = args.title ?? (clamp(args.summary, 30) || '新对话');
          const newId = await conversationService.create(opts.workspaceId, groupId, convTitle, parent.modelSelection ?? null);

          let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
          try {
            attachment = await conversationRuntimeService.attachConversation(newId, opts.workspaceId, 'desktop', {});
          } catch (err) {
            await conversationService.deleteConversation(opts.workspaceId, newId).catch(() => { /* 索引清理失败仅留下空会话，可手动删除 */ });
            throw err;
          }
          const session = getPiSessionManager().getSession(attachment.sessionId);
          if (!session) {
            conversationRuntimeService.detachAttachment(attachment.attachmentId);
            return errorResult(`新会话已创建（${convTitle}）但运行时拉起失败，请稍后在列表中打开该会话重试`);
          }

          const firstMessage = [
            `岔题摘要：${args.summary}`,
            args.userMessage ? `\n用户补充：${args.userMessage}` : '',
          ].filter(Boolean).join('\n');

          const sendPromise = session.sendMessage(firstMessage).catch(() => { /* orphan 保活或索引可见，首条发送失败不阻断回执 */ });
          // sendMessage 同步段已置 running，立即释放引用走 orphan 保活：新会话跑完自动回收，用户点开则 re-attach
          conversationRuntimeService.detachAttachment(attachment.attachmentId);
          void sendPromise;

          const focusLink = `[打开新会话「${convTitle}」](dogear://conversation/${newId}?ws=${encodeURIComponent(opts.workspaceId)})`;
          const groupLine = groupTitle
            ? `新话题组「${groupTitle}」`
            : '当前话题组';
          return textResult(
            `✅ 已在${groupLine}创建新会话「${convTitle}」（id: ${newId}），首条输入 = 分流摘要 + 用户补充，已在后台自动发出。\n` +
            `回执要求：在回复中用一句话简短说明分流去向，并原样包含这个跳转链接（不要改动格式）：${focusLink}\n` +
            `然后继续当前话题，不要等待新会话。`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`分流失败: ${message}`);
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-shunt',
  label: '岔题分流',
  create: createForkSessionToolDefs,
  placeholder: [{ workspaceId: '', groupId: '', conversationId: '' }],
});
