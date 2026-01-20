/**
 * Agent Worker 进程
 * 独立运行的后台进程,使用 Claude Agent SDK 处理 AI 任务
 *
 * 功能:
 * - 接收来自主进程的任务
 * - 使用 Claude Agent SDK 处理任务
 * - 支持持续对话会话模式
 * - 通过 MessagePort 返回结果
 */

import { parentPort } from 'worker_threads';
import {
  MainToWorkerMessage,
  WorkerToMainMessage,
  AgentTask,
  TaskType,
  TaskStatus,
  AgentWorkerConfig,
  ChatSessionPayload,
} from './task-types.js';
import { workerLogger, createTaskLogger } from './logger.js';
import {
  ChatSession,
  ChatSessionManager,
  ChatSessionConfig,
  type UserMessage,
  type ChatContext,
} from './skills/chat-skill.js';

/**
 * Agent Worker 类
 */
class AgentWorker {
  private workerId: string;
  private currentTask: AgentTask | null = null;
  private messagePort: any = null;
  private isReady = false;
  private logger = workerLogger;
  private enableStreaming: boolean = true;  // 是否启用流式输出

  // 会话管理
  private sessionManager = new ChatSessionManager();
  private sessions: Map<string, ChatSession> = new Map();

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

    // 会话任务可以并行处理（每个会话独立）
    // 普通任务需要串行处理
    if (task.type !== TaskType.CHAT_SESSION && this.currentTask) {
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
        case TaskType.CHAT_SESSION:
          // 会话任务不阻塞 Worker，可以立即返回
          this.handleChatSessionTask(task, taskLogger);
          return;  // 提前返回，不发送完成状态

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
      this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, result);

    } catch (error) {
      this.currentTask = null;
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('任务失败:', errorMsg);
      this.sendTaskError(task.id, errorMsg);
    }
  }

  /**
   * 处理持续对话会话任务
   *
   * 这是核心方法：会话任务启动后会持续运行，直到被显式关闭
   */
  private async handleChatSessionTask(task: AgentTask, taskLogger: any) {
    const payload = task.payload as ChatSessionPayload;

    taskLogger.debug('处理会话任务,操作:', payload.action, '会话ID:', payload.sessionId?.substring(0, 8));

    try {
      switch (payload.action) {
        case 'start':
          await this.startChatSession(task, taskLogger);
          break;

        case 'message':
          await this.sendSessionMessage(task, taskLogger);
          break;

        case 'close':
          await this.closeChatSession(task, taskLogger);
          break;

        default:
          this.sendTaskError(task.id, `未知的会话操作: ${payload.action}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('会话任务执行失败:', errorMsg);
      this.sendTaskError(task.id, errorMsg);
    }
  }

  /**
   * 启动新的聊天会话
   */
  private async startChatSession(task: AgentTask, taskLogger: any) {
    const payload = task.payload as ChatSessionPayload;
    const context: ChatContext = payload.context || {};

    taskLogger.info('启动新的聊天会话,上下文:', context);

    // 创建会话配置
    const config: ChatSessionConfig = {
      context,
      onMessage: (message: string) => {
        // 当收到 AI 响应时，发送到主进程
        this.sendMessage({
          type: 'sessionMessage',
          sessionId: task.id,
          message
        });
      },
      onError: (error: string) => {
        taskLogger.error('会话错误:', error);
        this.sendTaskError(task.id, error);
      },
      onComplete: (sessionId: string) => {
        taskLogger.info('会话完成:', sessionId.substring(0, 8));
      }
    };

    // 创建并启动会话
    const session = this.sessionManager.createSession(task.id, config);

    // 注册会话事件
    session.on('message', (message: string) => {
      this.sendMessage({
        type: 'sessionMessage',
        sessionId: task.id,
        message
      });
    });

    session.on('complete', () => {
      // 单次对话完成，但会话继续保持
    });

    session.on('error', (error: string) => {
      this.sendTaskError(task.id, error);
    });

    // 启动会话（创建 query 异步生成器）
    await session.start();

    // 保存会话
    this.sessions.set(task.id, session);

    // 通知主进程会话已启动
    this.sendMessage({
      type: 'sessionStarted',
      sessionId: task.id
    });

    // 标记任务为完成（会话已创建，后续消息通过 sendSessionMessage 发送）
    this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, {
      sessionId: task.id,
      action: 'started'
    });

    taskLogger.info('聊天会话已启动:', task.id);
  }

  /**
   * 向现有会话发送消息
   */
  private async sendSessionMessage(task: AgentTask, taskLogger: any) {
    const payload = task.payload as ChatSessionPayload;
    const sessionId = payload.sessionId!;

    taskLogger.info('向会话发送消息:', sessionId.substring(0, 8));

    // 查找会话
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 发送消息到会话
    if (payload.message) {
      await session.sendMessage(payload.message as UserMessage);
    }

    // 标记任务为完成
    this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, {
      sessionId,
      action: 'message_sent'
    });
  }

  /**
   * 关闭聊天会话
   */
  private async closeChatSession(task: AgentTask, taskLogger: any) {
    const payload = task.payload as ChatSessionPayload;
    const sessionId = payload.sessionId!;

    taskLogger.info('关闭聊天会话:', sessionId.substring(0, 8));

    // 关闭会话
    await this.sessionManager.closeSession(sessionId);

    // 从本地 map 移除
    this.sessions.delete(sessionId);

    // 通知主进程会话已关闭
    this.sendMessage({
      type: 'sessionClosed',
      sessionId
    });

    // 标记任务为完成
    this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, {
      sessionId,
      action: 'closed'
    });

    taskLogger.info('聊天会话已关闭:', sessionId.substring(0, 8));
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
   * 发送流式消息块
   */
  private sendStreamChunk(taskId: string, chunk: string) {
    this.sendMessage({
      type: 'taskStreamChunk',
      taskId,
      chunk
    });
  }

  /**
   * 发送流式消息结束信号
   */
  private sendStreamEnd(taskId: string) {
    this.sendMessage({
      type: 'taskStreamEnd',
      taskId
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
  async cleanup() {
    this.logger.info('清理 Worker 资源');

    // 关闭所有会话
    await this.sessionManager.closeAll();
    this.sessions.clear();

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
  parentPort.on('close', async () => {
    workerLogger.info('主进程关闭连接');
    if (agentWorker) {
      await agentWorker.cleanup();
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
