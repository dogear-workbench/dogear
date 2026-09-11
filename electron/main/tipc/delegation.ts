import { tipc } from '@egoist/tipc/main';
import * as bridge from '../agents/delegation-bridge.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';

const t = tipc.create();

export const delegationRouter = {
  /**
   * 列出指定主会话当前 bridge 内的所有子会话快照
   * 给前端冷启动 / 切换工作区时一次性拉初值用；增量靠 childStatusChanged 事件
   */
  listChildren: t.procedure
    .input<{ parentConversationId: string }>()
    .action(async ({ input }) => {
      try {
        const children = await bridge.getChildrenByParent(input.parentConversationId);
        return { children };
      } catch (error) {
        return { children: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 一次性返回 bridge 当前所有活跃/已 terminal 的子会话快照，
   * conversation-store 启动 / 加载工作区时调一次即可填齐。
   */
  listAllChildren: t.procedure
    .action(async () => {
      try {
        return { children: bridge.getAllChildren() };
      } catch (error) {
        return { children: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 中断指定发起会话名下仍在运行的子会话（标记取消）。
   * 主会话用：用户在 chat UI 点「🛑 中断等待」时触发。
   */
  abortWaitForDeliveries: t.procedure
    .input<{ parentConversationId: string }>()
    .action(async ({ input }) => {
      try {
        return bridge.abortWaitsForParent(input.parentConversationId);
      } catch (error) {
        return { cancelledChildren: 0, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 查指定子会话当前 bridge 快照（找不到返回 null）
   * 子会话顶部 banner 显示交付路径 / 状态用
   */
  getChildSnapshot: t.procedure
    .input<{ childId: string }>()
    .action(async ({ input }) => {
      try {
        return { snapshot: bridge.getChildSnapshot(input.childId) };
      } catch (error) {
        return { snapshot: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 存活会话 conversationId 全量集合（PiSessionManager 内存态派生；冷启动拉初值，增量靠 aliveConversationsChanged） */
  getAliveConversations: t.procedure
    .action(async () => {
      try {
        return { conversationIds: getPiSessionManager().getAliveConversationIds() };
      } catch (error) {
        return { conversationIds: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
