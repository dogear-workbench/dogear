// electron/main/tipc/conversation-runtime.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import type { ConversationRuntimeState } from '../services/conversation-runtime-service.js';
import type { RendererHandlers } from './renderer-handlers.js';

const t = tipc.create();

export const conversationRuntimeRouter = {
  /**
   * 桌面端 attach 到指定 conversation 的 runtime session。
   * 若 conversation 已有存活 session，直接复用（retain +1）并返回当前 turn 快照；
   * 否则由 PiSessionManager 新建/恢复 session——resume 目标由 conversation.sessionId 决定，
   * 不再需要调用方传 resume/fork 参数（fork 已改为 createFork 时同步完成）。
   */
  attachConversationRuntime: t.procedure
    .input<{
      conversationId: string;
      workspaceId: string;
    }>()
    .action(async ({ input, context }) => {
      try {
        const result = await conversationRuntimeService.attachConversation(
          input.conversationId,
          input.workspaceId,
          'desktop',
          { webContentsId: context.sender.id },
        );

        // 复用已有 session 时，把当前 turn 进行中的消息重播给调用者窗口
        // 避免晚打开的渲染层丢失 stream（同旧 createQueryBasedSession 逻辑）
        if (!result.created && result.snapshot.length > 0) {
          setTimeout(() => {
            if (context.sender.isDestroyed()) return;
            const h = getRendererHandlers<RendererHandlers>(context.sender);
            for (const msg of result.snapshot) {
              try {
                h.queryBasedSessionMessage.send({ sessionId: result.sessionId, message: msg });
              } catch {
                // 窗口已销毁，忽略
              }
            }
          }, 100);
        }

        console.log(`[ConvRuntime] attach 完成: convId=${input.conversationId.substring(0, 8)}, created=${result.created}, sessionId=${result.sessionId.substring(0, 8)}`);

        return {
          attachmentId: result.attachmentId,
          sessionId: result.sessionId,
          permissionMode: result.permissionMode,
          created: result.created,
        };
      } catch (error) {
        console.error('attachConversationRuntime 失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 桌面端 detach，释放对 session 的持有。
   * 若这是最后一个 attachment，session 将被真正销毁。
   */
  detachConversationRuntime: t.procedure
    .input<{ attachmentId: string }>()
    .action(async ({ input }) => {
      try {
        const success = conversationRuntimeService.detachAttachment(input.attachmentId);
        return { success };
      } catch (error) {
        console.error('detachConversationRuntime 失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 查询指定 conversation 的当前 runtime 状态（调试/监控用）。
   */
  getConversationRuntimeState: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }): Promise<ConversationRuntimeState> => {
      return conversationRuntimeService.getRuntimeByConversation(input.conversationId);
    }),

};
