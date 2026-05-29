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
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { appendEntry as appendUsageEntry, appendCompactMarker as appendUsageCompactMarker } from '../services/usage/usage-service.js';
import { extractUsageEntry } from '../services/usage/usage-extractor.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';
import type { CompactMarker, ConversationUsageEntry } from '../types.js';
import type {
  SDKUserMessage, SDKMessage, SDKUserMessageReplay, CanUseTool, PermissionResult, PermissionMode,
  AgentDefinition, HookEvent, HookCallbackMatcher,
  SessionStartHookInput, SessionEndHookInput, StopHookInput,
  PostToolUseFailureHookInput, NotificationHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';

/**
 * SDK 0.2.69 起，subagent 工具在 wire 上的名字在 'Agent' / 'Task' 之间过渡。
 * CHANGELOG 明确最终会回到 'Agent'，过渡期两种名字都可能出现，统一兼容判断。
 */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);
function isSubAgentToolName(name: string | undefined | null): boolean {
  return !!name && SUBAGENT_TOOL_NAMES.has(name);
}

/**
 * 日志友好的 SDK 消息序列化：
 * - SessionStart hook 注入的 additionalContext 经常是几 KB 的 skill 全文，
 *   完整打印会刷屏。这里对 hook_started / hook_response 只打摘要。
 * - 其它消息超过 2KB 也做整体截断，保留首尾便于排查。
 */
function formatSdkMessageForLog(message: SDKMessage): string {
  const MAX_LEN = 2000;
  if (message.type === 'system') {
    const sub = (message as { subtype?: string }).subtype;
    if (sub === 'hook_started' || sub === 'hook_progress' || sub === 'hook_response') {
      const m = message as Record<string, unknown>;
      const summary: Record<string, unknown> = {
        type: 'system',
        subtype: sub,
        hook_name: m.hook_name,
        hook_event: m.hook_event,
        hook_id: m.hook_id,
        session_id: m.session_id,
      };
      if (sub === 'hook_response') {
        summary.outcome = m.outcome;
        summary.exit_code = m.exit_code;
        const out = typeof m.output === 'string' ? m.output : '';
        summary.output_chars = out.length;
        if (out.length > 0) {
          summary.output_preview = out.slice(0, 200) + (out.length > 200 ? '…' : '');
        }
      }
      return JSON.stringify(summary, null, 2);
    }
  }
  const full = JSON.stringify(message, null, 2);
  if (full.length <= MAX_LEN) return full;
  return `${full.slice(0, MAX_LEN)}\n... [truncated ${full.length - MAX_LEN} chars]`;
}
import { mainLogger } from './logger.js';
import type { ExtendedSessionMessage } from './task-types.js';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import { buildQueryBaseConfig, resolveClaudeCliPath, type QueryRuntimeContext, type QueryBaseConfig } from './agent-query-config.js';
import type { AppSettings, ModelProfile } from '../services/settings-types.js';
import { appendPermissionAllowRules } from '../services/settings-service.js';
import { createArticleParseMcpServer } from './tools/article-parse-tools.js';
import { getArticleParserSkillsDir } from '../services/article-parser-skills-service.js';
import { syncMarketplacePluginsToConfigDir } from '../services/plugin-bridge-service.js';
import { loadCoreProfileForSession } from '../services/memory/memory-loader.js';
import { buildToolPackGuide } from './tool-pack-guide.js';

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
export interface QueryBasedSessionConfig {
  allowedTools?: string[];           // 允许的工具列表
  mcpServers?: Record<string, any>;  // MCP Server 配置
  systemPrompt?: string;             // 系统提示词
  context?: SessionContext;          // 上下文信息
  workspacePath?: string;            // 工作区路径
  // Skill 配置
  enableSkills?: boolean;            // 是否启用 Skill 功能（默认 false）
  projectRoot?: string;              // 项目根目录（用于查找 .claude/skills/）
  /** 额外的 local plugin 路径（用于工具包附带的 SKILL.md，如 stock-analysis） */
  extraPluginPaths?: string[];
  /**
   * 启用的工具包名称列表（如 ['stock-analysis', 'stock-quote']）。
   * 用于 buildSystemPrompt 注入"工具导览"，告诉 Agent 哪些类目的工具可以通过 Tool Search 搜索。
   */
  enabledToolPacks?: string[];
  resume?: string;                   // SDK session_id（用于恢复会话）
  forkSession?: boolean;             // 是否创建分叉（与 resume 配合使用）
  resumeSessionAt?: string;          // 截断到此 assistant 消息的 SDK UUID
  // 子代理配置
  agents?: Record<string, AgentDefinition>;  // 自定义子代理（通过 Task 工具调用）
  // 人设配置
  personaId?: string;                // 关联的人设 ID
  tempPrompt?: string;               // 对话规则（持久绑定此对话）
  // 会话标题（用于 SDK 0.2.119+ 跳过自动生成，仅新建会话生效，resume 时持久化标题优先）
  title?: string;
  conversationId?: string;           // 所属对话 ID，用于 token 用量采集落盘
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

  // 权限请求等待队列：key=requestId, value={ resolver, originalInput, suggestions, toolName }
  private pendingPermissionRequests: Map<string, {
    resolve: (result: PermissionResult) => void;
    input: Record<string, unknown>;  // 保存原始 input，allow 时需要回传
    suggestions?: import('@anthropic-ai/claude-agent-sdk').PermissionUpdate[];  // SDK 建议的"总是允许"规则
    toolName?: string;  // 工具名，allow_session 时用于构造会话级 addRules
  }> = new Map();

  // 声明式权限规则（从 settings.json 加载，缓存避免每次 canUseTool 都读磁盘）
  private permissionRules?: { allow?: string[]; deny?: string[] };
  // 缓存当前权限模式（start 时从 settings 加载）
  private currentPermissionMode: string = 'default';
  // 缓存当前 tier 和 activeProfile（用于 setModel）
  private currentTier?: 'haiku' | 'sonnet' | 'opus';
  private currentActiveProfile?: ModelProfile;

  // 当前 turn 的进行中消息快照（用于晚加入的渲染层重播）
  // turn 开始时积累，turn 完成（result 消息）时清空
  private currentTurnMessages: ExtendedSessionMessage[] = [];
  // token 用量采集：当前 turn 索引（每次 result 消息后递增）
  private usageTurnIndex = 0;

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
      // 构建运行时上下文（主进程可以直接访问 electron.app）
      const ctx: QueryRuntimeContext = {
        configDir: app.isPackaged
          ? path.join(app.getPath('userData'), '.dogear')
          : path.join(process.cwd(), '.dogear'),
        isPackaged: app.isPackaged,
        cliPath: app.isPackaged ? resolveClaudeCliPath(app.getAppPath()) : undefined,
      };

      // 从 settings.json 加载 AI 配置（通过共享配置层）
      let baseConfig: QueryBaseConfig;
      try {
        baseConfig = await buildQueryBaseConfig(ctx);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error('加载 AI 配置失败:', errorMsg);
        this.emit('sessionError', { error: errorMsg });
        return;
      }

      const { appSettings, activeProfile } = baseConfig;

      // 加载工作区核心档案（buildSystemPrompt 保持同步，异步加载在此处做）
      const coreProfileText = this.config.workspacePath
        ? await loadCoreProfileForSession(this.config.workspacePath)
        : null;

      // 构建系统提示词（需要 appSettings 读取默认提示词与人设）
      const systemPrompt = this.buildSystemPrompt(appSettings, coreProfileText);

      // 获取项目根目录（用于查找 .claude/skills/）
      const projectRoot = await this.getProjectRoot();
      this.logger.info('项目根目录:', projectRoot);

      // 创建持续的消息流
      const messageStream = this.createMessageStream();

      // 构建 query 配置，注入共享配置
      const queryOptions: Record<string, any> = {
        systemPrompt,
        includePartialMessages: true,  // 启用流式消息事件（SDKPartialAssistantMessage）
        // 注入共享配置
        env: baseConfig.env,
        effort: baseConfig.effort,
        // Opus 4.7 默认 display='omitted'。用户可在设置中切换 summarized/omitted
        thinking: { type: 'adaptive', display: appSettings.ai.thinkingDisplay ?? 'summarized' },
        ...(baseConfig.pathToClaudeCodeExecutable && {
          pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
        }),
      };

      // 注入默认权限模式
      this.currentPermissionMode = baseConfig.permissionMode;
      queryOptions.permissionMode = this.currentPermissionMode;

      // SDK 0.2.119+：excludeDynamicSections 把环境上下文移到首条 user message，提升缓存命中率
      // 默认开启，用户可在设置中关闭
      if (appSettings.ai.excludeDynamicSections !== false) {
        queryOptions.excludeDynamicSections = true;
      }

      // SDK 0.2.119+：promptSuggestions 在每轮结束后产出一条 SDKPromptSuggestionMessage
      // 默认开启，用户可在设置中关闭
      if (appSettings.ai.promptSuggestionsEnabled !== false) {
        queryOptions.promptSuggestions = true;
      }

      // 自动压缩：永远启用（关闭会爆窗），1M 模式下阈值设为 900K（留 100K 缓冲给最后几轮 messages）
      queryOptions.autoCompactEnabled = true;
      if (baseConfig.activeProfile.enable1MContext) {
        queryOptions.autoCompactWindow = 900_000;
        this.logger.info('已启用 1M 长上下文模式 (autoCompactWindow=900000)');
      }

      // 缓存 activeProfile 供 setModel 使用
      this.currentActiveProfile = baseConfig.activeProfile;

      // 缓存声明式权限规则
      if (baseConfig.permissionRules) {
        this.permissionRules = baseConfig.permissionRules;
        this.logger.info('已加载权限规则:', this.permissionRules);
      }

      // 注入 maxTurns
      if (baseConfig.maxTurns) {
        queryOptions.maxTurns = baseConfig.maxTurns;
        this.logger.info('已配置 maxTurns:', queryOptions.maxTurns);
      }

      this.logger.info('已从 settings.json 加载 AI 配置:', {
        effort: appSettings.ai.effort,
        profileName: activeProfile.name,
      });

      const allowedTools = this.config.allowedTools || ['Read', 'Glob', 'Grep', 'AskUserQuestion', 'Agent'];
      queryOptions.allowedTools = allowedTools;

      // 收集要走 flag-settings 层的字段（permissions + enabledPlugins）
      // 这里只是先攒着，后面统一写到一个 JSON 文件里，把 file path 交给 SDK 的 `settings` 选项。
      // 为什么不直接用 inline object：实测 sdk.mjs:255661 inline 对象不会被 JSON 序列化，
      // 会被 child_process.spawn 转成 `[object Object]` 而失效；必须传文件路径。
      const flagSettings: Record<string, unknown> = {};
      if (this.permissionRules && (
        this.permissionRules.allow?.length ||
        this.permissionRules.deny?.length ||
        (this.permissionRules as any).ask?.length
      )) {
        flagSettings.permissions = {
          ...(this.permissionRules.allow?.length && { allow: this.permissionRules.allow }),
          ...(this.permissionRules.deny?.length && { deny: this.permissionRules.deny }),
          ...((this.permissionRules as any).ask?.length && { ask: (this.permissionRules as any).ask }),
        };
        this.logger.info('已收集声明式权限规则到 flag-settings:', flagSettings.permissions);
      }

      // 配置 MCP Servers：始终挂载 article-parse 服务，并合并调用方传入的额外 servers
      queryOptions.mcpServers = {
        'dogear-article-parse': createArticleParseMcpServer(),
        ...(this.config.mcpServers || {}),
      };
      this.logger.info('已配置 MCP Servers:', Object.keys(queryOptions.mcpServers));

      // 配置 Skill 插件：article-parser 常驻 + 按需启用的额外 plugin（如 stock-analysis）
      // 注意：市场订阅的插件（superpowers 等）由 SDK 通过 settingSources 自动读取 enabledPlugins 处理，不在此手动注入
      const extraPluginPaths = this.config.extraPluginPaths ?? [];
      queryOptions.plugins = [
        { type: 'local' as const, path: getArticleParserSkillsDir() },
        ...extraPluginPaths.map((p) => ({ type: 'local' as const, path: p })),
      ];
      this.logger.info('已配置 Skill 插件:', queryOptions.plugins.map((p: { path: string }) => p.path));

      // 配置工作目录：cwd 使用用户选择的工作区路径，这样 agent 的工作上下文是用户的工作区
      if (this.config.workspacePath) {
        queryOptions.cwd = this.config.workspacePath;
        this.logger.info('已配置 cwd 为用户工作区:', this.config.workspacePath);
      }

      if (this.config.enableSkills && projectRoot) {
        // 固定加载 user + project + local 三个源，不暴露给用户配置
        // - user: ~/.claude/settings.json（用户级 enabledPlugins，如 frontend-design/skill-creator）
        // - project: <cwd>/.claude/settings.json（项目级共享配置）
        // - local: <cwd>/.claude/settings.local.json（项目级私有 enabledPlugins，如 superpowers）
        queryOptions.settingSources = ['user', 'project', 'local'];
        this.logger.info('已配置 settingSources 以加载 Skills');
      }

      // 配置 resume（恢复之前的会话）
      if (this.config.resume) {
        queryOptions.resume = this.config.resume;
        this.logger.info('✅ 已配置 resume 会话:', this.config.resume);
      } else {
        this.logger.info('创建新会话（无 resume）');
        // 仅新建会话时传入 title，跳过 SDK 自动生成（省一次 LLM 调用）
        // resume 时 SDK 会使用持久化的 title，此处不传
        const sessionTitle = this.config.title?.trim() || '新对话';
        queryOptions.title = sessionTitle;
        this.logger.info('已配置 title（跳过 SDK 自动生成）:', sessionTitle);
      }

      // 配置 forkSession（分叉会话）
      if (this.config.forkSession) {
        queryOptions.forkSession = true;
        this.logger.info('✅ 已配置 forkSession: 将创建新的会话分支');
      }

      // 配置 resumeSessionAt（截断位置）
      if (this.config.resumeSessionAt) {
        queryOptions.resumeSessionAt = this.config.resumeSessionAt;
        this.logger.info('✅ 已配置 resumeSessionAt:', this.config.resumeSessionAt, '| forkSession:', !!this.config.forkSession);
        console.log('[Fork] resumeSessionAt:', this.config.resumeSessionAt, 'forkSession:', this.config.forkSession);
      }

      this.logger.info('已从 settings Profile 构建 env:', {
        profileName: activeProfile.name,
        baseUrl: activeProfile.baseUrl,
        haikuModel: activeProfile.haikuModel,
        sonnetModel: activeProfile.sonnetModel,
        opusModel: activeProfile.opusModel,
        apiTimeoutMs: activeProfile.apiTimeoutMs,
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

        // 通用权限请求：发送事件到前端（含 SDK 提供的 suggestions，供"总是允许"使用）
        this.emit('permissionRequest', {
          requestId,
          toolName,
          toolInput: input,
          decisionReason: options.decisionReason,
          hasSuggestions: !!options.suggestions?.length,  // 告知前端是否可以"总是允许"
        });

        // 等待前端用户响应
        return new Promise<PermissionResult>((resolve) => {
          this.pendingPermissionRequests.set(requestId, { resolve, input, suggestions: options.suggestions, toolName });

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
            if (ctx?.selectedText) additionalContext += `用户选中的文本: ${ctx.selectedText}\n`;
          } else if (source === 'compact') {
            additionalContext = '注意：会话已经过压缩，部分上下文可能丢失。';
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

      // ==================== 市场插件桥接 + flag-settings 落盘 ====================
      // 1. 桥接 installed_plugins.json 到 CLAUDE_CONFIG_DIR（SDK 字面读取）
      // 2. 把 permissions + enabledPlugins 合并写入 flag-settings.json，路径作为 --settings 传给 SDK
      //    （sdk.mjs:255661 实测 inline object 不被 JSON 序列化会变 [object Object]，必须用文件路径）
      const claudeConfigDir = baseConfig.env.CLAUDE_CONFIG_DIR;
      try {
        if (claudeConfigDir) {
          const bridgeResult = await syncMarketplacePluginsToConfigDir(
            claudeConfigDir,
            this.config.workspacePath,
          );
          const enabledKeys = Object.keys(bridgeResult.enabledPlugins);
          this.logger.info('已桥接市场插件元数据:', {
            pluginCount: bridgeResult.pluginCount,
            enabledKeys,
          });
          if (enabledKeys.length > 0) {
            flagSettings.enabledPlugins = bridgeResult.enabledPlugins;
          }
        }
      } catch (bridgeErr) {
        this.logger.warn('桥接市场插件元数据失败（不影响主流程）:', bridgeErr);
      }

      if (Object.keys(flagSettings).length > 0 && claudeConfigDir) {
        try {
          const flagSettingsPath = path.join(claudeConfigDir, 'flag-settings.json');
          await fs.writeFile(flagSettingsPath, JSON.stringify(flagSettings, null, 2), 'utf-8');
          queryOptions.settings = flagSettingsPath;
          this.logger.info('已写入 flag-settings 并通过 --settings <file> 注入:', {
            path: flagSettingsPath,
            keys: Object.keys(flagSettings),
          });
        } catch (writeErr) {
          this.logger.warn('写入 flag-settings.json 失败（不影响主流程）:', writeErr);
        }
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
      this.logger.info('  • CLAUDE_CONFIG_DIR:', queryOptions.env?.CLAUDE_CONFIG_DIR || '(未设置)');
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
      this.logger.info('  • 模式: preset + append');
      this.logger.info('  • preset:', systemPrompt.preset);
      this.logger.info('  • append 长度:', systemPrompt.append.length, '字符');
      this.logger.info('  • coreProfile 已注入:', !!coreProfileText, coreProfileText?.length ?? 0, '字符');
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
  async sendMessage(content: string | ContentBlockParam[]): Promise<void> {
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
          this.logger.info('原始数据:', formatSdkMessageForLog(message));
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
            // 缓存当前 turn 的消息（重播消息不缓存，历史由 loadHistory 负责）
            if (!extendedMessage.isReplay) {
              this.currentTurnMessages.push(extendedMessage);
            }
            this.emit('message', extendedMessage);
          }
        }

        // SDK 0.2.119+：下一步建议消息（每轮 result 之后最多一条）
        if ((message as any).type === 'prompt_suggestion') {
          const suggestion = (message as any).suggestion;
          this.logger.info('💡 收到 prompt_suggestion:', suggestion);
          if (typeof suggestion === 'string' && suggestion.trim()) {
            this.emit('message', {
              type: 'prompt_suggestion',
              suggestion,
              timestamp: Date.now(),
            } as ExtendedSessionMessage);
          }
          continue;
        }

        // 处理结果消息（单次对话完成）
        if (message.type === 'result') {
          // SDK 0.2.119+ 提供 terminal_reason，优先使用它分类；缺失时回退到 subtype 判断
          const terminalReason = (message as { terminal_reason?: string }).terminal_reason;
          this.logger.info('=== 收到结果消息 ===', {
            subtype: message.subtype,
            is_error: message.is_error,
            terminal_reason: terminalReason || '(未提供)',
            totalMessages: messageCount,
            replayMessages: replayCount
          });

          // —— token 用量采集（fire-and-forget，绝不影响主流程）——
          try {
            const convId = this.config.conversationId;
            if (convId) {
              const entry = extractUsageEntry(
                message,
                this.currentTurnMessages,
                this.usageTurnIndex,
                this.currentActiveProfile?.opusModel,
              );
              this.usageTurnIndex += 1;
              this.emit('usage', { conversationId: convId, entry });
            }
          } catch (err) {
            this.logger.warn('用量采集失败（忽略）:', err);
          }

          // 分类决策：优先 terminal_reason，兜底用旧的 subtype + is_error
          // 分类结果：'complete' | 'interrupted' | 'max_turns' | 'rate_limited' | 'error'
          let category: 'complete' | 'interrupted' | 'max_turns' | 'rate_limited' | 'error';
          let errorDetail: string | undefined;

          if (terminalReason) {
            switch (terminalReason) {
              case 'completed':
                category = 'complete';
                break;
              case 'aborted_streaming':
              case 'aborted_tools':
                category = 'interrupted';
                break;
              case 'max_turns':
                category = 'max_turns';
                break;
              case 'blocking_limit':
              case 'rapid_refill_breaker':
                category = 'rate_limited';
                errorDetail = terminalReason;
                break;
              default:
                // prompt_too_long / image_error / model_error / stop_hook_prevented / hook_stopped / tool_deferred
                category = 'error';
                errorDetail = terminalReason;
            }
          } else {
            // 兜底：旧的 subtype + is_error 判断（保持升级前行为兼容）
            if (message.subtype === 'success') {
              category = 'complete';
            } else {
              const errorMsg = message as { errors?: string[]; is_error?: boolean };
              const hasErrors = errorMsg.errors && errorMsg.errors.length > 0;
              if (!errorMsg.is_error && !hasErrors) {
                category = 'interrupted'; // 用户中断的典型特征
              } else {
                category = 'error';
                errorDetail = errorMsg.errors?.join(', ') || '未知错误';
              }
            }
          }

          // 按分类分发事件
          // - complete / interrupted / max_turns: 统一走 'complete'（会话正常结束流），附加 terminal_reason 供前端差异化提示
          // - rate_limited / error: 走 'error'
          if (category === 'complete' || category === 'interrupted' || category === 'max_turns') {
            this.currentTurnMessages = [];  // turn 完成/中断/达上限均清空快照
            // 把 terminal_reason 和分类附加到 message 上，前端可用于 UI 差异化
            const enriched = {
              ...message,
              terminal_reason: terminalReason,
              terminalCategory: category, // 'complete' | 'interrupted' | 'max_turns'
            };
            this.logger.info(`会话结束（${category}）`, terminalReason ? `terminal_reason=${terminalReason}` : '');
            this.emit('complete', enriched);
            this.status = SessionStatus.IDLE;
          } else {
            this.currentTurnMessages = [];  // rate_limited / error 同样结束本轮，清空快照避免污染下一轮工具计数
            // rate_limited / error：作为错误事件发送
            this.emit('error', {
              type: 'error',
              error: errorDetail || '未知错误',
              terminal_reason: terminalReason,
              terminalCategory: category, // 'rate_limited' | 'error'
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

            // 检测到 Agent/Task 工具调用，发射 subAgentStarted 事件
            if (isSubAgentToolName(block.name)) {
              this.emit('subAgentStarted', {
                parentSessionId: this.sessionId,
                agentId: block.id,  // 此时用 toolUseId 作为临时标识
                description: '',    // input 尚未到达，description 留空
                subagentType: undefined,
              });
            }

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
            let toolInput: Record<string, any> = {};
            try {
              if (pending.inputJson) {
                toolInput = JSON.parse(pending.inputJson);
              }
            } catch (e) {
              this.logger.warn('解析工具输入 JSON 失败:', pending.inputJson);
            }

            // 清除累积器
            this.pendingToolInputs.delete(index);

            // Agent/Task 工具 input 已完整解析，补发带 description 的 subAgentStarted 事件
            if (isSubAgentToolName(pending.name) && pending.toolUseId) {
              this.emit('subAgentStarted', {
                parentSessionId: this.sessionId,
                agentId: pending.toolUseId,
                description: toolInput.description || toolInput.prompt || '',
                subagentType: toolInput.subagent_type,
              });
            }

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

        // 子代理任务开始
        if (sdkMessage.subtype === 'task_started') {
          const taskMsg = sdkMessage as any;
          this.logger.info('子代理任务开始:', taskMsg.task_id, taskMsg.description);
          return {
            type: 'task_notification',
            taskId: taskMsg.task_id,
            taskStatus: 'started',
            taskSummary: taskMsg.description,
            toolUseId: taskMsg.tool_use_id,
            timestamp,
          };
        }

        // 子代理任务进度
        if (sdkMessage.subtype === 'task_progress') {
          const taskMsg = sdkMessage as any;
          this.logger.info('子代理任务进度:', taskMsg.task_id, taskMsg.summary || taskMsg.description);
          return {
            type: 'task_notification',
            taskId: taskMsg.task_id,
            taskStatus: 'in_progress',
            taskSummary: taskMsg.summary || taskMsg.description,
            toolUseId: taskMsg.tool_use_id,
            timestamp,
          };
        }

        // 子代理任务完成通知
        if (sdkMessage.subtype === 'task_notification') {
          const taskMsg = sdkMessage as any;
          this.logger.info('子代理任务完成:', taskMsg.task_id, taskMsg.status);
          return {
            type: 'task_notification',
            taskId: taskMsg.task_id,
            taskStatus: taskMsg.status,
            taskSummary: taskMsg.summary,
            toolUseId: taskMsg.tool_use_id,
            timestamp,
          };
        }

        // 对话压缩分隔线（/compact 或自动压缩完成后）
        if (sdkMessage.subtype === 'compact_boundary') {
          const compactMsg = sdkMessage as any;
          const metadata = compactMsg.compact_metadata || {};
          this.logger.info('对话压缩完成:', metadata.trigger, '压缩前 tokens:', metadata.pre_tokens);
          const convId = this.config.conversationId;
          if (convId) {
            const marker: CompactMarker = {
              uuid: uuidv4(),
              timestamp,
              afterTurnIndex: this.usageTurnIndex,
              trigger: metadata.trigger === 'manual' ? 'manual' : 'auto',
              preTokens: metadata.pre_tokens ?? 0,
            };
            this.emit('compactMarker', { conversationId: convId, marker });
          }
          return {
            type: 'compact_boundary',
            compactTrigger: metadata.trigger,
            compactPreTokens: metadata.pre_tokens,
            timestamp,
          };
        }

        // status 消息：压缩中 / 权限模式变更
        if (sdkMessage.subtype === 'status') {
          const statusMsg = sdkMessage as { status?: string; permissionMode?: string };

          if (statusMsg.status === 'compacting') {
            this.logger.info('对话正在压缩...');
            return {
              type: 'compacting',
              timestamp,
            };
          }

          // AI 调用 ExitPlanMode 等工具后，SDK 推送带 permissionMode 的 status 消息
          // 复用 setPermissionMode 链路（会 emit permissionModeChanged 事件）让前端 UI 自动同步
          // 去重不可删：setPermissionMode 内部同步赋值 currentPermissionMode，回环第二轮在此被拦截
          if (typeof statusMsg.permissionMode === 'string' && statusMsg.permissionMode !== this.currentPermissionMode) {
            this.logger.info('SDK status 推送 permissionMode 变更:', statusMsg.permissionMode);
            this.setPermissionMode(statusMsg.permissionMode as PermissionMode).catch((e) =>
              this.logger.warn('同步 SDK 推送的 permissionMode 失败:', e)
            );
            return null;
          }

          return null;
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

        this.logger.info('未识别的 system subtype:', sdkMessage.subtype);
        return null;
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

                // 检查是否携带子代理元数据（Agent 工具的 tool_use_result）
                const tur = (userMsg as any).tool_use_result;
                const subAgentMeta: Partial<ExtendedSessionMessage> = {};
                if (tur?.agentId) {
                  this.logger.info('检测到子代理结果:', tur.agentId, '状态:', tur.status);
                  subAgentMeta.subAgentId = tur.agentId;
                  subAgentMeta.subAgentStatus = tur.status;
                  subAgentMeta.subAgentDurationMs = tur.totalDurationMs;
                  subAgentMeta.subAgentTokens = tur.totalTokens;
                  subAgentMeta.subAgentToolUseCount = tur.totalToolUseCount;
                  // 提取子代理返回的文本
                  if (Array.isArray(tur.content)) {
                    subAgentMeta.subAgentResultText = tur.content
                      .filter((c: any) => c?.type === 'text')
                      .map((c: any) => c.text)
                      .join('\n');
                  }

                  // 发射 subAgentCompleted 事件，通知子代理运行完成
                  this.emit('subAgentCompleted', {
                    parentSessionId: this.sessionId,
                    agentId: tur.agentId,
                    status: tur.status || 'completed',
                    durationMs: tur.totalDurationMs,
                    tokens: tur.totalTokens,
                    toolUseCount: tur.totalToolUseCount,
                    resultText: subAgentMeta.subAgentResultText,
                  });
                }

                toolResults.push({
                  type: 'tool_result',
                  toolUseId: toolResult.tool_use_id,
                  toolOutput: outputContent,
                  isError: toolResult.is_error || false,
                  timestamp,
                  isReplay,
                  ...subAgentMeta,
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

    // 生产环境：使用 AppData/Roaming/Dogear
    if (app.isPackaged) {
      const root = app.getPath('userData');
      this.logger.info('打包环境项目根目录:', root);
      return root;
    }

    // 开发环境：向上查找包含 .claude 目录的父目录
    const currentDir = process.cwd();
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

    this.logger.warn('无法自动确定项目根目录，请在配置中指定 projectRoot');
    return undefined;
  }

  /**
   * 构建系统提示词
   * 统一使用 SDK 的 preset + append 模式
   * append 组成顺序：默认提示词 → 人设 → 对话规则 → 工作区用户画像
   *
   * coreProfileText 由 start() 提前 await 加载后传入，保持本方法同步。
   */
  private buildSystemPrompt(
    appSettings: AppSettings,
    coreProfileText: string | null,
  ): { type: 'preset'; preset: 'claude_code'; append: string } {
    const parts: string[] = [];

    // 1. 全局默认系统提示词（由设置页面管理，不在此处硬编码 fallback）
    if (appSettings.ai.defaultSystemPrompt) {
      parts.push(appSettings.ai.defaultSystemPrompt);
    }

    // 2. 人设 prompt
    if (this.config.personaId && appSettings.personas) {
      const persona = appSettings.personas.find(p => p.id === this.config.personaId);
      if (persona) {
        parts.push(`\n## 人设\n${persona.prompt}`);
      }
    }

    // 3. 对话规则（持久绑定此对话）
    if (this.config.tempPrompt) {
      parts.push(`\n## 额外指令\n${this.config.tempPrompt}`);
    }

    // 4. 工作区用户画像（core-profile.md，由 memory-loader 预格式化好）
    if (coreProfileText) {
      parts.push(coreProfileText);
    }

    // 5. Tool Search 工具导览（告诉 Agent 哪些类目的工具可以搜）
    // SDK 默认开启 ENABLE_TOOL_SEARCH，MCP 工具完整 schema 不进上下文，
    // 这段导览帮助 Agent 知道"有什么类目可搜"，提升工具选择命中率。
    const enabledPacks = this.config.enabledToolPacks ?? [];
    const hasWorkspace = !!this.config.workspacePath;
    const guide = buildToolPackGuide(enabledPacks, hasWorkspace);
    if (guide) {
      parts.push(guide);
    }

    return { type: 'preset', preset: 'claude_code', append: parts.join('\n') };
  }

  /**
   * 清理所有子代理 tail 监听（预留，tail 功能在后续任务中实现）
   */
  private cleanupSubAgentTails(): void {
    // 预留：后续 tail 实现时在此清理 setInterval 定时器
  }

  /**
   * 关闭会话
   * 调用 SDK Query 的 close() 方法优雅终止底层 CLI 子进程和 transport 流，
   * 避免快速切换对话时产生 ERR_STREAM_WRITE_AFTER_END 错误。
   */
  close(): void {
    this.logger.info('关闭会话:', this.sessionId);

    // 清理子代理 tail 监听
    this.cleanupSubAgentTails();

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
    this.currentPermissionMode = mode;
    await this.query.setPermissionMode(mode);
    // 通知前端权限模式已变更（双向同步）
    this.emit('permissionModeChanged', { mode });
  }

  /**
   * 获取当前 turn 的进行中消息快照（晚进来的渲染层用于重播）
   */
  getCurrentTurnSnapshot(): ExtendedSessionMessage[] {
    return [...this.currentTurnMessages];
  }

  getPermissionMode(): string {
    return this.currentPermissionMode;
  }

  /**
   * 响应权限确认请求
   * 由前端用户点击允许/拒绝/总是允许后调用
   *
   * behavior:
   * - 'allow': 本次允许
   * - 'allow_session': 本次允许 + 仅在当前会话进程内放行该工具（不写磁盘）
   * - 'always_allow': 本次允许 + 将 SDK suggestions 作为 updatedPermissions 返回 + 持久化到 settings
   * - 'deny': 拒绝
   */
  respondPermissionRequest(requestId: string, behavior: 'allow' | 'deny' | 'always_allow' | 'allow_session', message?: string, updatedInput?: Record<string, unknown>): void {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (!pending) {
      this.logger.warn('respondPermissionRequest: 找不到请求:', requestId);
      return;
    }
    this.pendingPermissionRequests.delete(requestId);
    this.logger.info('权限确认响应:', { requestId, behavior });

    if (behavior === 'allow' || behavior === 'always_allow' || behavior === 'allow_session') {
      const result: PermissionResult = {
        behavior: 'allow',
        updatedInput: updatedInput || pending.input,
      };
      if (behavior === 'always_allow' && pending.suggestions?.length) {
        // 本次会话立即生效（SDK 在 query 进程内记住）
        result.updatedPermissions = pending.suggestions;
        // 持久化到 AppSettings.permissionRules.allow，跨会话保留
        // suggestions 是 PermissionUpdate[]，需要解构内部的 rules（仅 addRules + allow 走持久化）
        const ruleStrings = pending.suggestions
          .flatMap((upd) => {
            if (upd.type !== 'addRules' || upd.behavior !== 'allow') return [];
            return upd.rules.map((rv) =>
              rv.ruleContent ? `${rv.toolName}(${rv.ruleContent})` : rv.toolName
            );
          })
          .filter((s): s is string => typeof s === 'string' && s.length > 0);
        if (ruleStrings.length) {
          appendPermissionAllowRules(ruleStrings).catch((e) =>
            this.logger.warn('持久化 always_allow 规则失败:', e)
          );
          this.logger.info('已持久化 always_allow 规则:', ruleStrings);
        }
      } else if (behavior === 'allow_session' && pending.toolName) {
        // 仅当前会话进程内放行：destination=session，不写磁盘
        result.updatedPermissions = [{
          type: 'addRules',
          rules: [{ toolName: pending.toolName }],
          behavior: 'allow',
          destination: 'session',
        }];
        this.logger.info('已添加会话级放行规则:', pending.toolName);
      }
      pending.resolve(result);
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
   * 切换模型 tier（haiku/sonnet/opus），传 undefined 则恢复默认
   * 返回实际生效的 modelStr，供调用方发 /model 命令到会话历史
   */
  async setModel(tier?: 'haiku' | 'sonnet' | 'opus'): Promise<{ modelStr?: string }> {
    if (!this.query) {
      this.logger.warn('setModel: 没有活跃的 query');
      return {};
    }

    let modelStr: string | undefined = undefined;
    if (tier) {
      const profile = this.currentActiveProfile;
      if (!profile) {
        this.logger.warn('setModel: currentActiveProfile 未初始化');
        return {};
      }
      const tierMap = {
        haiku: profile.haikuModel,
        sonnet: profile.sonnetModel,
        opus: profile.opusModel,
      };
      modelStr = tierMap[tier];
    }

    this.logger.info(`setModel: tier=${tier}, modelStr=${modelStr}`);
    await this.query.setModel(modelStr);
    this.currentTier = tier;

    return { modelStr };
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
// 广播函数类型：将 session 事件发给所有渲染层窗口
type SessionBroadcaster = (sessionId: string, event: 'message' | 'complete' | 'error', payload: unknown) => void;

/**
 * 活跃会话超出上限时抛出的错误
 * 调用方（tipc handler / runtime service）需捕获并返回友好错误
 */
export class SessionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionLimitError';
  }
}

function broadcastUsageEntryAdded(conversationId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      getRendererHandlers<RendererHandlers>(win.webContents).usageEntryAdded.send({ conversationId });
    } catch {
      // 单窗口失败不影响其他窗口
    }
  }
}

export class QueryBasedSessionManager extends EventEmitter {
  /**
   * 活跃会话上限（里程碑 1.5 Phase 2 Step A2.1）
   * 每个对话占一个 session，避免用户累积过多 SDK 子进程消耗资源
   */
  static readonly MAX_ACTIVE_SESSIONS = 10;

  private sessions: Map<string, QueryBasedSession> = new Map();
  // 引用计数：记录每个 session 有多少个持有者（渲染层标签页 + bot 各算一个）
  private refCounts: Map<string, number> = new Map();
  // 每个 session 关联的外部清理函数（如 agent.ts 注册的 sessionMessage 监听器）
  private cleanupCallbacks: Map<string, Array<() => void>> = new Map();
  // conversationId → sessionId 映射（bot 绑定时注册,渲染层打开时复用）
  private conversationSessionMap: Map<string, string> = new Map();
  // 广播函数：由 agent.ts 初始化时注册，负责把事件发给所有渲染层
  private broadcaster: SessionBroadcaster | null = null;
  private logger = mainLogger.child('query-session-manager');

  /**
   * 注册广播函数（应用启动时由 agent.ts 调用一次）
   */
  setBroadcaster(fn: SessionBroadcaster): void {
    this.broadcaster = fn;
  }

  /**
   * 创建新会话，初始引用计数为 1（创建者持有）
   * 达到 MAX_ACTIVE_SESSIONS 时抛出 SessionLimitError，调用方需捕获并给出用户提示
   */
  createSession(config: QueryBasedSessionConfig): QueryBasedSession {
    if (this.sessions.size >= QueryBasedSessionManager.MAX_ACTIVE_SESSIONS) {
      throw new SessionLimitError(
        `活跃会话已达到上限 ${QueryBasedSessionManager.MAX_ACTIVE_SESSIONS} 个，请关闭一些会话后再试`
      );
    }

    const sessionId = uuidv4();
    this.logger.info('创建基于 Query 的会话:', sessionId.substring(0, 8));

    const session = new QueryBasedSession(sessionId, config);

    // 转发会话事件到 sessionManager（内部路由）+ 广播到渲染层
    session.on('message', (message) => {
      this.emit('sessionMessage', sessionId, message);
      this.broadcaster?.(sessionId, 'message', message);
    });

    session.on('tool_use', (message) => {
      this.emit('sessionMessage', sessionId, message);
      this.broadcaster?.(sessionId, 'message', message);
    });

    session.on('error', (message) => {
      this.emit('sessionError', sessionId, message);
      this.broadcaster?.(sessionId, 'error', message);
    });

    session.on('complete', (result) => {
      this.emit('sessionComplete', sessionId, result);
      this.broadcaster?.(sessionId, 'complete', result);
    });

    session.on('usage', ({ conversationId, entry }: { conversationId?: string; entry: ConversationUsageEntry }) => {
      if (!conversationId) return;
      appendUsageEntry(conversationId, entry).catch(() => {});
      broadcastUsageEntryAdded(conversationId);
    });

    session.on('compactMarker', ({ conversationId, marker }: { conversationId?: string; marker: CompactMarker }) => {
      if (!conversationId) return;
      appendUsageCompactMarker(conversationId, marker).catch(() => {});
    });

    this.sessions.set(sessionId, session);
    this.refCounts.set(sessionId, 1);

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): QueryBasedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 增加引用计数（新的持有者进入）
   * @returns 当前引用计数，session 不存在返回 0
   */
  retain(sessionId: string): number {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return 0;
    const next = count + 1;
    this.refCounts.set(sessionId, next);
    this.logger.info(`retain session ${sessionId.substring(0, 8)}: refCount=${next}`);
    return next;
  }

  /**
   * 减少引用计数（持有者离开）
   * 引用计数归零时自动销毁 session
   * @returns 剩余引用计数
   */
  release(sessionId: string): number {
    const count = this.refCounts.get(sessionId);
    if (count === undefined) return 0;
    const next = count - 1;
    if (next <= 0) {
      // 最后一个持有者离开，真正销毁
      this.logger.info(`release session ${sessionId.substring(0, 8)}: refCount=0, closing`);
      this._destroySession(sessionId);
      return 0;
    }
    this.refCounts.set(sessionId, next);
    this.logger.info(`release session ${sessionId.substring(0, 8)}: refCount=${next}`);
    return next;
  }

  /**
   * 直接关闭会话（忽略引用计数，用于强制清理）
   */
  closeSession(sessionId: string): void {
    this._destroySession(sessionId);
  }

  /**
   * 将 conversationId 与 sessionId 绑定（bot syncSession 时调用）
   * 渲染层打开同一对话时可以复用已有 session 而不新建
   */
  bindConversation(conversationId: string, sessionId: string): void {
    this.conversationSessionMap.set(conversationId, sessionId);
  }

  /**
   * 解除 conversationId 绑定（session 销毁或 bot 切走时调用）
   */
  unbindConversation(conversationId: string): void {
    this.conversationSessionMap.delete(conversationId);
  }

  /**
   * 查找 conversationId 当前绑定的 sessionId（不存在返回 undefined）
   */
  getSessionIdByConversation(conversationId: string): string | undefined {
    const sessionId = this.conversationSessionMap.get(conversationId);
    // 确认 session 仍然存活
    if (sessionId && this.sessions.has(sessionId)) return sessionId;
    if (sessionId) this.conversationSessionMap.delete(conversationId); // 清理失效映射
    return undefined;
  }

  /**
   * 根据 sessionId 反查绑定的 conversationId（运行状态广播需要）
   */
  getConversationIdBySession(sessionId: string): string | undefined {
    for (const [convId, sid] of this.conversationSessionMap) {
      if (sid === sessionId) return convId;
    }
    return undefined;
  }

  /**
   * 注册 session 销毁时的清理回调（如外部注册的事件监听器）
   */
  registerCleanup(sessionId: string, fn: () => void): void {
    const list = this.cleanupCallbacks.get(sessionId) ?? [];
    list.push(fn);
    this.cleanupCallbacks.set(sessionId, list);
  }

  private _destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // 先执行外部注册的清理回调
      const cleanups = this.cleanupCallbacks.get(sessionId) ?? [];
      for (const fn of cleanups) {
        try { fn(); } catch { /* 忽略清理错误 */ }
      }
      this.cleanupCallbacks.delete(sessionId);

      // 清理 conversationId 映射（如果该 session 还在映射中）
      for (const [convId, sid] of this.conversationSessionMap) {
        if (sid === sessionId) this.conversationSessionMap.delete(convId);
      }
      session.close();
      this.sessions.delete(sessionId);
      this.refCounts.delete(sessionId);
      this.logger.info('基于 Query 的会话已关闭:', sessionId.substring(0, 8));
    }
  }

  /**
   * 关闭所有会话
   */
  closeAll(): void {
    this.logger.info('关闭所有基于 Query 的会话...');
    for (const [_sessionId, cleanups] of this.cleanupCallbacks) {
      for (const fn of cleanups) { try { fn(); } catch { /* 忽略 */ } }
    }
    this.cleanupCallbacks.clear();
    this.conversationSessionMap.clear();
    this.sessions.forEach(session => session.close());
    this.sessions.clear();
    this.refCounts.clear();
  }

  /**
   * 获取活跃会话数量
   */
  getActiveCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取会话引用计数（调试用）
   */
  getRefCount(sessionId: string): number {
    return this.refCounts.get(sessionId) ?? 0;
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
