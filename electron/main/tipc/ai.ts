// electron/main/tipc/ai.ts
import { tipc } from '@egoist/tipc/main';
import * as aiService from '../services/ai-service.js';

const t = tipc.create();

export const aiRouter = {
  chat: t.procedure
    .input<{ messages: any[] }>()
    .action(async ({ input }) => {
      return aiService.chat(input.messages);
    }),

  summarize: t.procedure
    .input<{ text: string }>()
    .action(async ({ input }) => {
      return aiService.summarize(input.text);
    }),
};
