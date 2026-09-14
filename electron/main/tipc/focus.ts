// electron/main/tipc/focus.ts
import { tipc } from '@egoist/tipc/main';
import {
  getFocusedConversation,
  setFocusedConversation,
} from '../services/focused-conversation-service.js';

const t = tipc.create();

export const focusRouter = {
  /** 上报全局焦点会话（主窗口切 tab / 独立会话窗口激活时调用），值变化才广播 */
  setFocusedConversation: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      setFocusedConversation(input);
      return { success: true };
    }),

  /** 查询当前全局焦点会话（工作台窗口冷启动恢复跟随用） */
  getFocusedConversation: t.procedure
    .action(async () => {
      return { focused: getFocusedConversation() };
    }),
};
