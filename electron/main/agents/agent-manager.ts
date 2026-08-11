/**
 * Agent 管理器
 * 负责管理 Agent Worker 的生命周期、任务分配和消息路由
 *
 * 功能:
 * - 管理 Worker 池 (按需创建/销毁)
 * - 任务队列管理
 * - 消息路由 (Worker <-> IPC)
 * - 错误处理和 Worker 崩溃恢复
 * - 会话生命周期管理
 */

import { Worker } from 'worker_threads';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { app } from 'electron';
import {
  AgentTask,
  TaskStatus,
  MainToWorkerMessage,
  WorkerToMainMessage,
  AgentWorkerConfig
} from './task-types.js';
import { mainLogger, createTaskLogger } from './logger.js';

// 获取当前文件的路径 (ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Worker 实例包装器
 */
interface WorkerWrapper {
  workerId: string;
  worker: Worker;
  messagePort: any;
  isReady: boolean;
  currentTaskId: string | null;
  lastActivity: number; // 最后活动时间戳
  createdAt: number;
}

/**
 * 任务回调函数类型
 */
type TaskCallback = (taskId: string, status: TaskStatus, result?: any, error?: string) => void;

/**
 * 流式消息回调函数类型
 */
type StreamCallback = (taskId: string, chunk: string) => void;

/**
 * 会话消息回调函数类型
 */
type SessionMessageCallback = (sessionId: string, message: string) => void;

/**
 * Agent 管理器配置
 */
export interface AgentManagerConfig {
  maxWorkers?: number;          // 最大 Worker 数量 (默认 4)
  workerIdleTimeout?: number;   // Worker 空闲超时时间,毫秒 (默认 60000 = 1分钟)
  taskRetryLimit?: number;      // 任务重试次数 (默认 2)
  enableAutoCleanup?: boolean;  // 是否启用自动清理 (默认 true)
}

/**
 * Agent 管理器类
 */
export class AgentManager extends EventEmitter {
  private logger = mainLogger;
  private workers: Map<string, WorkerWrapper> = new Map();
  private taskQueue: AgentTask[] = [];
  private taskCallbacks: Map<string, TaskCallback[]> = new Map();
  private streamCallbacks: Map<string, StreamCallback[]> = new Map();  // 流式消息回调
  private sessionCallbacks: Map<string, SessionMessageCallback[]> = new Map();  // 会话消息回调
  private config: Required<AgentManagerConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: AgentManagerConfig = {}) {
    // 调用父类 EventEmitter 的构造函数
    super();

    this.config = {
      maxWorkers: config.maxWorkers ?? 4,
      workerIdleTimeout: config.workerIdleTimeout ?? 60000,
      taskRetryLimit: config.taskRetryLimit ?? 2,
      enableAutoCleanup: config.enableAutoCleanup ?? true
    };

    this.logger.info('Agent 管理器初始化', this.config);

    // 启动自动清理定时器
    if (this.config.enableAutoCleanup) {
      this.startCleanupTimer();
    }
  }

  /**
   * 启动管理器
   */
  async start() {
    this.logger.info('Agent 管理器启动');
  }

  /**
   * 停止管理器
   */
  async stop() {
    this.logger.info('Agent 管理器停止中...');

    // 停止清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 终止所有 Worker
    const terminatePromises = Array.from(this.workers.values()).map(wrapper => {
      return this.terminateWorker(wrapper.workerId);
    });

    await Promise.all(terminatePromises);

    this.logger.info('Agent 管理器已停止');
  }

  /**
   * 提交任务
   */
  async submitTask(
    task: AgentTask,
    callback?: TaskCallback
  ): Promise<string> {
    // 确保任务有 ID
    if (!task.id) {
      task.id = uuidv4();
    }

    // 设置初始状态
    task.status = TaskStatus.PENDING;
    task.createdAt = Date.now();

    this.logger.info('提交任务:', `${task.type}:${task.id.substring(0, 8)}`);

    // 注册回调
    if (callback) {
      this.registerCallback(task.id, callback);
    }

    // 添加到队列
    this.taskQueue.push(task);

    // 尝试分配任务
    this.assignTasks();

    return task.id;
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string) {
    this.logger.info('取消任务:', taskId.substring(0, 8));

    // 从队列中移除
    const queueIndex = this.taskQueue.findIndex(t => t.id === taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
      this.notifyCallbacks(taskId, TaskStatus.CANCELLED);
      return;
    }

    // 如果任务正在执行,通知对应的 Worker
    for (const wrapper of this.workers.values()) {
      if (wrapper.currentTaskId === taskId) {
        this.sendMessageToWorker(wrapper.workerId, {
          type: 'cancel',
          taskId
        });
        break;
      }
    }
  }

  /**
   * 注册任务状态回调
   */
  registerCallback(taskId: string, callback: TaskCallback) {
    if (!this.taskCallbacks.has(taskId)) {
      this.taskCallbacks.set(taskId, []);
    }
    this.taskCallbacks.get(taskId)!.push(callback);
  }

  /**
   * 注册流式消息回调
   */
  registerStreamCallback(taskId: string, callback: StreamCallback) {
    if (!this.streamCallbacks.has(taskId)) {
      this.streamCallbacks.set(taskId, []);
    }
    this.streamCallbacks.get(taskId)!.push(callback);
  }

  /**
   * 移除流式回调
   */
  unregisterStreamCallbacks(taskId: string) {
    this.streamCallbacks.delete(taskId);
  }

  /**
   * 创建新的 Worker
   */
  private async createWorker(): Promise<WorkerWrapper | null> {
    // 检查是否已达到最大数量
    if (this.workers.size >= this.config.maxWorkers) {
      this.logger.warn('已达到最大 Worker 数量:', this.config.maxWorkers);
      return null;
    }

    const workerId = `worker-${Date.now()}-${uuidv4().substring(0, 8)}`;
    // Worker 线程需要加载编译后的 JS 文件,而不是 TS 源文件
    // 在开发环境使用 .js 文件(已编译),在生产环境也使用 .js
    const workerPath = join(__dirname, 'agent-worker.js');

    this.logger.info('创建 Worker:', workerId);

    try {
      // 创建 Worker 实例
      // Worker 会自动继承主进程的 process.env (包括从 .env 加载的配置)
      // 设置 DOGEAR_CONFIG_DIR 供 Worker 中的 logger 使用（用顶部导入的 join/dirname）
      const configDir = app.isPackaged
        ? join(app.getPath('userData'), '.dogear')
        : join(process.cwd(), '.dogear');
      const worker = new Worker(workerPath, {
        env: { ...process.env, DOGEAR_CONFIG_DIR: configDir }
      });

      const wrapper: WorkerWrapper = {
        workerId,
        worker,
        messagePort: null,
        isReady: false,
        currentTaskId: null,
        lastActivity: Date.now(),
        createdAt: Date.now()
      };

      // 监听 Worker 消息
      worker.on('message', (message: WorkerToMainMessage) => {
        this.handleWorkerMessage(workerId, message);
      });

      // 监听 Worker 错误
      worker.on('error', (error) => {
        this.logger.error(`Worker ${workerId} 错误:`, error);
        this.handleWorkerError(workerId, error);
      });

      // 监听 Worker 退出
      worker.on('exit', (code) => {
        this.logger.info(`Worker ${workerId} 退出,代码:`, code);
        this.handleWorkerExit(workerId, code);
      });

      // 初始化 Worker
      this.workers.set(workerId, wrapper);

      // 获取工作区路径和共享配置所需的运行时上下文
      // 注：configDir 已在上方声明（用于 Worker env 的 DOGEAR_CONFIG_DIR），此处复用

      // 获取当前默认工作区路径（从 JSON 配置读取，不自动创建）
      let workspacePath: string;
      const workspaceJsonService = await import('../services/workspace-json-service.js');
      const defaultWorkspace = await workspaceJsonService.getDefault();

      if (!defaultWorkspace) {
        // 如果没有设置默认工作区，使用临时路径，Worker 会报错提示用户先选择工作区
        workspacePath = join(process.cwd(), '.temp-workspace');
        this.logger.warn('未设置默认工作区，Worker 可能无法正常工作');
      } else {
        workspacePath = defaultWorkspace.path;
      }

      this.sendMessageToWorker(workerId, {
        type: 'init',
        config: {
          workerId,
          workspacePath,
          configDir,
        }
      });

      return wrapper;
    } catch (error) {
      this.logger.error('创建 Worker 失败:', error);
      return null;
    }
  }

  /**
   * 终止 Worker
   */
  private async terminateWorker(workerId: string) {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      return;
    }

    this.logger.info('终止 Worker:', workerId);

    try {
      await wrapper.worker.terminate();
      this.workers.delete(workerId);
    } catch (error) {
      this.logger.error('终止 Worker 失败:', error);
    }
  }

  /**
   * 分配任务到 Worker
   */
  private assignTasks() {
    // 如果没有任务,直接返回
    if (this.taskQueue.length === 0) {
      return;
    }

    // 查找空闲的 Worker
    const idleWorkers = Array.from(this.workers.values()).filter(
      w => w.isReady && w.currentTaskId === null
    );

    // 如果没有空闲 Worker,尝试创建新的
    if (idleWorkers.length === 0 && this.workers.size < this.config.maxWorkers) {
      this.createWorker();
      return;
    }

    // 分配任务
    while (this.taskQueue.length > 0 && idleWorkers.length > 0) {
      const worker = idleWorkers.shift()!;
      const task = this.taskQueue.shift()!;

      this.assignTaskToWorker(worker, task);
    }
  }

  /**
   * 将任务分配给指定 Worker
   */
  private assignTaskToWorker(worker: WorkerWrapper, task: AgentTask) {
    this.logger.debug('分配任务到 Worker:', task.id.substring(0, 8), '->', worker.workerId);

    worker.currentTaskId = task.id;
    worker.lastActivity = Date.now();

    task.status = TaskStatus.IN_PROGRESS;
    task.updatedAt = Date.now();

    this.sendMessageToWorker(worker.workerId, {
      type: 'task',
      task
    });
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(workerId: string, message: WorkerToMainMessage) {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      this.logger.warn('收到未知 Worker 的消息:', workerId);
      return;
    }

    wrapper.lastActivity = Date.now();

    switch (message.type) {
      case 'ready':
        this.logger.debug(`Worker ${workerId} 就绪`);
        wrapper.isReady = true;
        // 尝试分配队列中的任务
        this.assignTasks();
        break;

      case 'taskUpdate':
        this.handleTaskUpdate(workerId, message);
        break;

      case 'taskStreamChunk':
        // 处理流式消息块
        this.handleStreamChunk(message.taskId, message.chunk);
        break;

      case 'taskStreamEnd':
        // 处理流式消息结束
        this.handleStreamEnd(message.taskId);
        break;

      case 'sessionMessage':
        // 处理会话消息
        this.handleSessionMessage(message.sessionId, message.message);
        break;

      case 'sessionStarted':
        // 处理会话启动
        this.logger.info('会话已启动:', message.sessionId.substring(0, 8));
        this.emit('sessionStarted', message.sessionId);
        break;

      case 'sessionClosed':
        // 处理会话关闭
        this.logger.info('会话已关闭:', message.sessionId.substring(0, 8));
        this.emit('sessionClosed', message.sessionId);
        break;

      case 'pong':
        // 心跳响应,更新活动时间
        break;

      case 'articleParseStatusChanged':
        // Phase 3: 文章解析状态变化，发射事件供 tipc 层订阅后广播到前端
        this.emit('articleParseStatusChanged', {
          articleId: message.articleId,
          workspacePath: message.workspacePath,
          parseStatus: message.parseStatus,
        });
        break;

      case 'error':
        this.logger.error(`Worker ${workerId} 报错:`, message.error);
        break;
    }
  }

  /**
   * 处理任务更新
   */
  private handleTaskUpdate(workerId: string, message: Extract<WorkerToMainMessage, { type: 'taskUpdate' }>) {
    const { taskId, status, result, error } = message;
    const wrapper = this.workers.get(workerId);

    this.logger.debug('任务更新:', taskId.substring(0, 8), status);

    // 更新 Worker 状态
    if (wrapper && wrapper.currentTaskId === taskId) {
      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED) {
        wrapper.currentTaskId = null;
        // 任务完成后,尝试分配下一个任务
        this.assignTasks();
      }
    }

    // 通知回调
    this.notifyCallbacks(taskId, status, result, error);
  }

  /**
   * 处理流式消息块
   */
  private handleStreamChunk(taskId: string, chunk: string) {
    const callbacks = this.streamCallbacks.get(taskId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(taskId, chunk);
        } catch (error) {
          this.logger.error('流式回调执行失败:', error);
        }
      });
    }
  }

  /**
   * 处理流式消息结束
   * 清理流式回调,但不清理任务回调 (任务回调会在 taskUpdate 时清理)
   */
  private handleStreamEnd(taskId: string) {
    this.logger.debug('流式消息结束:', taskId.substring(0, 8));
    // 流式结束后清理回调,避免内存泄漏
    this.streamCallbacks.delete(taskId);
  }

  /**
   * 处理会话消息
   */
  private handleSessionMessage(sessionId: string, message: string) {
    this.logger.debug('收到会话消息:', sessionId.substring(0, 8), message.substring(0, 50));

    // 触发事件
    this.emit('sessionMessage', sessionId, message);

    // 通知回调
    const callbacks = this.sessionCallbacks.get(sessionId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(sessionId, message);
        } catch (error) {
          this.logger.error('会话消息回调执行失败:', error);
        }
      });
    }
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(workerId: string, error: Error) {
    this.logger.error(`Worker ${workerId} 错误:`, error);

    // 如果有正在执行的任务,标记为失败
    const wrapper = this.workers.get(workerId);
    if (wrapper && wrapper.currentTaskId) {
      this.notifyCallbacks(
        wrapper.currentTaskId,
        TaskStatus.FAILED,
        undefined,
        `Worker 错误: ${error.message}`
      );
      wrapper.currentTaskId = null;
    }
  }

  /**
   * 处理 Worker 退出
   */
  private handleWorkerExit(workerId: string, code: number) {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      return;
    }

    // 如果有正在执行的任务,根据策略决定是否重试
    if (wrapper.currentTaskId) {
      const task = this.findTaskInHistory(wrapper.currentTaskId);
      if (task && (task.retryCount || 0) < this.config.taskRetryLimit) {
        // 重试任务
        this.logger.info('重试任务:', wrapper.currentTaskId);
        task.retryCount = (task.retryCount || 0) + 1;
        this.taskQueue.unshift(task);
        this.assignTasks();
      } else {
        // 标记为失败
        this.notifyCallbacks(
          wrapper.currentTaskId,
          TaskStatus.FAILED,
          undefined,
          'Worker 意外退出'
        );
      }
    }

    this.workers.delete(workerId);
  }

  /**
   * 发送消息给 Worker
   */
  private sendMessageToWorker(workerId: string, message: MainToWorkerMessage) {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      this.logger.warn('尝试发送消息给不存在的 Worker:', workerId);
      return;
    }

    wrapper.worker.postMessage(message);
  }

  /**
   * 通知所有注册的回调
   */
  private notifyCallbacks(taskId: string, status: TaskStatus, result?: any, error?: string) {
    const callbacks = this.taskCallbacks.get(taskId);
    if (!callbacks) {
      return;
    }

    callbacks.forEach(callback => {
      try {
        callback(taskId, status, result, error);
      } catch (error) {
        this.logger.error('任务回调执行失败:', error);
      }
    });

    // 如果任务已完成,清理回调和流式回调
    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED) {
      this.taskCallbacks.delete(taskId);
      this.streamCallbacks.delete(taskId);  // 同时清理流式回调
    }
  }

  /**
   * 查找任务历史中的任务
   */
  private findTaskInHistory(taskId: string): AgentTask | null {
    // TODO: 实现任务历史记录
    return null;
  }

  /**
   * 启动自动清理定时器
   */
  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleWorkers();
    }, 30000); // 每 30 秒检查一次
  }

  /**
   * 清理空闲的 Worker
   */
  private cleanupIdleWorkers() {
    const now = Date.now();
    const workersToRemove: string[] = [];

    for (const [workerId, wrapper] of this.workers) {
      // 空闲超过超时时间的 Worker 直接清理，不保留
      if (
        wrapper.currentTaskId === null &&
        wrapper.isReady &&
        now - wrapper.lastActivity > this.config.workerIdleTimeout
      ) {
        workersToRemove.push(workerId);
      }
    }

    // 终止空闲的 Worker
    workersToRemove.forEach(workerId => {
      this.logger.info('清理空闲 Worker:', workerId);
      this.terminateWorker(workerId);
    });
  }

  /**
   * 获取管理器状态
   */
  getStatus() {
    return {
      workers: this.workers.size,
      maxWorkers: this.config.maxWorkers,
      queuedTasks: this.taskQueue.length,
      activeTasks: Array.from(this.workers.values()).filter(w => w.currentTaskId !== null).length
    };
  }

  /**
   * 获取详细状态 (用于可视化监控)
   * 包含所有 Worker 的详细信息和任务队列信息
   */
  getDetailedStatus() {
    // 获取所有 Worker 的详细信息
    const workersDetails = Array.from(this.workers.values()).map(wrapper => ({
      workerId: wrapper.workerId,
      isReady: wrapper.isReady,
      currentTaskId: wrapper.currentTaskId,
      lastActivity: wrapper.lastActivity,
      createdAt: wrapper.createdAt,
      idleTime: wrapper.currentTaskId === null ? Date.now() - wrapper.lastActivity : 0
    }));

    // 获取任务队列中的任务信息
    const queuedTasksInfo = this.taskQueue.map(task => ({
      id: task.id,
      type: task.type,
      status: task.status,
      createdAt: task.createdAt
    }));

    return {
      config: {
        maxWorkers: this.config.maxWorkers,
        workerIdleTimeout: this.config.workerIdleTimeout,
        taskRetryLimit: this.config.taskRetryLimit
      },
      workers: workersDetails,
      queuedTasks: queuedTasksInfo,
      summary: {
        totalWorkers: this.workers.size,
        activeWorkers: workersDetails.filter(w => w.currentTaskId !== null).length,
        idleWorkers: workersDetails.filter(w => w.currentTaskId === null && w.isReady).length,
        queuedTasksCount: this.taskQueue.length
      }
    };
  }
}

// ==================== 单例实例 ====================

let agentManagerInstance: AgentManager | null = null;

/**
 * 获取 Agent 管理器单例
 */
export function getAgentManager(config?: AgentManagerConfig): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager(config);
  }
  return agentManagerInstance;
}

/**
 * 关闭 Agent 管理器
 */
export async function shutdownAgentManager() {
  if (agentManagerInstance) {
    await agentManagerInstance.stop();
    agentManagerInstance = null;
  }
}
