import { tipc } from '@egoist/tipc/main';
import * as bridge from '../agents/delegation-bridge.js';

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
   * 中断指定发起会话所有活跃的 dogear__WaitForMessage 等待，并把它名下仍在跑的会话标记为取消。
   * 主会话用：用户在 chat UI 点「🛑 中断等待」时触发。
   */
  abortWaitForDeliveries: t.procedure
    .input<{ parentConversationId: string }>()
    .action(async ({ input }) => {
      try {
        return bridge.abortWaitsForParent(input.parentConversationId);
      } catch (error) {
        return { abortedWaits: 0, cancelledChildren: 0, error: error instanceof Error ? error.message : String(error) };
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
};
