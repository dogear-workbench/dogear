/**
 * 基于 Query 的会话实现
 * 使用 Claude Agent SDK 的 query 函数创建持续会话
 *
 * 与 unstable_v2_createSession 的区别：
 * - query 更灵活，支持更多配置选项
 * - 可以设置 cwd（工作目录）来加载项目中的 Skills
 * - 可以通过 settingSources 控制加载哪些设置源
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage, SDKMessage, SDKUserMessageReplay } from '@anthropic-ai/claude-agent-sdk';
import { mainLogger } from './logger.js';
import path from 'path';

/**
 * 会话上下文
 */
export interface SessionContext {
  bookId?: string;
  chapterId?: string;
  selectedText?: string;
}

/**
 * 会话配置
 */
export interface QueryBasedSessionConfig {
  model?: string;                    // 模型名称
  allowedTools?: string[];           // 允许的工具列表
  mcpServers?: Record<string, any>;  // MCP Server 配置
  systemPrompt?: string;             // 系统提示词
  context?: SessionContext;          // 上下文信息
  workspacePath?: string;            // 工作区路径
  // Skill 配置
  enableSkills?: boolean;            // 是否启用 Skill 功能（默认 false）
  projectRoot?: string;              // 项目根目录（用于查找 .claude/skills/）
  resume?: string;                   // SDK session_id（用于恢复会话）
}

/**
 * 扩展的消息类型，用于向前端传递更丰富的信息
 */
export interface ExtendedSessionMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: string;
  error?: string;
  timestamp: number;
  // 引用信息（用于书籍问答）
  citations?: any[];
  // 是否为重放的历史消息（resume 时使用）
  isReplay?: boolean;
  // 消息 UUID（SDK 提供）
  uuid?: string;
}

/**
 * 会话状态
 */
enum SessionStatus {
  IDLE = 'idle',
  PROCESSING = 'processing',
  CLOSED = 'closed'
}

/**
 * 基于 Query 的会话类
 */
export class QueryBasedSession extends EventEmitter {
  private sessionId: string;
  private sdkSessionId: string | undefined;  // SDK 返回的 session_id（用于 resume）
  private query: Query | null = null;
  private logger = mainLogger;
  private config: QueryBasedSessionConfig;
  private status: SessionStatus = SessionStatus.IDLE;

  // 消息队列相关
  private messageResolvers: Array<(msg: SDKUserMessage | null) => void> = [];
  private pendingMessages: SDKUserMessage[] = [];

  // 流式状态跟踪（用于日志和去重）
  private isStreaming: boolean = false;
  private streamEventCount: number = 0;

  constructor(sessionId: string, config: QueryBasedSessionConfig) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.logger = this.logger.child(`session-${sessionId.substring(0, 8)}`);
  }

  /**
   * 获取会话 ID（本地 ID）
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取 SDK 返回的 session_id（用于 resume）
   */
  getSdkSessionId(): string | undefined {
    return this.sdkSessionId;
  }

  /**
   * 启动会话
   */
  async start(): Promise<void> {
    if (this.query) {
      this.logger.warn('会话已经启动');
      return;
    }

    this.logger.info('=== 启动基于 Query 的会话 ===');
    this.logger.info('sessionId:', this.sessionId);
    this.logger.info('resume 模式:', !!this.config.resume, this.config.resume || '(新会话)');

    try {
      // 构建系统提示词
      const systemPrompt = this.buildSystemPrompt();

      // 获取项目根目录（用于查找 .claude/skills/）
      const projectRoot = await this.getProjectRoot();
      this.logger.info('项目根目录:', projectRoot);

      // 创建持续的消息流
      const messageStream = this.createMessageStream();

      // 构建 query 配置
      const queryOptions: Record<string, any> = {
        systemPrompt,
        permissionMode: 'bypassPermissions',  // 主进程中可以绕过权限检查
        includePartialMessages: true,  // ⭐ 启用流式消息事件（SDKPartialAssistantMessage）
      };

      // 配置工具列表
      let allowedTools = this.config.allowedTools || ['Read', 'Glob', 'Grep'];

      // 如果启用 Skill，将 'Skill' 工具放在第一位
      if (this.config.enableSkills) {
        allowedTools = ['Skill', ...allowedTools];
        this.logger.info('Skill 功能已启用，已添加 Skill 工具到 allowedTools 第一位:', allowedTools);
      }

      queryOptions.allowedTools = allowedTools;

      // 配置 MCP Servers
      if (this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0) {
        queryOptions.mcpServers = this.config.mcpServers;
        this.logger.info('已配置 MCP Servers:', Object.keys(this.config.mcpServers));
      }

      // 配置工作目录和设置源
      if (this.config.enableSkills && projectRoot) {
        queryOptions.cwd = projectRoot;
        // 必须包含 'project' 才能加载 .claude/settings.json 和 skills
        queryOptions.settingSources = ['user','project'];
        this.logger.info('已配置 cwd 和 settingSources 以加载 Skills');
      }

      // 配置额外目录（工作区）
      if (this.config.workspacePath) {
        queryOptions.additionalDirectories = [this.config.workspacePath];
        this.logger.info('已配置工作区目录:', this.config.workspacePath);
      }

      // 配置 resume（恢复之前的会话）
      if (this.config.resume) {
        queryOptions.resume = this.config.resume;
        this.logger.info('✅ 已配置 resume 会话:', this.config.resume);
      } else {
        this.logger.info('创建新会话（无 resume）');
      }

      // ==================== 请求配置详情 ====================
      this.logger.info('╔════════════════════════════════════════════════════════════════╗');
      this.logger.info('║                     AI 请求配置详情                             ║');
      this.logger.info('╚════════════════════════════════════════════════════════════════╝');
      this.logger.info('');
      this.logger.info('📋 基础配置:');
      this.logger.info('  • model:', queryOptions.model);
      this.logger.info('  • resume:', queryOptions.resume || '(无 - 新会话)');
      this.logger.info('  • permissionMode:', queryOptions.permissionMode);
      this.logger.info('  • includePartialMessages:', queryOptions.includePartialMessages, '(流式事件)');
      this.logger.info('');
      this.logger.info('🔧 工具配置:');
      this.logger.info('  • allowedTools:', JSON.stringify(queryOptions.allowedTools));
      this.logger.info('  • disallowedTools:', queryOptions.disallowedTools || '(无)');
      this.logger.info('');
      this.logger.info('📁 目录配置:');
      this.logger.info('  • cwd:', queryOptions.cwd || '(默认)');
      this.logger.info('  • settingSources:', JSON.stringify(queryOptions.settingSources || []));
      this.logger.info('  • additionalDirectories:', JSON.stringify(queryOptions.additionalDirectories || []));
      this.logger.info('');
      this.logger.info('🌐 MCP Servers:');
      if (queryOptions.mcpServers && Object.keys(queryOptions.mcpServers).length > 0) {
        for (const [name, server] of Object.entries(queryOptions.mcpServers)) {
         this.logger.info(`  • ${name}`);
        }
      } else {
        this.logger.info('  • (无)');
      }
      this.logger.info('');
      this.logger.info('💬 系统提示词:');
      this.logger.info('  • 长度:', systemPrompt.length, '字符');
      this.logger.info('  • 内容预览:', systemPrompt.substring(0, 200) + (systemPrompt.length > 200 ? '...' : ''));
      this.logger.info('');
      this.logger.info('╔════════════════════════════════════════════════════════════════╗');
      this.logger.info('║                  开始创建 query 实例                          ║');
      this.logger.info('╚════════════════════════════════════════════════════════════════╝');
      this.logger.info('');

      // 创建 query
      this.query = query({
        prompt: messageStream,
        options: queryOptions
      });

      this.status = SessionStatus.PROCESSING;
      this.logger.info('✅ 基于 Query 的会话已创建，开始处理消息流...');

      // 启动消息处理循环
      this.processMessageLoop();
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
    if (this.status === SessionStatus.CLOSED) {
      throw new Error('会话已关闭');
    }

    // ==================== 用户消息发送日志 ====================
    this.logger.info('');
    this.logger.info('╔════════════════════════════════════════════════════════════════╗');
    this.logger.info('║                    发送用户消息到会话                          ║');
    this.logger.info('╚════════════════════════════════════════════════════════════════╝');
    this.logger.info('  Session ID:', this.sessionId);
    this.logger.info('  消息长度:', content.length, '字符');
    this.logger.info('  消息内容:', content);
    this.logger.info('╚════════════════════════════════════════════════════════════════╝');
    this.logger.info('');

    const sdkMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content
      },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    };

    // 如果有等待中的 resolver，立即解析
    if (this.messageResolvers.length > 0) {
      const resolve = this.messageResolvers.shift()!;
      resolve(sdkMessage);
    } else {
      // 否则加入待处理队列
      this.pendingMessages.push(sdkMessage);
    }
  }

  /**
   * 处理消息循环
   */
  private async processMessageLoop(): Promise<void> {
    if (!this.query) {
      return;
    }

    const resumeMode = !!this.config.resume;
    this.logger.info('=== 开始处理消息流 ===');
    this.logger.info('resume 模式:', resumeMode, resumeMode ? `session_id: ${this.config.resume}` : '');

    let messageCount = 0;
    let replayCount = 0;

    try {
      for await (const message of this.query) {
        messageCount++;

        // 检查是否为重放消息
        const isReplayMsg = message.type === 'user' && 'isReplay' in message && message.isReplay === true;
        if (isReplayMsg) {
          replayCount++;
        }

        // ==================== SDK 消息日志 ====================
        if (message.type === 'stream_event') {
          // 流式事件：只在开始和结束时输出日志
          const eventType = message.event.type;

          if (!this.isStreaming) {
            // 流式开始
            this.isStreaming = true;
            this.streamEventCount = 0;
            this.logger.info(`📨 [${messageCount}] ▶️ 流式输出开始...`);
          }

          this.streamEventCount++;

          if (eventType === 'message_stop') {
            // 流式结束
            this.logger.info(`📨 [${messageCount}] ⏹️ 流式输出结束 (共 ${this.streamEventCount} 个事件)`);
            this.isStreaming = false;
          }
        } else if (message.type === 'assistant' && !this.isStreaming && this.streamEventCount > 0) {
          // 流式结束后的完整 assistant 消息（与流式内容重复）
          // 只输出日志，不发送到前端
          this.logger.info('');
          this.logger.info(`📨 [${messageCount}] SDK 消息 [assistant] (流式后的完整消息，跳过发送)`);
          this.logger.info('');
          // 重置计数器
          this.streamEventCount = 0;
          continue;  // 跳过这条消息，不发送到前端
        } else {
          // 其他非流式消息：输出原始数据
          this.logger.info('');
          this.logger.info(`📨 [${messageCount}] SDK 消息 [${message.type}]${isReplayMsg ? ' (重放)' : ''}`);
          this.logger.info('原始数据:', JSON.stringify(message, null, 2));
          this.logger.info('');
        }

        // 转换 SDK 消息为扩展消息格式
        const extendedMessage = this.convertSDKMessage(message);
        if (extendedMessage) {
          // 非流式消息才输出转换结果
          if (message.type !== 'stream_event') {
            this.logger.info('✅ 转换结果:', JSON.stringify(extendedMessage));
          }
          this.emit('message', extendedMessage);
        }

        // 处理结果消息（单次对话完成）
        if (message.type === 'result') {
          this.logger.info('=== 收到结果消息 ===', {
            subtype: message.subtype,
            totalMessages: messageCount,
            replayMessages: replayCount
          });
          if (message.subtype === 'success') {
            this.emit('complete', message);
            this.status = SessionStatus.IDLE;
          } else {
            this.emit('error', {
              type: 'error',
              error: message.errors?.join(', ') || '未知错误',
              timestamp: Date.now()
            } as ExtendedSessionMessage);
          }
        }
      }

      this.logger.info('=== 消息流结束 ===', {
        totalMessages: messageCount,
        replayMessages: replayCount
      });
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

    // 流式消息不输出转换日志，减少日志噪音
    if (sdkMessage.type !== 'stream_event') {
      this.logger.info('🔄 转换消息:', sdkMessage.type);
    }

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
        if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          // 思考内容增量
          return {
            type: 'thinking',
            content: event.delta.thinking,
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
          if (block?.type === 'thinking') {
            // 思考块开始
            return {
              type: 'thinking',
              content: '',
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
        // 捕获 SDK 返回的 session_id（用于 resume）
        if (sdkMessage.subtype === 'init' && sdkMessage.session_id) {
          this.sdkSessionId = sdkMessage.session_id;
          this.logger.info('收到 SDK session_id:', this.sdkSessionId);
          // 发出 session_id 事件，让主进程保存到数据库
          this.emit('session_init', { session_id: this.sdkSessionId });
        }
        return {
          type: 'status',
          status: sdkMessage.subtype,
          timestamp
        };
      }

      case 'user': {
        // 用户消息（包括新消息和重放的历史消息）
        const userMsg = sdkMessage as SDKUserMessage | SDKUserMessageReplay;
        const isReplay = 'isReplay' in userMsg && userMsg.isReplay === true;

        // 提取用户消息内容
        const messageContent = userMsg.message.content;
        let contentText = '';
        if (typeof messageContent === 'string') {
          contentText = messageContent;
        } else if (Array.isArray(messageContent)) {
          // 处理内容块数组
          const textBlocks: string[] = [];
          for (const block of messageContent) {
            if (typeof block === 'string') {
              textBlocks.push(block);
            } else if (block && typeof block === 'object' && 'type' in block) {
              if (block.type === 'text') {
                textBlocks.push((block as { text: string }).text);
              }
            }
          }
          contentText = textBlocks.join('');
        }

        this.logger.info('收到用户消息:', isReplay ? '(重放)' : '(新)', contentText.substring(0, 50));

        return {
          type: 'user',
          content: contentText,
          timestamp,
          isReplay,
          uuid: 'uuid' in userMsg ? String(userMsg.uuid) : undefined
        };
      }

      default:
        return null;
    }
  }

  /**
   * 创建持续的消息流迭代器
   */
  private async *createMessageStream(): AsyncGenerator<SDKUserMessage> {
    this.logger.info('创建持续消息流');

    while (this.status !== SessionStatus.CLOSED) {
      // 如果有待处理的消息，立即返回
      if (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift()!;
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

      yield msg;
    }
  }

  /**
   * 获取项目根目录
   * 用于查找 .claude/skills/ 目录
   */
  private async getProjectRoot(): Promise<string | undefined> {
    // 优先使用配置的项目根目录
    if (this.config.projectRoot) {
      return this.config.projectRoot;
    }

    // 开发环境：使用项目根目录
    // 生产环境：需要考虑打包后的路径
    if (process.env.NODE_ENV === 'development') {
      // 开发环境，使用项目根目录
      // 假设 electron/main 目录在项目根目录下的 electron/main
      const currentDir = process.cwd();
      // 向上查找包含 .claude 目录的父目录
      let searchDir = currentDir;
      for (let i = 0; i < 5; i++) {
        const claudePath = path.join(searchDir, '.claude');
        const packageJsonPath = path.join(searchDir, 'package.json');

        try {
          const fs = await import('fs/promises');
          const [claudeExists, packageExists] = await Promise.all([
            fs.access(claudePath).then(() => true).catch(() => false),
            fs.access(packageJsonPath).then(() => true).catch(() => false)
          ]);

          if (claudeExists && packageExists) {
            this.logger.info('找到项目根目录:', searchDir);
            return searchDir;
          }
        } catch {
          // 忽略错误
        }

        searchDir = path.dirname(searchDir);
      }
    }

    // 生产环境或找不到时，返回 undefined
    // 可以在配置中显式指定 projectRoot
    this.logger.warn('无法自动确定项目根目录，请在配置中指定 projectRoot');
    return undefined;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const { context } = this.config;

    // 基础提示词
    let prompt = '你是一个帮助用户阅读和分析电子书的 AI 助手。';

    // 如果启用 Skills，添加相关说明
    if (this.config.enableSkills) {
      prompt += `

**重要**: 你可以使用 Book-QA 技能来帮助用户搜索书籍内容并基于原文回答问题。
当用户询问与书籍相关的问题时，请使用 Skill 工具调用 book-qa 技能。`;
    }

    if (!context) {
      return prompt;
    }

    const contextInfo = [];
    if (context.bookId) contextInfo.push(`书籍ID: ${context.bookId}`);
    if (context.chapterId) contextInfo.push(`章节ID: ${context.chapterId}`);
    if (context.selectedText) contextInfo.push(`选中文本: ${context.selectedText}`);

    return `${prompt}

当前上下文:
${contextInfo.join('\n')}

请根据上述上下文提供有针对性的帮助。`;
  }

  /**
   * 关闭会话
   */
  close(): void {
    this.logger.info('关闭会话:', this.sessionId);

    if (this.query) {
      // Query 没有 close 方法，只需设置状态
      this.query = null;
    }

    this.status = SessionStatus.CLOSED;

    // 通知消息流迭代器结束
    while (this.messageResolvers.length > 0) {
      const resolve = this.messageResolvers.shift()!;
      resolve(null);
    }

    this.pendingMessages = [];

    // 移除所有监听器
    this.removeAllListeners();
  }

  /**
   * 检查会话是否活跃
   */
  isSessionActive(): boolean {
    return this.status !== SessionStatus.CLOSED;
  }
}

/**
 * 基于 Query 的会话管理器
 */
export class QueryBasedSessionManager extends EventEmitter {
  private sessions: Map<string, QueryBasedSession> = new Map();
  private logger = mainLogger.child('query-session-manager');

  /**
   * 创建新会话
   */
  createSession(config: QueryBasedSessionConfig): QueryBasedSession {
    const sessionId = uuidv4();
    this.logger.info('创建基于 Query 的会话:', sessionId.substring(0, 8));

    const session = new QueryBasedSession(sessionId, config);

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
  getSession(sessionId: string): QueryBasedSession | undefined {
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
      this.logger.info('基于 Query 的会话已关闭:', sessionId.substring(0, 8));
    }
  }

  /**
   * 关闭所有会话
   */
  closeAll(): void {
    this.logger.info('关闭所有基于 Query 的会话...');
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

let queryBasedSessionManagerInstance: QueryBasedSessionManager | null = null;

/**
 * 获取基于 Query 的会话管理器单例
 */
export function getQueryBasedSessionManager(): QueryBasedSessionManager {
  if (!queryBasedSessionManagerInstance) {
    queryBasedSessionManagerInstance = new QueryBasedSessionManager();
  }
  return queryBasedSessionManagerInstance;
}

/**
 * 关闭基于 Query 的会话管理器
 */
export function shutdownQueryBasedSessionManager(): void {
  if (queryBasedSessionManagerInstance) {
    queryBasedSessionManagerInstance.closeAll();
    queryBasedSessionManagerInstance = null;
  }
}
