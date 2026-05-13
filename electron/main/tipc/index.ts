// electron/main/tipc/index.ts
import { registerIpcMain } from '@egoist/tipc/main';
import { aiRouter } from './ai.js';
import { fileRouter } from './file.js';
import { workspaceRouter } from './workspace.js';
import { agentRouter } from './agent.js';
import { conversationsRouter } from './conversations.js';
import { articleRouter, registerArticleParseStatusListener } from './article.js';
import { explorerRouter } from './explorer.js';
import { settingsRouter } from './settings.js';
import { memoryRouter } from './memory.js';
import { logRouter } from './log.js';
import { claudeConfigRouter } from './claude-config.js';
import { stockRouter } from './stock.js';
import { wechatRouter } from './wechat.js';
import { conversationRuntimeRouter } from './conversation-runtime.js';
import { environmentRouter } from './environment.js';

export const router = {
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
  ...articleRouter,
  ...explorerRouter,
  ...settingsRouter,
  ...memoryRouter,
  ...logRouter,
  ...claudeConfigRouter,
  ...stockRouter,
  ...wechatRouter,
  ...conversationRuntimeRouter,
  ...environmentRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
  // Phase 3: 注册文章解析状态变化的全局监听器（AgentManager → 所有窗口）
  registerArticleParseStatusListener();
}
