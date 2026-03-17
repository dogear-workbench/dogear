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
import { explorerRouter } from './explorer.js';
import { settingsRouter } from './settings.js';
import { logRouter } from './log.js';

export const router = {
  ...dbRouter,
  ...bookRouter,
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
  ...articleRouter,
  ...explorerRouter,
  ...settingsRouter,
  ...logRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
}
