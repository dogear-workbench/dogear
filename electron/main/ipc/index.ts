/**
 * IPC 处理器注册入口
 * 统一注册所有 IPC 处理器
 */

import { registerBookHandlers } from './books.js';
import { registerAIHandlers } from './ai.js';
import { registerFileHandlers } from './files.js';
import { registerAgentHandlers } from './agents.js';
import { registerWorkspaceHandlers } from './workspaces.js';
import { registerConversationHandlers } from './conversations.js';

/**
 * 注册所有 IPC 处理器
 */
export function registerAllHandlers() {
  registerBookHandlers();
  registerAIHandlers();
  registerFileHandlers();
  registerAgentHandlers();
  registerWorkspaceHandlers();
  registerConversationHandlers();
}
