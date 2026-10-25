// electron/main/tipc/index.ts
import { registerIpcMain } from '@egoist/tipc/main';
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
import { assetsRouter } from './assets.js';
import { logRouter } from './log.js';
import { claudeConfigRouter } from './claude-config.js';
import { abilityRouter } from './ability.js';
import { workspaceConfigRouter } from './workspace-config.js';
import { feishuRouter } from './feishu.js';
import { conversationRuntimeRouter } from './conversation-runtime.js';
import { environmentRouter } from './environment.js';
import { skillRouter } from './skill.js';
import { usageRouter } from './usage.js';
import { notesRouter } from './notes.js';
import { tasksRouter } from './tasks.js';
import { notificationsRouter } from './notifications.js';
import { groupRouter } from './group.js';
import { shuntRouter } from './shunt.js';
import { delegationRouter } from './delegation.js';
import { updaterRouter } from './updater.js';
import { schedulerRouter } from './scheduler.js';
import { windowsRouter } from './windows.js';
import { focusRouter } from './focus.js';
import { ptyRouter, registerPtyBroadcaster } from './pty.js';
import { browserRouter, registerHumanInterventionBridge, registerExtensionInterventionBridge, registerExtensionStatusBridge, registerExtensionHandoffBridge } from './browser.js';
import { initExtensionWaitGate } from '../services/browser/extension-wait-gate.js';
import { syncRouter, registerSyncBroadcaster } from './sync.js';

export const router = {
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
  ...assetsRouter,
  ...logRouter,
  ...claudeConfigRouter,
  ...abilityRouter,
  ...workspaceConfigRouter,
  ...feishuRouter,
  ...conversationRuntimeRouter,
  ...environmentRouter,
  ...skillRouter,
  ...usageRouter,
  ...notesRouter,
  ...tasksRouter,
  ...notificationsRouter,
  ...groupRouter,
  ...shuntRouter,
  ...delegationRouter,
  ...updaterRouter,
  ...schedulerRouter,
  ...windowsRouter,
  ...focusRouter,
  ...ptyRouter,
  ...browserRouter,
  ...syncRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
  // Phase 3: 注册文章解析状态变化的全局监听器（AgentManager → 所有窗口）
  registerArticleParseStatusListener();
  // 终端二期：PTY 事件 → 渲染层广播桥接
  registerPtyBroadcaster();
  // 人工等待：全量广播桥接 + 新卡打扰（intervention-notify）
  registerHumanInterventionBridge();
  // 浏览器扩展连接状态：gateway → 渲染层广播桥接
  registerExtensionStatusBridge();
  // 扩展断连分流：已配置任务浏览器时自动拉起+等待连接卡（gateway not_connected gate 注册）
  initExtensionWaitGate();
  // 浏览器一键移交：gateway page_handoff 帧 → 最近活跃会话路由 + 通知中心
  registerExtensionHandoffBridge();
  // 扩展登录自动检测：intervention_resolved 回推 → 自动解除该 tab 人工等待
  registerExtensionInterventionBridge();
  // 局域网同步：服务层状态/对端/同步进度/配对事件 → 渲染层广播桥接
  registerSyncBroadcaster();
}
