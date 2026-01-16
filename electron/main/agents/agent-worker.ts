/**
 * Agent Worker 进程
 * 独立运行的后台进程,使用 Claude Agent SDK 处理 AI 任务
 *
 * 功能:
 * - 接收来自主进程的任务
 * - 使用 Claude Agent SDK 处理任务
 * - 可以启动子 Agent 处理细分任务
 * - 通过 MessagePort 返回结果
 */

import { parentPort } from 'worker_threads';
import {
  MainToWorkerMessage,
  WorkerToMainMessage,
  AgentTask,
  TaskType,
  TaskStatus,
  AgentWorkerConfig
} from './task-types.js';
import { workerLogger, createTaskLogger } from './logger.js';

/**
 * Agent Worker 类
 */
class AgentWorker {
  private workerId: string;
  private currentTask: AgentTask | null = null;
  private messagePort: any = null;
  private isReady = false;
  private logger = workerLogger;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.logger = this.logger.child(workerId);
  }

  /**
   * 初始化 Worker
   */
  async init(config: AgentWorkerConfig) {
    this.workerId = config.workerId;
    this.messagePort = config.messagePort || null;

    this.logger.info('正在初始化 Agent Worker...');

    try {
      // TODO: 初始化 Claude Agent SDK
      // SDK 会自动从环境变量读取 ANTHROPIC_API_KEY
      // const sdk = await import('@anthropic-ai/claude-agent-sdk');
      // this.anthropic = sdk.anthropic;

      this.isReady = true;
      this.sendMessage({
        type: 'ready',
        workerId: this.workerId
      });

      this.logger.info('Agent Worker 初始化成功');
    } catch (error) {
      this.logger.error('初始化失败:', error);
      this.sendMessage({
        type: 'error',
        error: `初始化失败: ${error}`
      });
    }
  }

  /**
   * 处理新任务
   */
  async handleTask(task: AgentTask) {
    if (!this.isReady) {
      this.logger.error('Worker 未就绪,拒绝任务:', task.id);
      this.sendTaskError(task.id, 'Worker 未就绪');
      return;
    }

    if (this.currentTask) {
      this.logger.warn('Worker 正在忙,拒绝任务:', task.id);
      this.sendTaskError(task.id, 'Worker 正在忙,请稍后再试');
      return;
    }

    this.currentTask = task;
    const taskLogger = createTaskLogger(task.id);
    taskLogger.info(`开始处理任务: ${task.type}`);

    this.sendTaskUpdate(task.id, TaskStatus.IN_PROGRESS);

    try {
      let result: any;

      // 根据任务类型分发处理
      switch (task.type) {
        case TaskType.CHAT:
          result = await this.handleChatTask(task, taskLogger);
          break;

        case TaskType.SUMMARIZE:
          result = await this.handleSummarizeTask(task, taskLogger);
          break;

        case TaskType.ANALYZE_BOOK:
          result = await this.handleAnalyzeBookTask(task, taskLogger);
          break;

        case TaskType.READING_ASSIST:
          result = await this.handleReadingAssistTask(task, taskLogger);
          break;

        default:
          throw new Error(`未知任务类型: ${task.type}`);
      }

      // 任务完成
      this.currentTask = null;
      taskLogger.info('任务完成');
      this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, { result });

    } catch (error) {
      this.currentTask = null;
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('任务失败:', errorMsg);
      this.sendTaskError(task.id, errorMsg);
    }
  }

  /**
   * 处理 AI 对话任务
   */
  private async handleChatTask(task: AgentTask, taskLogger: any): Promise<string> {
    const payload = task.payload;

    taskLogger.debug('处理对话任务,消息数量:', payload.messages?.length);

    // TODO: 集成 Claude Agent SDK 的对话功能
    // 现在先返回一个模拟响应用于测试
    await this.delay(1000); // 模拟处理时间

    const lastMessage = payload.messages[payload.messages.length - 1]?.content || '';
    return `这是对消息的模拟响应: "${lastMessage}"`;
  }

  /**
   * 处理文本摘要任务
   */
  private async handleSummarizeTask(task: AgentTask, taskLogger: any): Promise<string> {
    const payload = task.payload;

    taskLogger.debug('处理摘要任务,文本长度:', payload.text?.length);

    // TODO: 集成实际的摘要功能
    await this.delay(1500);

    const preview = payload.text?.substring(0, 50) || '';
    return `[摘要] ${preview}... (完整摘要待实现)`;
  }

  /**
   * 处理书籍分析任务
   */
  private async handleAnalyzeBookTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload;

    taskLogger.info('处理书籍分析任务:', payload.bookId);

    // TODO: 这里可以启动子 Agent 进行更细粒度的分析
    // 例如使用 SDK 的 Task 工具启动多个并行的分析任务
    // await this.sdk.task.create({ ... });

    await this.delay(2000);

    return {
      bookId: payload.bookId,
      summary: '这是一本关于...的书籍',
      keywords: ['关键词1', '关键词2', '关键词3'],
      structure: '书籍结构分析...'
    };
  }

  /**
   * 处理阅读辅助任务
   */
  private async handleReadingAssistTask(task: AgentTask, taskLogger: any): Promise<string> {
    const payload = task.payload;

    taskLogger.debug('处理阅读辅助任务:', payload.action);

    await this.delay(800);

    switch (payload.action) {
      case 'explain':
        return `解释: "${payload.text}" 的意思是...`;
      case 'translate':
        return `翻译: "${payload.text}" 的英文翻译是...`;
      case 'expand':
        return `扩展: 关于 "${payload.text}" 的更多信息...`;
      default:
        return '未知的辅助操作';
    }
  }

  /**
   * 发送消息给主进程
   */
  private sendMessage(message: WorkerToMainMessage) {
    if (this.messagePort) {
      this.messagePort.postMessage(message);
    } else if (parentPort) {
      parentPort.postMessage(message);
    } else {
      this.logger.error('没有可用的通信端口');
    }
  }

  /**
   * 发送任务状态更新
   */
  private sendTaskUpdate(taskId: string, status: TaskStatus, result?: any, error?: string) {
    this.sendMessage({
      type: 'taskUpdate',
      taskId,
      status,
      result,
      error
    });
  }

  /**
   * 发送任务错误
   */
  private sendTaskError(taskId: string, error: string) {
    this.sendTaskUpdate(taskId, TaskStatus.FAILED, undefined, error);
  }

  /**
   * 延迟辅助函数 (用于模拟异步操作)
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 取消当前任务
   */
  cancelTask(taskId: string) {
    if (this.currentTask && this.currentTask.id === taskId) {
      this.logger.info('取消任务:', taskId);
      this.sendTaskUpdate(taskId, TaskStatus.CANCELLED);
      this.currentTask = null;
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.logger.info('清理 Worker 资源');
    this.isReady = false;
    this.currentTask = null;
    this.messagePort = null;
  }
}

// ==================== Worker 入口 ====================

let agentWorker: AgentWorker | null = null;

// 监听主进程消息
if (parentPort) {
  parentPort.on('message', (message: MainToWorkerMessage) => {
    const logger = workerLogger.child('main');

    logger.debug('收到消息:', message.type);

    switch (message.type) {
      case 'init':
        // 创建 Agent Worker 实例并初始化
        if (!agentWorker) {
          logger.info('创建新的 Agent Worker 实例');
          agentWorker = new AgentWorker(message.config.workerId);
        }
        agentWorker.init(message.config);
        break;

      case 'task':
        // 处理任务
        if (agentWorker) {
          agentWorker.handleTask(message.task);
        } else {
          logger.error('Worker 未初始化,无法处理任务');
        }
        break;

      case 'cancel':
        // 取消任务
        if (agentWorker) {
          agentWorker.cancelTask(message.taskId);
        }
        break;

      case 'ping':
        // 心跳检测
        if (agentWorker) {
          agentWorker['sendMessage']({ type: 'pong' });
        }
        break;
    }
  });

  // 监听进程退出信号
  parentPort.on('close', () => {
    workerLogger.info('主进程关闭连接');
    if (agentWorker) {
      agentWorker.cleanup();
      agentWorker = null;
    }
  });

  // Worker 启动时的初始化消息
  parentPort.postMessage({
    type: 'ready',
    workerId: 'initializing'
  } as WorkerToMainMessage);
}

export { AgentWorker };
