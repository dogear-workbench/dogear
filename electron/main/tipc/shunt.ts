import { tipc } from '@egoist/tipc/main';
import { z } from 'zod';
import * as conversationService from '../services/conversation-service.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import { createGroup, requireActiveGroup } from '../services/group-service.js';
import { createNote } from '../services/notes/notes-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';

const t = tipc.create();

export const shuntInputSchema = z.object({
  action: z.enum(['new-session', 'new-topic', 'note']),
  summary: z.string().min(1).max(500),
  userMessage: z.string().max(4000).optional().default(''),
  sourceConversationId: z.string().min(1),
});

export type ShuntExecutionInput = z.infer<typeof shuntInputSchema>;

export interface ShuntExecutionResult {
  ok: boolean;
  conversationId: string | null;
  groupId: string | null;
  noteId: string | null;
  title: string | null;
  /** 会话已创建但运行时拉起失败：保留会话，前端提示手动打开 */
  warning: string | null;
  error: string | null;
}

function fail(error: string): ShuntExecutionResult {
  return { ok: false, conversationId: null, groupId: null, noteId: null, title: null, warning: null, error };
}

function clampTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return (one.length > 30 ? one.slice(0, 30) : one) || '新对话';
}

function buildFirstMessage(sourceTitle: string, summary: string, userMessage: string): string {
  return [
    `来自「${sourceTitle}」的岔题分流`,
    `摘要：${summary}`,
    userMessage ? `补充：${userMessage}` : '',
  ].filter(Boolean).join('\n');
}

function buildNoteContent(summary: string, userMessage: string, sourceTitle: string): string {
  return [
    summary,
    userMessage ? `\n${userMessage}` : '',
    `\n\n> 来自「${sourceTitle}」的岔题分流`,
  ].filter(Boolean).join('');
}

async function createConversationWithFirstMessage(
  workspaceId: string,
  groupId: string,
  title: string,
  modelSelection: conversationService.ConversationIndex['modelSelection'],
  firstMessage: string,
): Promise<{ conversationId: string; warning: string | null }> {
  const conversationId = await conversationService.create(
    workspaceId,
    groupId,
    title,
    modelSelection ?? null,
    { userInitiated: true },
  );

  let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
  try {
    attachment = await conversationRuntimeService.attachConversation(conversationId, workspaceId, 'desktop', {});
  } catch (err) {
    await conversationService.deleteConversation(workspaceId, conversationId).catch(() => { /* 索引清理失败仅留下空会话，可手动删除 */ });
    throw err;
  }

  const session = getPiSessionManager().getSession(attachment.sessionId);
  if (!session) {
    conversationRuntimeService.detachAttachment(attachment.attachmentId);
    return { conversationId, warning: '会话已创建但运行时拉起失败，请稍后在列表中打开该会话重试' };
  }

  const sendPromise = session.sendMessage(firstMessage).catch(() => { /* orphan 保活或索引可见，首条发送失败不阻断 */ });
  // sendMessage 同步段已置 running，立即释放引用走 orphan 保活：新会话跑完自动回收，用户点开则 re-attach
  conversationRuntimeService.detachAttachment(attachment.attachmentId);
  void sendPromise;

  return { conversationId, warning: null };
}

export const shuntRouter = {
  executeShunt: t.procedure
    .input<ShuntExecutionInput>()
    .action(async ({ input }): Promise<ShuntExecutionResult> => {
      try {
        const args = shuntInputSchema.parse(input);
        const located = await conversationService.getByIdGlobal(args.sourceConversationId);
        if (!located) return fail('源会话不存在，无法分流');
        const { conv, workspaceId } = located;

        if (args.action === 'note') {
          const note = await createNote(workspaceId, {
            content: buildNoteContent(args.summary, args.userMessage, conv.title),
            source: { conversationId: conv.id, title: conv.title, date: new Date().toISOString() },
          });
          return { ok: true, conversationId: null, groupId: null, noteId: note.id, title: note.title, warning: null, error: null };
        }

        const title = clampTitle(args.summary);
        let groupId: string;
        if (args.action === 'new-session') {
          if (!conv.groupId) return fail('源会话未关联话题，无法在组内新建会话');
          await requireActiveGroup(workspaceId, conv.groupId);
          groupId = conv.groupId;
        } else {
          groupId = (await createGroup(workspaceId, { title })).id;
        }

        const { conversationId, warning } = await createConversationWithFirstMessage(
          workspaceId,
          groupId,
          title,
          conv.modelSelection,
          buildFirstMessage(conv.title, args.summary, args.userMessage),
        );
        return { ok: true, conversationId, groupId, noteId: null, title, warning, error: null };
      } catch (err) {
        console.error('分流执行失败:', err);
        return fail(err instanceof Error ? err.message : String(err));
      }
    }),
};
