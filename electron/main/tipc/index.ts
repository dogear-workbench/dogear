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
import { workspaceConfigRouter } from './workspace-config.js';
import { stockRouter } from './stock.js';
import { wechatRouter } from './wechat.js';
import { conversationRuntimeRouter } from './conversation-runtime.js';
import { environmentRouter } from './environment.js';
import { skillRouter } from './skill.js';
import { usageRouter } from './usage.js';
import { digestRouter } from './digest.js';
import { reviewRouter } from './review.js';
import { categoryRouter } from './category.js';
import { notesRouter } from './notes.js';
import { tasksRouter } from './tasks.js';
import { groupRouter } from './group.js';
import { delegationRouter } from './delegation.js';
import { systemPromptRouter } from './system-prompt.js';
import { updaterRouter } from './updater.js';
import { schedulerRouter } from './scheduler.js';
import { windowsRouter } from './windows.js';

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
  ...workspaceConfigRouter,
  ...stockRouter,
  ...wechatRouter,
  ...conversationRuntimeRouter,
  ...environmentRouter,
  ...skillRouter,
  ...usageRouter,
  ...digestRouter,
  ...reviewRouter,
  ...categoryRouter,
  ...notesRouter,
  ...tasksRouter,
  ...groupRouter,
  ...delegationRouter,
  ...systemPromptRouter,
  ...updaterRouter,
  ...schedulerRouter,
  ...windowsRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
  // Phase 3: 注册文章解析状态变化的全局监听器（AgentManager → 所有窗口）
  registerArticleParseStatusListener();
}
