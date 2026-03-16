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
import type {
  SDKUserMessage, SDKMessage, SDKUserMessageReplay, CanUseTool, PermissionResult, PermissionMode,
  AgentDefinition, HookEvent, HookCallbackMatcher,
  SessionStartHookInput, SessionEndHookInput, StopHookInput,
  PostToolUseFailureHookInput, NotificationHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { mainLogger } from './logger.js';
import type { ExtendedSessionMessage } from './task-types.js';
import path from 'path';
import { getClaudeConfigDir } from '../tipc/agent.js';
import { loadSettings, getActiveProfile, isProfileComplete } from '../services/settings-service.js';

// 重新导出，保持现有导入路径兼容
export type { ExtendedSessionMessage };

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
  allowedTools?: string[];           // 允许的工具列表
  mcpServers?: Record<string, any>;  // MCP Server 配置
  systemPrompt?: string;             // 系统提示词
  context?: SessionContext;          // 上下文信息
  workspacePath?: string;            // 工作区路径
  // Skill 配置
  enableSkills?: boolean;            // 是否启用 Skill 功能（默认 false）
  projectRoot?: string;              // 项目根目录（用于查找 .claude/skills/）
  resume?: string;                   // SDK session_id（用于恢复会话）
  forkSession?: boolean;             // 是否创建分叉（与 resume 配合使用）
  resumeSessionAt?: string;          // 截断到此 assistant 消息的 SDK UUID
  // 子代理配置
  agents?: Record<string, AgentDefinition>;  // 自定义子代理（通过 Task 工具调用）
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

  // 工具输入累积器（解决流式传输时先显示空数据的问题）
  // key: tool_use_id 或 content_block index, value: { name, input累积字符串 }
  private pendingToolInputs: Map<string | number, { name: string; inputJson: string; toolUseId?: string }> = new Map();

  // 权限请求等待队列：key=requestId, value={ resolver, originalInput }
  private pendingPermissionRequests: Map<string, {
    resolve: (result: PermissionResult) => void;
    input: Record<string, unknown>;  // 保存原始 input，allow 时需要回传
  }> = new Map();

  // 声明式权限规则（从 settings.json 加载，缓存避免每次 canUseTool 都读磁盘）
  private permissionRules?: { allow?: string[]; deny?: string[] };

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
        permissionMode: 'default',  // 默认模式：通过 canUseTool 回调询问用户
        includePartialMessages: true,  // 启用流式消息事件（SDKPartialAssistantMessage）
      };

      // 从 settings.json 读取 AI 配置（唯一配置源）
      const appSettings = await loadSettings();
      const activeProfile = getActiveProfile(appSettings);

      // 校验 Profile 完整性
      if (!isProfileComplete(activeProfile)) {
        const errorMsg = `当前模型方案 "${activeProfile.name}" 配置不完整，请在设置页面完善 API Key、Base URL 和模型映射`;
        this.logger.error(errorMsg);
        this.emit('sessionError', { error: errorMsg });
        return;
      }

      // 注入 thinking 和 effort
      queryOptions.thinking = appSettings.ai.thinking;
      queryOptions.effort = appSettings.ai.effort;

      // 缓存声明式权限规则
      if ((appSettings as any).permissionRules) {
        this.permissionRules = (appSettings as any).permissionRules;
        this.logger.info('已加载权限规则:', this.permissionRules);
      }

      // 注入 maxTurns
      if ((appSettings.ai as any).maxTurns) {
        queryOptions.maxTurns = (appSettings.ai as any).maxTurns;
        this.logger.info('已配置 maxTurns:', queryOptions.maxTurns);
      }

      this.logger.info('已从 settings.json 加载 AI 配置:', {
        thinking: appSettings.ai.thinking.type,
        effort: appSettings.ai.effort,
        profileName: activeProfile.name,
      });

      // 配置工具列表
      let allowedTools = this.config.allowedTools || ['Read', 'Glob', 'Grep', 'AskUserQuestion'];

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

      // 配置工作目录：cwd 使用用户选择的工作区路径，这样 agent 的工作上下文是用户的工作区
      // 项目根目录放入 additionalDirectories，保持 skills 的加载能力
      if (this.config.workspacePath) {
        queryOptions.cwd = this.config.workspacePath;
        this.logger.info('已配置 cwd 为用户工作区:', this.config.workspacePath);
      }

      if (this.config.enableSkills && projectRoot) {
        // 必须包含 'project' 才能加载 .claude/settings.json 和 skills
        queryOptions.settingSources = ['user'];
        // 将项目根目录加入 additionalDirectories，确保 skills 仍然可以被加载
        // const additionalDirs: string[] = [];
        // if (projectRoot !== this.config.workspacePath) {
        //   additionalDirs.push(projectRoot);
        // }
        // if (additionalDirs.length > 0) {
        //   queryOptions.additionalDirectories = additionalDirs;
        //   this.logger.info('已配置 additionalDirectories（含项目根目录）:', additionalDirs);
        // }
        this.logger.info('已配置 settingSources 以加载 Skills');
      }

      // 配置 resume（恢复之前的会话）
      if (this.config.resume) {
        queryOptions.resume = this.config.resume;
        this.logger.info('✅ 已配置 resume 会话:', this.config.resume);
      } else {
        this.logger.info('创建新会话（无 resume）');
      }

      // 配置 forkSession（分叉会话）
      if (this.config.forkSession) {
        queryOptions.forkSession = true;
        this.logger.info('✅ 已配置 forkSession: 将创建新的会话分支');
      }

      // 配置 resumeSessionAt（截断位置）
      if (this.config.resumeSessionAt) {
        queryOptions.resumeSessionAt = this.config.resumeSessionAt;
        this.logger.info('✅ 已配置 resumeSessionAt:', this.config.resumeSessionAt);
      }

      // 构建全新的 env 对象（不继承 process.env，完全从 settings Profile 构建）
      const claudeConfigDir = getClaudeConfigDir();
      queryOptions.env = {
        ANTHROPIC_AUTH_TOKEN: activeProfile.apiKey,
        ANTHROPIC_BASE_URL: activeProfile.baseUrl,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: activeProfile.haikuModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: activeProfile.sonnetModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: activeProfile.opusModel,
        API_TIMEOUT_MS: String(activeProfile.apiTimeoutMs),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: activeProfile.disableNonessentialTraffic ? '1' : '0',
        CLAUDE_CONFIG_DIR: claudeConfigDir,
      };

      this.logger.info('已从 settings Profile 构建 env:', {
        profileName: activeProfile.name,
        baseUrl: activeProfile.baseUrl,
        haikuModel: activeProfile.haikuModel,
        sonnetModel: activeProfile.sonnetModel,
        opusModel: activeProfile.opusModel,
        apiTimeoutMs: activeProfile.apiTimeoutMs,
        claudeConfigDir,
      });

      // 配置权限确认回调：当 permissionMode 为 default 时，SDK 会调用此回调
      // 使用 SDK 导出的 CanUseTool 类型签名
      queryOptions.canUseTool = (async (toolName, input, options) => {
        const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.logger.info('权限确认请求:', { requestId, toolName, toolUseID: options.toolUseID, decisionReason: options.decisionReason });

        // AskUserQuestion 特殊处理：不走通用权限流程，而是发送到前端展示问答 UI
        if (toolName === 'AskUserQuestion') {
          const askRequestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          this.logger.info('AskUserQuestion 请求:', { askRequestId, questions: (input as any).questions });

          this.emit('askUserQuestion', {
            requestId: askRequestId,
            questions: (input as any).questions,
          });

          return new Promise<PermissionResult>((resolve) => {
            this.pendingPermissionRequests.set(askRequestId, { resolve, input });

            options.signal.addEventListener('abort', () => {
              if (this.pendingPermissionRequests.has(askRequestId)) {
                this.pendingPermissionRequests.delete(askRequestId);
                resolve({ behavior: 'deny', message: '操作已取消' });
              }
            });
          });
        }

        // 声明式权限规则检查（来自设置）
        if (this.permissionRules?.deny?.includes(toolName)) {
          return { behavior: 'deny', message: `工具 "${toolName}" 已被设置规则禁止` };
        }
        if (this.permissionRules?.allow?.includes(toolName)) {
          return { behavior: 'allow', updatedInput: input };
        }

        // 通用权限请求：发送事件到前端
        this.emit('permissionRequest', {
          requestId,
          toolName,
          toolInput: input,
          decisionReason: options.decisionReason,
        });

        // 等待前端用户响应
        return new Promise<PermissionResult>((resolve) => {
          this.pendingPermissionRequests.set(requestId, { resolve, input });

          // 如果 AbortSignal 被触发（如会话关闭），自动拒绝
          options.signal.addEventListener('abort', () => {
            if (this.pendingPermissionRequests.has(requestId)) {
              this.pendingPermissionRequests.delete(requestId);
              resolve({ behavior: 'deny', message: '操作已取消' });
            }
          });
        });
      }) satisfies CanUseTool;

      // ==================== 子代理配置 ====================
      if (this.config.agents && Object.keys(this.config.agents).length > 0) {
        queryOptions.agents = this.config.agents;
        this.logger.info('已配置子代理:', Object.keys(this.config.agents));
      }

      // ==================== Hooks 配置 ====================
      const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

      // SessionStart Hook：会话启动时注入书籍上下文
      hooks.SessionStart = [{
        hooks: [async (input) => {
          const { source, model } = input as SessionStartHookInput;
          this.logger.info('SessionStart hook 触发:', { source, model });

          // 发送事件到前端
          this.emit('message', {
            type: 'session_start',
            sessionStartSource: source,
            timestamp: Date.now(),
          } as ExtendedSessionMessage);

          // 根据来源构建上下文注入
          let additionalContext = '';
          const ctx = this.config.context;

          if (source === 'startup') {
            // 新会话启动：注入完整上下文
            if (ctx?.bookId) additionalContext += `当前书籍 ID: ${ctx.bookId}\n`;
            if (ctx?.chapterId) additionalContext += `当前章节 ID: ${ctx.chapterId}\n`;
            if (ctx?.selectedText) additionalContext += `用户选中的文本: ${ctx.selectedText}\n`;
          } else if (source === 'resume') {
            if (ctx?.bookId) additionalContext = `会话已恢复。当前书籍 ID: ${ctx.bookId}`;
          } else if (source === 'compact') {
            additionalContext = '注意：会话已经过压缩，部分上下文可能丢失。';
            if (ctx?.bookId) additionalContext += ` 当前书籍 ID: ${ctx.bookId}`;
          }

          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'SessionStart' as const,
              additionalContext: additionalContext || undefined,
            },
          };
        }],
      }];

      // SessionEnd Hook：会话结束时清理资源
      hooks.SessionEnd = [{
        hooks: [async (input) => {
          const { reason } = input as SessionEndHookInput;
          this.logger.info('SessionEnd hook 触发:', reason);

          this.emit('message', {
            type: 'session_end',
            sessionEndReason: reason,
            timestamp: Date.now(),
          } as ExtendedSessionMessage);

          // 清理未完成的权限请求（安全检查，避免与 close() 重复）
          for (const [, pending] of this.pendingPermissionRequests) {
            pending.resolve({ behavior: 'deny', message: '会话已结束' });
          }
          this.pendingPermissionRequests.clear();

          return { continue: true };
        }],
      }];

      // Stop Hook：Agent 即将停止时通知前端
      hooks.Stop = [{
        hooks: [async (input) => {
          const { stop_hook_active } = input as StopHookInput;
          this.logger.info('Stop hook 触发:', { stop_hook_active });

          this.emit('message', {
            type: 'stop',
            stopHookActive: stop_hook_active,
            timestamp: Date.now(),
          } as ExtendedSessionMessage);

          return { continue: true };
        }],
      }];

      // PostToolUseFailure Hook：工具执行失败时通知前端
      hooks.PostToolUseFailure = [{
        hooks: [async (input) => {
          const { tool_name, error, tool_use_id } = input as PostToolUseFailureHookInput;
          this.logger.warn('PostToolUseFailure hook:', tool_name, error);

          this.emit('message', {
            type: 'tool_failure',
            failedToolName: tool_name,
            failedToolError: error,
            toolUseId: tool_use_id,
            timestamp: Date.now(),
          } as ExtendedSessionMessage);

          return { continue: true };
        }],
      }];

      // Notification Hook：Agent 通知推送到前端和系统
      hooks.Notification = [{
        hooks: [async (input) => {
          const { message, title, notification_type } = input as NotificationHookInput;
          this.logger.info('Notification hook:', title, message);

          // 发射独立事件（用于系统级通知，如 Electron Notification）
          this.emit('notification', {
            title,
            message,
            notificationType: notification_type,
          });

          // 同时作为消息显示在对话中
          this.emit('message', {
            type: 'notification',
            notificationTitle: title,
            notificationMessage: message,
            notificationType: notification_type,
            timestamp: Date.now(),
          } as ExtendedSessionMessage);

          return { continue: true };
        }],
      }];

      queryOptions.hooks = hooks;

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
      this.logger.info('  • CLAUDE_CONFIG_DIR:', claudeConfigDir);
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
   * 获取支持的斜杠命令列表
   */
  async getSupportedCommands(): Promise<Array<{ name: string; description: string; argumentHint: string }>> {
    if (!this.query) {
      return [];
    }
    try {
      const commands = await this.query.supportedCommands();
      return commands.map(cmd => ({
        name: cmd.name,
        description: cmd.description,
        argumentHint: cmd.argumentHint,
      }));
    } catch (error) {
      this.logger.error('获取支持的命令失败:', error);
      return [];
    }
  }

  /**
   * 发送消息到会话
   */
  async sendMessage(content: string | Array<{ type: string; [key: string]: any }>): Promise<void> {
    if (this.status === SessionStatus.CLOSED) {
      throw new Error('会话已关闭');
    }

    // ==================== 用户消息发送日志 ====================
    this.logger.info('');
    this.logger.info('╔════════════════════════════════════════════════════════════════╗');
    this.logger.info('║                    发送用户消息到会话                          ║');
    this.logger.info('╚════════════════════════════════════════════════════════════════╝');
    this.logger.info('  Session ID:', this.sessionId);
    if (typeof content === 'string') {
      this.logger.info('  消息长度:', content.length, '字符');
      this.logger.info('  消息内容:', content);
    } else {
      this.logger.info('  消息块数:', content.length, '（含图像）');
    }
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
        } else {
          // 其他非流式消息：输出原始数据
          this.logger.info('');
          this.logger.info(`📨 [${messageCount}] SDK 消息 [${message.type}]${isReplayMsg ? ' (重放)' : ''}`);
          this.logger.info('原始数据:', JSON.stringify(message, null, 2));
          this.logger.info('');
        }

        // 转换 SDK 消息为扩展消息格式（可能返回多个消息）
        const extendedMessages = this.convertSDKMessage(message);
        if (extendedMessages) {
          const messages = Array.isArray(extendedMessages) ? extendedMessages : [extendedMessages];
          for (const extendedMessage of messages) {
            // 非流式消息才输出转换结果
            if (message.type !== 'stream_event') {
              this.logger.info('✅ 转换结果:', JSON.stringify(extendedMessage));
            }
            this.emit('message', extendedMessage);
          }
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
   * @returns 单个消息、消息数组（如包含工具结果）或 null
   */
  private convertSDKMessage(sdkMessage: SDKMessage): ExtendedSessionMessage | ExtendedSessionMessage[] | null {
    const timestamp = Date.now();

    // 流式消息不输出转换日志，减少日志噪音
    if (sdkMessage.type !== 'stream_event') {
      this.logger.info('🔄 转换消息:', sdkMessage.type);
    }

    switch (sdkMessage.type) {
      case 'assistant': {
        // 助手消息，包含文本和工具调用
        // 提取 assistant 消息的 UUID（用于分叉功能）
        const assistantUuid = 'uuid' in sdkMessage ? String(sdkMessage.uuid) : undefined;

        // ⚠️ 注意：在流式输出期间，SDK 会发送完整的 assistant 消息，
        // 这些消息与流式内容重复，应该被跳过
        if (this.isStreaming) {
          // 流式输出期间，只处理 tool_use（流式事件中已经处理了文本）
          const content = sdkMessage.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === 'object' && block.type === 'tool_use') {
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

          // 即使跳过文本，也需要将 assistant uuid 和 model 发送到前端
          if (assistantUuid) {
            this.emit('message', {
              type: 'assistant_uuid',
              uuid: assistantUuid,
              model: (sdkMessage.message as any).model,
              timestamp,
            } as ExtendedSessionMessage);
          }

          // 返回 null 表示不发送此消息到前端
          this.logger.info('⚠️  流式输出期间收到 assistant 消息，已跳过文本内容（避免重复显示）');
          return null;
        }

        // 非流式模式下，正常处理 assistant 消息
        const message: ExtendedSessionMessage = {
          type: 'text',
          content: '',
          timestamp,
          uuid: assistantUuid,  // 携带 assistant uuid
          model: (sdkMessage.message as any).model,  // 携带实际模型名称
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

        // 文本增量
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          return {
            type: 'text',
            content: event.delta.text,
            timestamp
          };
        }

        // 思考内容增量
        if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          return {
            type: 'thinking',
            content: event.delta.thinking,
            timestamp
          };
        }

        // 工具输入增量 - 累积 JSON 字符串
        if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          const index = event.index;
          const pending = this.pendingToolInputs.get(index);
          if (pending) {
            pending.inputJson += event.delta.partial_json || '';
          }
          // 不立即发送消息，等待 content_block_stop
          return null;
        }

        // 内容块开始
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          const index = event.index;

          if (block?.type === 'tool_use') {
            // 工具调用开始 - 存储到累积器（含 toolUseId），先发送状态消息
            this.pendingToolInputs.set(index, {
              name: block.name,
              inputJson: '',
              toolUseId: block.id
            });
            // 发送 tool_use 块（无 input，前端显示为 running 状态）
            return {
              type: 'tool_use',
              toolName: block.name,
              toolInput: null,  // input 尚未就绪，前端据此判断为 running
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

        // 内容块结束 - 发送完整的工具调用
        if (event.type === 'content_block_stop') {
          const index = event.index;
          const pending = this.pendingToolInputs.get(index);

          if (pending) {
            // 解析累积的 JSON
            let toolInput = {};
            try {
              if (pending.inputJson) {
                toolInput = JSON.parse(pending.inputJson);
              }
            } catch (e) {
              this.logger.warn('解析工具输入 JSON 失败:', pending.inputJson);
            }

            // 清除累积器
            this.pendingToolInputs.delete(index);

            // 发送完整的工具调用消息（携带 toolUseId 以便前端关联 tool_result）
            return {
              type: 'tool_use',
              toolName: pending.name,
              toolInput: toolInput,
              toolUseId: pending.toolUseId,
              timestamp
            };
          }
        }

        return null;
      }

      case 'tool_progress': {
        // 工具执行进度 - 统一用 tool_use 类型，前端通过 toolUseId 合并到已有块
        return {
          type: 'tool_use',
          toolName: sdkMessage.tool_name,
          toolInput: null,  // 进度事件无 input
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

          // 从 init 消息中提取会话能力信息，通知前端
          const initMsg = sdkMessage as any;
          if (initMsg.slash_commands || initMsg.tools || initMsg.skills || initMsg.mcp_servers) {
            this.emit('session_capabilities', {
              slashCommands: initMsg.slash_commands || [],
              tools: initMsg.tools || [],
              skills: initMsg.skills || [],
              mcpServers: initMsg.mcp_servers || [],
            });
          }

          // ⚠️ init 消息不需要显示在界面上，只用于内部初始化
          return null;
        }

        // 子代理任务通知（使用 agents 配置后，SDK 会发送此消息）
        if (sdkMessage.subtype === 'task_notification') {
          const taskMsg = sdkMessage as any;
          this.logger.info('子代理任务通知:', taskMsg.task_id, taskMsg.status);
          return {
            type: 'task_notification',
            taskId: taskMsg.task_id,
            taskStatus: taskMsg.status,
            taskSummary: taskMsg.summary,
            timestamp,
          };
        }

        // 对话压缩分隔线（/compact 或自动压缩完成后）
        if (sdkMessage.subtype === 'compact_boundary') {
          const compactMsg = sdkMessage as any;
          const metadata = compactMsg.compact_metadata || {};
          this.logger.info('对话压缩完成:', metadata.trigger, '压缩前 tokens:', metadata.pre_tokens);
          return {
            type: 'compact_boundary',
            compactTrigger: metadata.trigger,
            compactPreTokens: metadata.pre_tokens,
            timestamp,
          };
        }

        // 正在压缩中状态
        if (sdkMessage.subtype === 'status' && (sdkMessage as any).status === 'compacting') {
          this.logger.info('对话正在压缩...');
          return {
            type: 'compacting',
            timestamp,
          };
        }

        // 本地命令输出（SDK 内置命令如 /compact 的文本输出）
        if (sdkMessage.subtype === 'local_command_output') {
          const cmdMsg = sdkMessage as any;
          this.logger.info('本地命令输出:', cmdMsg.content?.substring(0, 100));
          return {
            type: 'local_command_output',
            content: cmdMsg.content || '',
            timestamp,
          };
        }

        // Hook 相关的系统消息不需要显示在前端
        if (sdkMessage.subtype === 'hook_started' ||
            sdkMessage.subtype === 'hook_progress' ||
            sdkMessage.subtype === 'hook_response') {
          return null;
        }

        return {
          type: 'status',
          status: sdkMessage.subtype,
          timestamp
        };
      }

      case 'user': {
        // 用户消息（包括新消息、重放的历史消息、以及工具执行结果）
        const userMsg = sdkMessage as SDKUserMessage | SDKUserMessageReplay;
        const isReplay = 'isReplay' in userMsg && userMsg.isReplay === true;

        // 跳过 isMeta 消息（skill 内容），避免将 skill 的 MD 内容当作用户输入显示
        // isMeta 消息是 SDK 内部用于传递 skill 内容的，不应在前端显示为用户消息
        if ('isMeta' in sdkMessage && (sdkMessage as any).isMeta) {
          const sourceToolUseID = (sdkMessage as any).sourceToolUseID;
          this.logger.info('⚠️ 跳过 isMeta 消息（skill 内容），sourceToolUseID:', sourceToolUseID);

          // 提取 skill 内容，合并到对应工具调用的输出中
          if (sourceToolUseID) {
            let skillContent = '';
            const metaContent = userMsg.message.content;
            if (typeof metaContent === 'string') {
              skillContent = metaContent;
            } else if (Array.isArray(metaContent)) {
              for (const block of metaContent) {
                if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
                  skillContent += (block as { text: string }).text || '';
                }
              }
            }

            // 将 skill 内容作为 tool_result 发送，关联到对应的 Skill 工具调用
            if (skillContent) {
              return {
                type: 'tool_result',
                toolUseId: sourceToolUseID,
                toolOutput: skillContent,
                isError: false,
                timestamp,
                isReplay,
              };
            }
          }
          return null;
        }

        // 提取用户消息内容
        const messageContent = userMsg.message.content;
        let contentText = '';
        const toolResults: ExtendedSessionMessage[] = [];

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
              } else if (block.type === 'tool_result') {
                // 提取工具执行结果
                const toolResult = block as {
                  type: 'tool_result';
                  tool_use_id: string;
                  content?: string | Array<{ type: string; text?: string }>;
                  is_error?: boolean;
                };
                this.logger.info('收到工具执行结果:', toolResult.tool_use_id);

                // 提取工具结果内容
                let outputContent = '';
                if (typeof toolResult.content === 'string') {
                  outputContent = toolResult.content;
                } else if (Array.isArray(toolResult.content)) {
                  outputContent = toolResult.content
                    .filter((c): c is { type: string; text: string } => c.type === 'text' && typeof c.text === 'string')
                    .map(c => c.text)
                    .join('\n');
                }

                toolResults.push({
                  type: 'tool_result',
                  toolUseId: toolResult.tool_use_id,
                  toolOutput: outputContent,
                  isError: toolResult.is_error || false,
                  timestamp,
                  isReplay
                });
              }
            }
          }
          contentText = textBlocks.join('');
        }

        // 收集所有要返回的消息
        const messages: ExtendedSessionMessage[] = [...toolResults];

        // 如果有用户文本内容，也添加用户消息
        if (contentText) {
          this.logger.info('收到用户消息:', isReplay ? '(重放)' : '(新)', contentText.substring(0, 50));
          messages.push({
            type: 'user',
            content: contentText,
            timestamp,
            isReplay,
            uuid: 'uuid' in userMsg ? String(userMsg.uuid) : undefined
          });
        }

        // 返回所有消息（工具结果 + 用户文本）
        if (messages.length === 0) {
          return null;
        } else if (messages.length === 1) {
          return messages[0];
        } else {
          return messages;
        }
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
   * 调用 SDK Query 的 close() 方法优雅终止底层 CLI 子进程和 transport 流，
   * 避免快速切换对话时产生 ERR_STREAM_WRITE_AFTER_END 错误。
   */
  close(): void {
    this.logger.info('关闭会话:', this.sessionId);

    if (this.query) {
      try {
        // 调用 SDK Query 的 close() 终止底层进程和 transport
        this.query.close();
      } catch (e) {
        this.logger.warn('关闭 Query 时出错（可忽略）:', e);
      }
      this.query = null;
    }

    this.status = SessionStatus.CLOSED;

    // 通知消息流迭代器结束
    while (this.messageResolvers.length > 0) {
      const resolve = this.messageResolvers.shift()!;
      resolve(null);
    }

    this.pendingMessages = [];

    // 清理未完成的权限请求（自动拒绝）
    for (const [, pending] of this.pendingPermissionRequests) {
      pending.resolve({ behavior: 'deny', message: '会话已关闭' });
    }
    this.pendingPermissionRequests.clear();

    // 移除所有监听器
    this.removeAllListeners();
  }

  // ==================== 运行时控制方法 ====================

  /**
   * 中断当前执行
   * 停止 AI 回复，将控制权返回给调用者
   */
  async interrupt(): Promise<void> {
    if (!this.query) {
      this.logger.warn('interrupt: 没有活跃的 query');
      return;
    }
    this.logger.info('中断当前执行');
    await this.query.interrupt();
  }

  /**
   * 更改权限模式
   * 即时生效，下一次工具调用就会使用新模式
   */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.query) {
      this.logger.warn('setPermissionMode: 没有活跃的 query');
      return;
    }
    this.logger.info('更改权限模式:', mode);
    await this.query.setPermissionMode(mode);
    // 通知前端权限模式已变更（双向同步）
    this.emit('permissionModeChanged', { mode });
  }

  /**
   * 响应权限确认请求
   * 由前端用户点击允许/拒绝后调用
   */
  respondPermissionRequest(requestId: string, behavior: 'allow' | 'deny', message?: string, updatedInput?: Record<string, unknown>): void {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (!pending) {
      this.logger.warn('respondPermissionRequest: 找不到请求:', requestId);
      return;
    }
    this.pendingPermissionRequests.delete(requestId);
    this.logger.info('权限确认响应:', { requestId, behavior });

    if (behavior === 'allow') {
      // SDK 的 Zod schema 要求 allow 时必须传回 updatedInput
      // 优先使用用户编辑后的 updatedInput，否则回传原始 input
      pending.resolve({ behavior: 'allow', updatedInput: updatedInput || pending.input });
    } else {
      pending.resolve({ behavior: 'deny', message: message || '用户拒绝了此操作' });
    }
  }

  /**
   * 响应 AskUserQuestion 请求
   * 由前端用户选择/填写答案后调用，将 answers 注入到工具 input 中
   */
  respondAskUserQuestion(requestId: string, answers: Record<string, string>): void {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (!pending) {
      this.logger.warn('respondAskUserQuestion: 找不到请求:', requestId);
      return;
    }
    this.pendingPermissionRequests.delete(requestId);
    this.logger.info('AskUserQuestion 响应:', { requestId, answers });

    // 将用户的 answers 注入到原始 input 中，然后 allow
    pending.resolve({
      behavior: 'allow',
      updatedInput: { ...pending.input, answers },
    });
  }

  /**
   * 设置最大思考 token 数
   * 0 = 禁用思考，null = 恢复默认（模型自动决定），正整数 = 固定预算
   * 对于 Opus 4.6：非 0 值会强制使用 adaptive 模式
   */
  async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
    if (!this.query) {
      this.logger.warn('setMaxThinkingTokens: 没有活跃的 query');
      return;
    }
    this.logger.info('设置 maxThinkingTokens:', maxThinkingTokens);
    await this.query.setMaxThinkingTokens(maxThinkingTokens);
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
