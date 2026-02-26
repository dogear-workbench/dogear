// electron/main/tipc/index.ts
import { registerIpcMain } from '@egoist/tipc/main';
import { dbRouter } from './db.js';
import { bookRouter } from './book.js';
import { aiRouter } from './ai.js';
import { fileRouter } from './file.js';
import { workspaceRouter } from './workspace.js';
import { agentRouter } from './agent.js';
import { conversationsRouter } from './conversations.js';
import { articleRouter } from './article.js';

export const router = {
  ...dbRouter,
  ...bookRouter,
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
  ...articleRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
}
