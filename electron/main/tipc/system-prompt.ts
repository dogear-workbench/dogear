import { tipc } from '@egoist/tipc/main';
import { getSystemPromptSegments } from '../agents/session-append-templates.js';

const t = tipc.create();

export const systemPromptRouter = {
  /** 拉取系统提示词展示段清单（模板 + 触发条件），供设置页展示"用户看不见的隐形段"。 */
  getSystemPromptSegments: t.procedure
    .action(async () => {
      try {
        return { segments: getSystemPromptSegments() };
      } catch (error) {
        console.error('[system-prompt] getSystemPromptSegments 失败:', error);
        return { error: String(error) };
      }
    }),
};
