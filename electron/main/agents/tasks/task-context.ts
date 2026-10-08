import type { WorkerToMainMessage } from '../task-types.js';

/**
 * 任务 handler 与 Worker 壳的桥接上下文。
 * handler 不得静态依赖 electron/tipc；主进程侧服务一律动态 import。
 */
export interface TaskHandlerContext {
  configDir: string;
  sendMessage: (message: WorkerToMainMessage) => void;
  setAbortController: (controller: AbortController | null) => void;
}
