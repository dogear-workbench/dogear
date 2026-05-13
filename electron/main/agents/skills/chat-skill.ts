/**
 * 对话 Skill
 * 提供基础的对话功能
 *
 * 这是 Agent Worker 中使用的对话 Skill
 * 使用 @anthropic-ai/claude-agent-sdk 的 query 函数与 Claude 交互
 *
 * 核心概念：
 * - 使用 query 的异步生成器创建一个持续会话
 * - 通过 query.streamInput() 方法持续发送新消息
 * - 会话期间保持同一个 query 实例，确保 session 连贯
 */

import { createTaskLogger } from '../logger.js';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

/**
 * 对话上下文
 */
export interface ChatContext {
  selectedText?: string;
}

/**
 * 用户消息
 */
export interface UserMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * 会话配置
 */
export interface ChatSessionConfig {
  systemPrompt?: string;
  context?: ChatContext;
  chapterContent?: string;  // 章节内容，用于书籍问答场景
  onMessage?: (message: string) => void;
  onError?: (error: string) => void;
  onComplete?: (sessionId: string) => void;
  // v2: MCP Server 配置（用于调试窗口分析功能）
  mcpServers?: Record<string, any>;
  // v2: 允许的工具列表
  allowedTools?: string[];
  // v2: 额外允许访问的目录
  additionalDirectories?: string[];
}

/**
 * 会话状态
 */
export enum SessionStatus {
  IDLE = 'idle',           // 空闲，等待消息
  PROCESSING = 'processing', // 处理中
  CLOSED = 'closed'         // 已关闭
}

/**
 * 持续对话会话类
 *
 * 核心思想：一个会话对应一个持续的 query 异步生成器
 * 通过 streamInput 方法持续发送新消息到同一个会话
 */
export class ChatSession extends EventEmitter {
  private query: Query | null = null;
  private sessionId: string;
  private status: SessionStatus = SessionStatus.IDLE;
  private logger: any;
  private config: ChatSessionConfig;
  private isProcessing: boolean = false;
  private isStarted: boolean = false;
  // 消息通道：用于向迭代器推送新消息
  private messageResolvers: Array<(msg: SDKUserMessage | null) => void> = [];
  private pendingMessages: SDKUserMessage[] = [];
  private messageQueue: UserMessage[] = [];

  constructor(sessionId: string, config: ChatSessionConfig = {}) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.logger = createTaskLogger(`chat-session-${sessionId.substring(0, 8)}`);
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取会话状态
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * 启动会话
   * 创建持续的消息流迭代器和 query
   */
  async start(): Promise<void> {
    if (this.query) {
      this.logger.warn('会话已经启动');
      return;
    }

    this.logger.info('启动聊天会话:', this.sessionId);

    // 创建系统提示词
    const systemPrompt = this.buildSystemPrompt();

    // 创建持续的消息流
    const messageStream = this.createMessageStream();

    // 构建 query 配置
    const queryOptions: Record<string, any> = {
      systemPrompt,
    };

    // 添加 MCP Servers（如果配置了）
    if (this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0) {
      queryOptions.mcpServers = this.config.mcpServers;
      this.logger.info('已配置 MCP Servers:', Object.keys(this.config.mcpServers));
    }

    // 添加允许的工具列表（如果配置了）
    if (this.config.allowedTools) {
      queryOptions.allowedTools = this.config.allowedTools;
      this.logger.info('已配置允许的工具:', this.config.allowedTools);
    }

    // 添加额外目录（如果配置了）
    if (this.config.additionalDirectories) {
      queryOptions.additionalDirectories = this.config.additionalDirectories;
      this.logger.info('已配置额外目录:', this.config.additionalDirectories);
    }

    // 创建 query
    this.query = query({
      prompt: messageStream,
      options: queryOptions
    });

    // 启动消息处理循环
    this.processMessageLoop();

    this.logger.info('聊天会话已启动');
  }

  /**
   * 发送用户消息到会话
   * 将消息推入异步迭代器通道
   */
  async sendMessage(message: UserMessage): Promise<void> {
    if (this.status === SessionStatus.CLOSED) {
      throw new Error('会话已关闭，无法发送消息');
    }

    this.logger.info('发送消息到会话:', message.content.substring(0, 50));

    const sdkMessage = this.createSDKUserMessage(message);

    // 如果有等待中的 resolver，立即解析
    if (this.messageResolvers.length > 0) {
      const resolve = this.messageResolvers.shift()!;
      resolve(sdkMessage);
    } else {
      // 否则加入待处理队列
      this.pendingMessages.push(sdkMessage);
    }

    this.status = SessionStatus.PROCESSING;
  }

  /**
   * 处理消息循环
   * 持续监听 query 的响应
   */
  private async processMessageLoop(): Promise<void> {
    if (!this.query) {
      return;
    }

    this.logger.info('启动消息处理循环');

    try {
      for await (const message of this.query) {
        // 处理不同类型的消息
        if (message.type === 'assistant') {
          // 助手响应
          const content = this.extractContent(message.message.content);
          if (content) {
            // 触发消息事件
            this.emit('message', content);
            if (this.config.onMessage) {
              this.config.onMessage(content);
            }
          }
        } else if (message.type === 'result') {
          // 结果消息
          if (message.subtype === 'success') {
            this.logger.info('消息处理完成');
            this.status = SessionStatus.IDLE;
            if (this.config.onComplete) {
              this.config.onComplete(this.sessionId);
            }
            this.emit('complete', this.sessionId);
          } else {
            // 错误
            const errorMsg = message.errors?.join(', ') || '未知错误';
            this.logger.error('对话错误:', errorMsg);
            this.status = SessionStatus.IDLE;
            if (this.config.onError) {
              this.config.onError(errorMsg);
            }
            this.emit('error', errorMsg);
          }
        } else if (message.type === 'stream_event') {
          // 流式事件
          const content = this.extractStreamContent(message.event);
          if (content) {
            this.emit('chunk', content);
          }
        }
      }
    } catch (error) {
      this.logger.error('消息处理循环错误:', error);
      this.emit('error', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 创建持续的消息流迭代器
   * 这个迭代器会持续等待新消息，直到会话关闭
   */
  private async *createMessageStream(): AsyncGenerator<SDKUserMessage> {
    this.logger.info('创建持续消息流');

    while (this.status !== SessionStatus.CLOSED) {
      // 如果有待处理的消息，立即返回
      if (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift()!;
        this.logger.info('从队列中取出消息');
        yield msg;
        continue;
      }

      // 否则等待新消息
      const msg = await new Promise<SDKUserMessage | null>((resolve) => {
        this.messageResolvers.push(resolve);
      });

      if (msg === null) {
        // null 表示会话关闭
        this.logger.info('消息流结束');
        break;
      }

      this.logger.info('收到新消息，产生到迭代器');
      yield msg;
    }
  }

  /**
   * 创建 SDK 用户消息
   */
  private createSDKUserMessage(message: UserMessage): SDKUserMessage {
    return {
      type: 'user',
      message: {
        role: 'user',
        content: message.content
      },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    };
  }

  /**
   * 提取消息内容
   */
  private extractContent(content: string | unknown[]): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map(block => {
          if (typeof block === 'string') return block;
          if (block && typeof block === 'object' && 'text' in block) {
            return String(block.text);
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  /**
   * 提取流式内容
   */
  private extractStreamContent(event: any): string | null {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text;
    }
    return null;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const { context, chapterContent } = this.config;

    // 如果有章节内容，构建基于书籍内容的系统提示词
    if (chapterContent) {
      // 限制内容长度，避免超过 token 限制
      const maxContentLength = 15000;  // 约 4000-5000 tokens
      const trimmedContent = chapterContent.length > maxContentLength
        ? chapterContent.substring(0, maxContentLength) + '\n...(内容已截断)'
        : chapterContent;

      return `你是一个帮助用户阅读和分析电子书的 AI 助手。

当前正在阅读的章节内容如下：
---
${trimmedContent}
---

请基于上述章节内容回答用户的问题。回答时：
1. 直接引用章节中的内容来支持你的回答
2. 如果问题涉及章节中没有的内容，请明确说明
3. 可以对章节内容进行总结、解释或分析
4. 用简洁清晰的语言回答`;
    }

    // 没有章节内容时的通用提示词
    if (!context) {
      return '你是一个帮助用户阅读和分析电子书的 AI 助手。';
    }

    const contextInfo = [];
    if (context.selectedText) contextInfo.push(`选中文本: ${context.selectedText}`);

    return `你是一个 AI 个人助手。${contextInfo.length > 0 ? `\n\n当前上下文:\n${contextInfo.join('\n')}` : ''}`;
}

/**
 * 关闭会话
 */
async close(): Promise<void> {
  this.logger.info('关闭会话:', this.sessionId);
  this.status = SessionStatus.CLOSED;

  // 通知消息流迭代器结束
  while (this.messageResolvers.length > 0) {
    const resolve = this.messageResolvers.shift()!;
    resolve(null);
  }

  this.pendingMessages = [];

  // 触发关闭事件
  this.emit('closed');

  // 移除所有监听器
  this.removeAllListeners();
}

}

/**
 * 会话管理器
 * 管理多个 ChatSession 实例
 */
export class ChatSessionManager {
  private sessions: Map<string, ChatSession> = new Map();
  private logger = createTaskLogger('chat-session-manager');

  /**
   * 创建新会话
   */
  createSession(sessionId?: string, config?: ChatSessionConfig): ChatSession {
    const id = sessionId || randomUUID();
    this.logger.info('创建新会话:', id.substring(0, 8));

    const session = new ChatSession(id, config);
    this.sessions.set(id, session);

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 关闭会话
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
      this.logger.info('会话已关闭:', sessionId.substring(0, 8));
    }
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    this.logger.info('关闭所有会话...');
    const promises = Array.from(this.sessions.values()).map(s => s.close());
    await Promise.all(promises);
    this.sessions.clear();
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取活跃会话数量
   */
  getActiveCount(): number {
    return this.sessions.size;
  }
}