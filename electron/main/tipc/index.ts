// electron/main/tipc/index.ts
import { registerIpcMain } from '@egoist/tipc/main';
import { aiRouter } from './ai.js';
import { fileRouter } from './file.js';
import { workspaceRouter } from './workspace.js';
import { agentRouter } from './agent.js';
import { conversationsRouter } from './conversations.js';
import { articleRouter, registerArticleParseStatusListener } from './article.js';
import { explorerRouter } from './explorer.js';
import { gitRouter } from './git.js';
import { settingsRouter } from './settings.js';
import { backupRouter } from './backup.js';
import { memoryRouter } from './memory.js';
import { logRouter } from './log.js';
import { claudeConfigRouter } from './claude-config.js';
import { abilityRouter } from './ability.js';
import { workspaceConfigRouter } from './workspace-config.js';
import { stockRouter } from './stock.js';
import { wechatRouter } from './wechat.js';
import { conversationRuntimeRouter } from './conversation-runtime.js';
import { environmentRouter } from './environment.js';
import { skillRouter } from './skill.js';
import { usageRouter } from './usage.js';
import { notesRouter } from './notes.js';
import { tasksRouter } from './tasks.js';
import { notificationsRouter } from './notifications.js';
import { groupRouter } from './group.js';
import { delegationRouter } from './delegation.js';
import { updaterRouter } from './updater.js';
import { schedulerRouter } from './scheduler.js';
import { windowsRouter } from './windows.js';
import { focusRouter } from './focus.js';
import { ptyRouter, registerPtyBroadcaster } from './pty.js';
import { browserRouter, registerBrowserActionBridge, registerExtensionStatusBridge } from './browser.js';

export const router = {
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
  ...articleRouter,
  ...explorerRouter,
  ...gitRouter,
  ...settingsRouter,
  ...backupRouter,
  ...memoryRouter,
  ...logRouter,
  ...claudeConfigRouter,
  ...abilityRouter,
  ...workspaceConfigRouter,
  ...stockRouter,
  ...wechatRouter,
  ...conversationRuntimeRouter,
  ...environmentRouter,
  ...skillRouter,
  ...usageRouter,
  ...notesRouter,
  ...tasksRouter,
  ...notificationsRouter,
  ...groupRouter,
  ...delegationRouter,
  ...updaterRouter,
  ...schedulerRouter,
  ...windowsRouter,
  ...focusRouter,
  ...ptyRouter,
  ...browserRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
  // Phase 3: 注册文章解析状态变化的全局监听器（AgentManager → 所有窗口）
  registerArticleParseStatusListener();
  // 终端二期：PTY 事件 → 渲染层广播桥接
  registerPtyBroadcaster();
  // 浏览器动作流：Agent 工具源接线 + 渲染层增量广播桥接
  registerBrowserActionBridge();
  // 浏览器扩展连接状态：gateway → 渲染层广播桥接
  registerExtensionStatusBridge();
}
