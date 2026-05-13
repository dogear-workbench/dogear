/**
 * 主进程会话管理器
 * 使用 Claude Agent SDK 的 v2 API 在主进程中直接创建和管理会话
 *
 * 与 Worker 方案的区别：
 * - 会话直接在主进程中运行，生命周期与程序相同
 * - 不受 Worker 管理器清理影响
 * - 可以接收完整的 SDK 消息流（包括工具调用、思考过程等）
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import {
  unstable_v2_createSession,
  type SDKSession,
  type SDKMessage,
  type SDKSessionOptions
} from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { mainLogger } from './logger.js';
import type { ExtendedSessionMessage } from './task-types.js';

// 重新导出，保持现有导入路径兼容
export type { ExtendedSessionMessage };

/**
 * 会话上下文
 */
export interface SessionContext {
  selectedText?: string;
}

/**
 * 会话配置
 */
export interface MainProcessSessionConfig {
  model?: string;                    // 模型名称
  allowedTools?: string[];           // 允许的工具列表
  mcpServers?: Record<string, any>;  // MCP Server 配置
  systemPrompt?: string;             // 系统提示词
  context?: SessionContext;          // 上下文信息
  workspacePath?: string;            // 工作区路径
  // Skill 配置
  enableSkills?: boolean;            // 是否启用 Skill 功能（默认 false）
  skillsCwd?: string;                // Skill 工作目录（.claude/skills 所在路径）
}

/**
 * 主进程会话类
 * 包装 SDK 的 SDKSession，提供更高级的抽象
 */
export class MainProcessSession extends EventEmitter {
  private sessionId: string;
  private sdkSession: SDKSession | null = null;
  private logger = mainLogger;
  private config: MainProcessSessionConfig;
  private isActive = false;

  constructor(sessionId: string, config: MainProcessSessionConfig) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.logger = this.logger.child(`session-${sessionId.substring(0, 8)}`);
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 启动会话
   */
  async start(): Promise<void> {
    if (this.isActive) {
      this.logger.warn('会话已经启动');
      return;
    }

    this.logger.info('启动主进程会话:', this.sessionId);

    try {
      // 构建系统提示词
      const systemPrompt = this.buildSystemPrompt();

      // 构建工具列表：如果启用 Skill，确保包含 'Skill' 工具
      let allowedTools = this.config.allowedTools || ['Read', 'Glob', 'Grep'];
      if (this.config.enableSkills && !allowedTools.includes('Skill')) {
        allowedTools = [...allowedTools, 'Skill'];
        this.logger.info('Skill 功能已启用，已添加 Skill 工具');
      }

      // 创建 SDK 会话配置（基于 SDKSessionOptions 类型）
      const sessionConfig: SDKSessionOptions = {
        model: this.config.model || 'claude-sonnet-4-5-20250929',
        allowedTools,
      };

      // 注意：mcpServers 和 skillsCwd 不在 SDKSessionOptions 类型中
      // 如果需要使用这些功能，需要通过其他方式配置
      // 例如：通过环境变量或全局设置

      this.sdkSession = unstable_v2_createSession(sessionConfig);

      this.isActive = true;
      this.logger.info('主进程会话已启动');

      // 启动消息处理循环
      this.processMessages();
    } catch (error) {
      this.logger.error('启动会话失败:', error);
      this.emit('error', {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      } as ExtendedSessionMessage);
      throw error;
    }
  }

  /**
   * 发送消息到会话
   */
  async sendMessage(content: string): Promise<void> {
    if (!this.sdkSession) {
      throw new Error('会话未启动');
    }

    this.logger.info('发送消息到会话:', content.substring(0, 50));

    try {
      await this.sdkSession.send(content);
    } catch (error) {
      this.logger.error('发送消息失败:', error);
      throw error;
    }
  }

  /**
   * 处理来自 SDK 的消息流
   */
  private async processMessages(): Promise<void> {
    if (!this.sdkSession) {
      return;
    }

    this.logger.info('开始处理消息流');

    try {
      for await (const message of this.sdkSession.stream()) {
        this.logger.debug('收到 SDK 消息:', message.type);

        // 转换 SDK 消息为扩展消息格式
        const extendedMessage = this.convertSDKMessage(message);
        if (extendedMessage) {
          this.emit('message', extendedMessage);
        }

        // 处理结果消息（会话结束）
        if (message.type === 'result') {
          this.logger.info('收到结果消息,子类型:', message.subtype);
          if (message.subtype === 'success') {
            this.emit('complete', message);
          } else {
            this.emit('error', {
              type: 'error',
              error: message.errors?.join(', ') || '未知错误',
              timestamp: Date.now()
            } as ExtendedSessionMessage);
          }
        }
      }
    } catch (error) {
      this.logger.error('消息处理循环错误:', error);
      this.emit('error', {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      } as ExtendedSessionMessage);
    }
  }

  /**
   * 转换 SDK 消息为扩展消息格式
   */
  private convertSDKMessage(sdkMessage: SDKMessage): ExtendedSessionMessage | null {
    const timestamp = Date.now();

    switch (sdkMessage.type) {
      case 'assistant': {
        // 助手消息，包含文本和工具调用
        const message: ExtendedSessionMessage = {
          type: 'text',
          content: '',
          timestamp
        };

        const content = sdkMessage.message.content;
        if (typeof content === 'string') {
          message.content = content;
        } else if (Array.isArray(content)) {
          // 处理内容块数组
          const textBlocks: string[] = [];
          for (const block of content) {
            if (typeof block === 'string') {
              textBlocks.push(block);
            } else if (block && typeof block === 'object') {
              if (block.type === 'text') {
                textBlocks.push(block.text);
              } else if (block.type === 'tool_use') {
                // 工具调用
                this.emit('tool_use', {
                  type: 'tool_use',
                  toolName: block.name,
                  toolInput: block.input,
                  toolUseId: block.id,
                  timestamp
                } as ExtendedSessionMessage);
              }
            }
          }
          message.content = textBlocks.join('');
        }

        return message;
      }

      case 'stream_event': {
        // 流式事件
        const event = sdkMessage.event;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          return {
            type: 'text',
            content: event.delta.text,
            timestamp
          };
        }
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block?.type === 'tool_use') {
            return {
              type: 'tool_use',
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
              timestamp
            };
          }
        }
        return null;
      }

      case 'tool_progress': {
        // 工具执行进度
        return {
          type: 'status',
          status: `正在执行工具: ${sdkMessage.tool_name}`,
          toolName: sdkMessage.tool_name,
          toolUseId: sdkMessage.tool_use_id,
          timestamp
        };
      }

      case 'system': {
        // 系统消息
        return {
          type: 'status',
          status: sdkMessage.subtype,
          timestamp
        };
      }

      default:
        return null;
    }
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const { context } = this.config;

    if (!context?.selectedText) {
      return '你是一个 AI 个人助手。';
    }

    return `你是一个 AI 个人助手。

当前上下文:
选中文本: ${context.selectedText}

请根据上述上下文提供有针对性的帮助。`;
  }

  /**
   * 关闭会话
   */
  close(): void {
    this.logger.info('关闭会话:', this.sessionId);

    if (this.sdkSession) {
      this.sdkSession.close();
      this.sdkSession = null;
    }

    this.isActive = false;

    // 移除所有监听器
    this.removeAllListeners();
  }

  /**
   * 检查会话是否活跃
   */
  isSessionActive(): boolean {
    return this.isActive;
  }
}

/**
 * 主进程会话管理器
 * 管理多个主进程会话
 */
export class MainProcessSessionManager extends EventEmitter {
  private sessions: Map<string, MainProcessSession> = new Map();
  private logger = mainLogger.child('main-session-manager');

  /**
   * 创建新会话
   */
  createSession(config: MainProcessSessionConfig): MainProcessSession {
    const sessionId = uuidv4();
    this.logger.info('创建主进程会话:', sessionId.substring(0, 8));

    const session = new MainProcessSession(sessionId, config);

    // 转发会话事件
    session.on('message', (message) => {
      this.emit('sessionMessage', sessionId, message);
    });

    session.on('tool_use', (message) => {
      this.emit('sessionMessage', sessionId, message);
    });

    session.on('error', (message) => {
      this.emit('sessionError', sessionId, message);
    });

    session.on('complete', (result) => {
      this.emit('sessionComplete', sessionId, result);
    });

    this.sessions.set(sessionId, session);

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): MainProcessSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 关闭会话
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.close();
      this.sessions.delete(sessionId);
      this.logger.info('主进程会话已关闭:', sessionId.substring(0, 8));
    }
  }

  /**
   * 关闭所有会话
   */
  closeAll(): void {
    this.logger.info('关闭所有主进程会话...');
    this.sessions.forEach(session => session.close());
    this.sessions.clear();
  }

  /**
   * 获取活跃会话数量
   */
  getActiveCount(): number {
    return this.sessions.size;
  }
}

// ==================== 单例实例 ====================

let mainProcessSessionManagerInstance: MainProcessSessionManager | null = null;

/**
 * 获取主进程会话管理器单例
 */
export function getMainProcessSessionManager(): MainProcessSessionManager {
  if (!mainProcessSessionManagerInstance) {
    mainProcessSessionManagerInstance = new MainProcessSessionManager();
  }
  return mainProcessSessionManagerInstance;
}

/**
 * 关闭主进程会话管理器
 */
export function shutdownMainProcessSessionManager(): void {
  if (mainProcessSessionManagerInstance) {
    mainProcessSessionManagerInstance.closeAll();
    mainProcessSessionManagerInstance = null;
  }
}