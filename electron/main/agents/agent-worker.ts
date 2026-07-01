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
import path from 'node:path';
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
import type { ModelTier, ModelProfile } from '../services/settings-types.js';

/**
 * Agent Worker 类
 */
class AgentWorker {
  private workerId: string;
  private currentTask: AgentTask | null = null;
  private currentAbortController: AbortController | null = null;
  private messagePort: any = null;
  private isReady = false;
  private logger = workerLogger;

  // v2: 工作区路径配置
  private workspacePath: string = '';

  // Phase 0: 共享 query 配置所需的运行时上下文
  private configDir: string = '';
  private isPackaged: boolean = false;
  private cliPath?: string;

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
      this.workspacePath = config.workspacePath || '';
      this.logger.info('工作区路径:', this.workspacePath);

      // Phase 0: 保存共享 query 配置的运行时上下文
      this.configDir = config.configDir;
      this.isPackaged = config.isPackaged;
      this.cliPath = config.cliPath;
      this.logger.info('配置目录:', this.configDir, '| 打包环境:', this.isPackaged);

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
          // 会话任务不阻塞 Worker,可以立即返回
          this.currentTask = null;  // 立即清空,允许处理其他任务
          this.handleChatSessionTask(task, taskLogger);
          return;  // 提前返回,不发送完成状态

        case TaskType.SUMMARIZE:
          result = await this.handleSummarizeTask(task, taskLogger);
          break;

        case TaskType.READING_ASSIST:
          result = await this.handleReadingAssistTask(task, taskLogger);
          break;

        case TaskType.PARSE_ARTICLE:
          result = await this.handleParseArticleTask(task, taskLogger);
          break;

        case TaskType.GROUP_DIGEST_SESSION:
          result = await this.handleGroupDigestTask(task, taskLogger);
          break;

        case TaskType.REVIEW_SESSION:
          result = await this.handleReviewSessionTask(task, taskLogger);
          break;

        case TaskType.CATEGORIZE_SESSION:
          result = await this.handleCategorizeSessionTask(task, taskLogger);
          break;

        default:
          throw new Error(`未知任务类型: ${task.type}`);
      }

      // 任务完成（若期间被 cancelTask 取消，currentTask 已被清空且已发过 CANCELLED，跳过重复通知）
      const cancelledDuringRun = this.currentTask?.id !== task.id;
      this.currentTask = null;
      if (!cancelledDuringRun) {
        taskLogger.info('任务完成');
        this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, result);
      }

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

      // 允许访问工作区目录
      additionalDirectories: this.workspacePath ? [this.workspacePath] : undefined,

      // 允许使用基础工具
      allowedTools: ['Read', 'Glob', 'Grep'],

      // 注意：不再设置 onMessage 回调，改用 session.on('message') 事件
      // 这样可以避免重复发送消息
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

    // 注册会话事件（只通过事件监听器发送消息，避免重复）
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
   * 处理文章解析任务（V2：Skill 驱动解析系统）
   *
   * 流程：
   * - 加载 article-parser Skill（plugins: [{ type: 'local', path: skillsDir }]）
   * - AI 按 SKILL.md 定义的调试循环工作
   * - trigger 说明触发原因（script_failed / parse_failed / user_requested）
   *
   * 产出：
   * - 若有改进：通过 SaveParsedArticle 覆盖 meta.json / content.md
   * - 若发现新平台脚本模式：通过 UpdatePlatformScript 更新 platforms/<platform>.py
   * - history.jsonl 追加一行解析记录
   */
  private async handleParseArticleTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').ParseArticlePayload;
    const { articleId, articleDir, workspacePath, url, skillsDir } = payload;
    const platform = payload.platform ?? null;
    const trigger = payload.trigger ?? 'parse_failed';
    const scriptError = payload.scriptError;
    const readabilityError = payload.readabilityError;

    taskLogger.info('开始文章解析任务:', articleId, '| trigger:', trigger, '| platform:', platform ?? '(未识别)');

    const startedAt = Date.now();

    // 进入 AI 解析中状态 → 回写 meta.json + 广播事件
    const { updateArticleParseStatus } = await import('../services/article-service.js');
    await updateArticleParseStatus(workspacePath, articleId, 'ai_parsing').catch((err) => {
      taskLogger.warn('写入 ai_parsing 状态失败:', err);
    });
    this.sendMessage({
      type: 'articleParseStatusChanged',
      articleId,
      workspacePath,
      parseStatus: 'ai_parsing',
    });

    // 加载 query 基础配置
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { buildQueryBaseConfig } = await import('./agent-query-config.js');
    const baseConfig = await buildQueryBaseConfig({
      configDir: this.configDir,
      isPackaged: this.isPackaged,
      cliPath: this.cliPath,
    });

    // 创建文章解析 MCP Server
    const { createArticleParseMcpServer } = await import('./tools/article-parse-tools.js');
    const articleParseMcpServer = createArticleParseMcpServer();

    // 构建 prompt（V2：直接指向 Skill，embed 触发上下文）
    const prompt = buildV2ParsePrompt({
      articleId,
      articleDir,
      url,
      platform,
      skillsDir,
      trigger,
      scriptError,
      readabilityError,
    });

    let resultSummary = '';
    let scriptUpdated: string | null = null;
    let articleSaved = false;

    try {
      const agentQuery = query({
        prompt,
        options: {
          // SDK 0.2.119+：bypassPermissions 会绕过 allowedTools 白名单，任何工具都被放行。
          // 用 dontAsk 保留"不打扰用户"的语义，同时让 allowedTools 真正生效。
          permissionMode: 'dontAsk',
          env: baseConfig.env,
          // effort 为 null/undefined 时不传给 SDK，由模型自带默认值决定
          ...(baseConfig.effort ? { effort: baseConfig.effort } : {}),
          ...(baseConfig.pathToClaudeCodeExecutable && {
            pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
          }),
          plugins: [
            { type: 'local' as const, path: skillsDir },
          ],
          mcpServers: {
            'dogear-article-parse': articleParseMcpServer,
          },
          allowedTools: [
            'mcp__dogear-article-parse__ReadRawHtml',
            'mcp__dogear-article-parse__ReadCurrentContent',
            'mcp__dogear-article-parse__ReadParserRules',
            'mcp__dogear-article-parse__SaveParsedArticle',
            'mcp__dogear-article-parse__ListPlatformScripts',
            'mcp__dogear-article-parse__ReadPlatformScript',
            'mcp__dogear-article-parse__RunPlatformScript',
            'mcp__dogear-article-parse__UpdatePlatformScript',
            'mcp__dogear-article-parse__ReadParseHistory',
          ],
          hooks: {
            PostToolUse: [{
              hooks: [async (input: any) => {
                const { tool_name } = input;
                if (tool_name === 'mcp__dogear-article-parse__SaveParsedArticle') {
                  articleSaved = true;
                  taskLogger.info('文章已保存');
                } else if (tool_name === 'mcp__dogear-article-parse__UpdatePlatformScript') {
                  const ti = input.tool_input || {};
                  scriptUpdated = `platforms/${ti.platform}.py`;
                  taskLogger.info('平台脚本已更新:', scriptUpdated);
                }
                return { continue: true };
              }],
            }],
          },
        },
      });

      // 迭代消息
      for await (const message of agentQuery) {
        if (message.type === 'assistant') {
          const msg = message as any;
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                resultSummary += block.text;
              }
            }
          }
        } else if (message.type === 'result') {
          taskLogger.info('AI 解析完成');
        }
      }

      // 追加历史记录
      await appendParseHistory(skillsDir, {
        timestamp: new Date().toISOString(),
        articleId,
        url,
        platform,
        trigger,
        triggeredAi: true,
        scriptUpdated,
        articleSaved,
        parseStatus: articleSaved ? 'ai_enhanced' : 'quality_warning',
        durationMs: Date.now() - startedAt,
      });

      // 判定最终状态：若 AI 成功 save → ai_enhanced；否则 → quality_warning（AI 也无法解析）
      const finalStatus = articleSaved
        ? 'ai_enhanced' as const
        : 'quality_warning' as const;

      await updateArticleParseStatus(workspacePath, articleId, finalStatus).catch((err) => {
        taskLogger.warn('写入最终状态失败:', err);
      });
      this.sendMessage({
        type: 'articleParseStatusChanged',
        articleId,
        workspacePath,
        parseStatus: finalStatus,
      });

      taskLogger.info('文章解析任务完成，耗时:', Date.now() - startedAt, 'ms', '| 最终状态:', finalStatus);

      return {
        articleId,
        articleSaved,
        scriptUpdated,
        parseStatus: finalStatus,
        summary: resultSummary.slice(0, 500),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('文章解析任务失败:', errorMsg);

      // 记录失败历史
      await appendParseHistory(skillsDir, {
        timestamp: new Date().toISOString(),
        articleId,
        url,
        platform,
        trigger,
        triggeredAi: true,
        scriptUpdated: null,
        articleSaved: false,
        parseStatus: 'failed',
        durationMs: Date.now() - startedAt,
        error: errorMsg,
      }).catch(() => { /* 历史记录失败不影响主流程 */ });

      const errorStatus = 'failed' as const;
      await updateArticleParseStatus(workspacePath, articleId, errorStatus).catch(() => { /* ignore */ });
      this.sendMessage({
        type: 'articleParseStatusChanged',
        articleId,
        workspacePath,
        parseStatus: errorStatus,
      });

      return {
        articleId,
        articleSaved: false,
        parseStatus: errorStatus,
        error: errorMsg,
      };
    }
  }

  /**
   * 处理组级摘要卡提炼任务（GROUP_DIGEST_SESSION，Phase 3）
   *
   * 一次性 headless query：agent 自主调 ReadGroupDigest → CleanTranscript(dirty) → ListGroupFiles → SaveGroupDigest，
   * 整合多会话的逐字稿 + 共享区文件 → 组卡。模型按 digestModelSelection 覆盖（默认 haiku）。
   */
  private async handleGroupDigestTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').GroupDigestSessionPayload;
    const { workspaceId, workspacePath, groupId, dirtyConversations, hasExistingCard } = payload;

    taskLogger.info('开始组级摘要卡任务:', groupId, '| workspace:', workspaceId, '| dirty:', dirtyConversations.length);
    const startedAt = Date.now();

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { buildQueryBaseConfig, resolveModelSelection } = await import('./agent-query-config.js');
    const baseConfig = await buildQueryBaseConfig({
      configDir: this.configDir,
      isPackaged: this.isPackaged,
      cliPath: this.cliPath,
    });

    const selection = payload.modelSelection
      ?? baseConfig.appSettings.ai.digestModelSelection
      ?? baseConfig.appSettings.ai.defaultModelSelection;

    let env: Record<string, string>;
    let tier: ModelTier;
    let resolvedProfile: ModelProfile;
    try {
      const r = resolveModelSelection(baseConfig.appSettings, selection, null, null, this.configDir);
      env = r.env;
      tier = r.tier;
      resolvedProfile = r.profile;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('组级摘要卡任务终止:', error);
      return { groupId, saved: false, error };
    }

    const { createGroupDigestTools } = await import('./tools/group-digest-tools.js');
    const { createDigestTools } = await import('./tools/digest-tools.js');
    const { createGroupTools } = await import('./tools/group-tools.js');

    let saved = false;
    const groupDigestServer = createGroupDigestTools(workspaceId, workspacePath, groupId, dirtyConversations, () => { saved = true; });
    const transcriptServer = createDigestTools(workspaceId, workspacePath);
    const groupServer = createGroupTools(workspaceId, groupId);

    // 读取已有组卡 sourcesSeen（供 system prompt 注入）
    const { readGroupDigest, getGroupDigestPath } = await import('../services/memory/group-digest-store.js');
    const existingCard = hasExistingCard ? await readGroupDigest(workspaceId, groupId) : null;
    const sourcesSeenText = existingCard?.sourcesSeen.length
      ? existingCard.sourcesSeen.map((s) => `    - sessionId=${s.sessionId} conv=${s.conversationId} mtime=${s.mtime}`).join('\n')
      : '    (无)';

    // 共享区文件清单
    const { listNativeFiles } = await import('../services/group-shared-service.js');
    const { files: nativeFiles } = await listNativeFiles(workspaceId, groupId).catch(() => ({ files: [] }));
    const notesFiles = nativeFiles.filter((f) => f.relPath.startsWith('_notes/'));
    const otherFiles = nativeFiles.filter((f) => !f.relPath.startsWith('_notes/'));
    const sharedFileText = otherFiles.length
      ? otherFiles.map((f) => `    - ${f.relPath} (size=${f.size}, mtime=${f.mtime})`).join('\n')
      : '    (空)';
    const notesFileText = notesFiles.length
      ? notesFiles.map((f) => `    - ${f.relPath}`).join('\n')
      : '    (无)';

    const { loadGroupDigestPrompt } = await import('../services/memory/group-digest-prompt.js');
    const template = await loadGroupDigestPrompt(this.configDir);
    const groupDigestPath = getGroupDigestPath(workspaceId, groupId);

    const contextSection = [
      '\n## 本次输入',
      `- workspaceId: ${workspaceId}`,
      `- groupId: ${groupId}`,
      `- 组卡路径: ${groupDigestPath}`,
      `- hasExistingCard: ${hasExistingCard}`,
      `- dirtyConversations:`,
      ...dirtyConversations.map((d) => `  - sessionId=${d.sessionId} conversationId=${d.conversationId} mtime=${d.mtime}`),
      `- 当前组卡 sourcesSeen（共 ${existingCard?.sourcesSeen.length ?? 0} 项）:`,
      sourcesSeenText,
      `- 共享区文件清单（含 _notes/ 子目录）:`,
      sharedFileText,
      `- shared/_notes/ 文件清单（请优先 ReadGroupFile 这些）:`,
      notesFileText,
    ].join('\n');

    const prompt = `${template}${contextSection}`;

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    try {
      const agentQuery = query({
        prompt,
        options: {
          permissionMode: 'dontAsk',
          env,
          abortController,
          // haiku 不支持 effort 参数（会 API 400），仅非 haiku 档位透传
          ...(tier !== 'haiku' && baseConfig.effort ? { effort: baseConfig.effort } : {}),
          ...(baseConfig.pathToClaudeCodeExecutable && {
            pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
          }),
          mcpServers: {
            'dogear-group-digest': groupDigestServer,
            'dogear-memory-digest': transcriptServer,
            'dogear-group': groupServer,
          },
          allowedTools: [
            'mcp__dogear-group-digest__ReadGroupDigest',
            'mcp__dogear-group-digest__SaveGroupDigest',
            'mcp__dogear-memory-digest__CleanTranscript',
            'mcp__dogear-group__ReadGroupFile',
            'mcp__dogear-group__ListGroupFiles',
          ],
        },
      });

      for await (const message of agentQuery) {
        if (message.type === 'result') {
          taskLogger.info('组级摘要卡提炼完成');
        }
      }

      taskLogger.info('组级摘要卡任务完成，耗时:', Date.now() - startedAt, 'ms', '| saved:', saved, '| tier:', tier);
      return { groupId, saved, tier, profileName: resolvedProfile.name };
    } catch (error) {
      if (abortController.signal.aborted) {
        taskLogger.info('组级摘要卡被取消:', groupId);
        return { groupId, saved: false, cancelled: true };
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('组级摘要卡任务失败:', errorMsg);
      return { groupId, saved: false, error: errorMsg };
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * 处理首页报告任务（REVIEW_SESSION，历史代号 review）
   *
   * 一次性 headless query：agent 自主调 ListDigests → ReadDigest → TraceSource → ReadReport/WriteReport
   * + RecallMemory/SaveMemory/ForgetMemory，把新摘要卡分流为「更新记忆 + 重写首页报告」。
   * saved 表示是否写了报告。模型按 reviewModelTier 覆盖（默认 sonnet）。
   */
  private async handleReviewSessionTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').ReviewSessionPayload;
    const { workspaceId, workspacePath } = payload;

    taskLogger.info('开始跨会话复盘任务:', '| workspace:', workspaceId);
    const startedAt = Date.now();

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { buildQueryBaseConfig } = await import('./agent-query-config.js');
    const baseConfig = await buildQueryBaseConfig({
      configDir: this.configDir,
      isPackaged: this.isPackaged,
      cliPath: this.cliPath,
    });

    const { resolveModelSelection } = await import('./agent-query-config.js');
    const selection = payload.modelSelection
      ?? baseConfig.appSettings.ai.reviewModelSelection
      ?? baseConfig.appSettings.ai.defaultModelSelection;

    let env: Record<string, string>;
    let tier: ModelTier;
    let resolvedProfile: ModelProfile;
    try {
      const r = resolveModelSelection(baseConfig.appSettings, selection, null, null, this.configDir);
      env = r.env;
      tier = r.tier;
      resolvedProfile = r.profile;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('跨会话复盘任务终止:', error);
      return { workspaceId, saved: false, error };
    }

    const { createReviewMcpServer } = await import('./tools/review-tools.js');
    const { createMemoryTools } = await import('./tools/memory-tools.js');
    let saved = false;
    const reviewServer = createReviewMcpServer(workspaceId, workspacePath, () => { saved = true; });
    const memoryServer = createMemoryTools(workspacePath);

    const { loadReviewPrompt } = await import('../services/memory/review-prompt.js');
    const template = await loadReviewPrompt(this.configDir);
    const prompt = template;

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    try {
      const agentQuery = query({
        prompt,
        options: {
          permissionMode: 'dontAsk',
          env,
          abortController,
          // haiku 不支持 effort 参数（会 API 400），仅非 haiku 档位透传
          ...(tier !== 'haiku' && baseConfig.effort ? { effort: baseConfig.effort } : {}),
          ...(baseConfig.pathToClaudeCodeExecutable && {
            pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
          }),
          mcpServers: {
            'dogear-memory-review': reviewServer,
            'dogear-memory': memoryServer,
          },
          allowedTools: [
            'mcp__dogear-memory-review__ListDigests',
            'mcp__dogear-memory-review__ReadDigest',
            'mcp__dogear-memory-review__TraceSource',
            'mcp__dogear-memory-review__ReadReport',
            'mcp__dogear-memory-review__WriteReport',
            'mcp__dogear-memory__RecallMemory',
            'mcp__dogear-memory__SaveMemory',
            'mcp__dogear-memory__ForgetMemory',
          ],
        },
      });

      for await (const message of agentQuery) {
        if (message.type === 'result') {
          taskLogger.info('跨会话复盘完成');
        }
      }

      taskLogger.info('跨会话复盘任务完成，耗时:', Date.now() - startedAt, 'ms', '| saved:', saved, '| tier:', tier);
      return { workspaceId, saved, tier, profileName: resolvedProfile.name };
    } catch (error) {
      if (abortController.signal.aborted) {
        taskLogger.info('跨会话复盘被取消:', workspaceId);
        return { workspaceId, saved: false, cancelled: true };
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('跨会话复盘任务失败:', errorMsg);
      return { workspaceId, saved: false, error: errorMsg };
    } finally {
      this.currentAbortController = null;
    }
  }

  // ─── handleCategorizeSessionTask 模块级 helper ───────────────────────────

  /** 返回一个全零的分类决策计数对象，用于统一各退出路径的返回 shape。 */
  private static emptyCategorizeDecisions(): Record<'match' | 'join' | 'new' | 'skip' | 'error', number> {
    return { match: 0, join: 0, new: 0, skip: 0, error: 0 };
  }

  /**
   * 处理智能分类任务（CATEGORIZE_SESSION）
   *
   * incremental 模式：单条新摘要卡的归类决策
   *   1. 读摘要卡，拿 tags（无 tags 记 skip 早退）
   *   2. Step A 纯阈值匹配：命中即 push 到所有命中分类，结束（0 LLM）
   *   3. 无匹配 → 上 LLM：用 dogear-smart-category server，prompt 注入摘要 overview + tags + 候选迁移名单
   *
   * full-rebuild 模式：清空 smart-categories.json，按 createdAt 升序对所有摘要卡走相同决策流程
   *
   * 模型按 categorizeModelTier（默认 haiku）覆盖；可取消。
   */
  private async handleCategorizeSessionTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').CategorizeSessionPayload;
    const { workspaceId, mode } = payload;

    taskLogger.info('开始智能分类任务:', '| workspace:', workspaceId, '| mode:', mode);
    const startedAt = Date.now();

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { buildQueryBaseConfig } = await import('./agent-query-config.js');
    const baseConfig = await buildQueryBaseConfig({
      configDir: this.configDir,
      isPackaged: this.isPackaged,
      cliPath: this.cliPath,
    });

    const { resolveModelSelection } = await import('./agent-query-config.js');
    const selection = payload.modelSelection
      ?? baseConfig.appSettings.ai.categorizeModelSelection
      ?? baseConfig.appSettings.ai.defaultModelSelection;

    let env: Record<string, string>;
    let tier: ModelTier;
    let resolvedProfile: ModelProfile;
    try {
      const r = resolveModelSelection(baseConfig.appSettings, selection, null, null, this.configDir);
      env = r.env;
      tier = r.tier;
      resolvedProfile = r.profile;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('智能分类任务终止:', error);
      return { workspaceId, mode, decisions: AgentWorker.emptyCategorizeDecisions(), error };
    }

    const threshold = baseConfig.appSettings.smartCategory?.threshold ?? 0.5;

    // ──── 内部辅助：处理单张摘要卡（Step A + LLM）────

    const {
      readIndex, writeIndex, pushGroup, appendDecision,
    } = await import('../services/memory/smart-category-store.js');
    const { matchByThreshold, pickRedistributeCandidates } = await import('../services/memory/smart-category-engine.js');
    const { parseGroupDigest, getGroupDigestsDir } = await import('../services/memory/group-digest-store.js');
    const { getByWorkspaceId } = await import('../services/conversation-service.js');
    const groupService = await import('../services/group-service.js');
    const { deriveGroupTitle } = await import('../services/group-helpers.js');
    const { loadCategorizePrompt } = await import('../services/memory/categorize-prompt.js');
    const { createCategoryTools } = await import('./tools/category-tools.js');
    const fs = await import('node:fs/promises');

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    /**
     * 决策单张组卡。返回决策结果 'match' | 'join' | 'new' | 'skip' | 'error'。
     * LLM 调用前会插入 prompt 模板 + 候选名单。
     */
    const decideForGroup = async (
      groupDigestPath: string,
      groupId: string,
    ): Promise<'match' | 'join' | 'new' | 'skip' | 'error'> => {
      if (abortController.signal.aborted) return 'error';

      // 读组卡
      let raw: string;
      try {
        raw = await fs.readFile(groupDigestPath, 'utf-8');
      } catch (err) {
        taskLogger.warn('读组卡失败:', groupDigestPath, err);
        return 'error';
      }
      const card = parseGroupDigest(raw);
      if (!card) {
        taskLogger.warn('组卡解析失败:', groupDigestPath);
        return 'error';
      }

      // 无 tags 早退（agent 没遵守提示词、或老卡未补标签）
      if (!card.tags) {
        taskLogger.info('组卡无 tags，记 skip:', groupId);
        let idx0 = await readIndex(workspaceId);
        idx0 = appendDecision(idx0, {
          time: new Date().toISOString(),
          groupId,
          decision: 'skip',
          reason: 'digest 缺 tags',
        });
        await writeIndex(workspaceId, idx0);
        return 'skip';
      }

      // Step A 纯阈值匹配
      let idx = await readIndex(workspaceId);
      const matches = matchByThreshold(card.tags, idx.categories, threshold);
      if (matches.length > 0) {
        for (const m of matches) {
          const cat = idx.categories.find((c) => c.id === m.categoryId);
          if (cat) {
            const updated = pushGroup(cat, groupId);
            idx.categories = idx.categories.map((c) => (c.id === cat.id ? updated : c));
          }
        }
        idx = appendDecision(idx, {
          time: new Date().toISOString(),
          groupId,
          decision: 'match',
          reason: `matched ${matches.map((m) => m.categoryId).join(',')}`,
        });
        await writeIndex(workspaceId, idx);
        taskLogger.info('Step A 命中:', groupId, '→', matches.map((m) => m.categoryId));
        return 'match';
      }

      // 无匹配 → 上 LLM
      // 候选召回：用新组卡的所有 tags 作为"新 anchor 候选"
      const allTags = [card.tags.primary, ...card.tags.secondary];
      const candidates = pickRedistributeCandidates(idx.categories, allTags);
      // 拉候选组的 title 用于注入
      const allConvs = await getByWorkspaceId(workspaceId);
      const allGroups = await groupService.listGroups(workspaceId);
      const groupMap = new Map(allGroups.map((g) => [g.id, g]));
      const titleByGroup = new Map<string, string>();
      for (const c of candidates) {
        for (const gid of c.groupIds) {
          if (titleByGroup.has(gid)) continue;
          const g = groupMap.get(gid);
          if (!g) { titleByGroup.set(gid, '(未知组)'); continue; }
          titleByGroup.set(gid, deriveGroupTitle(g, allConvs.filter((cv) => cv.groupId === gid)));
        }
      }
      const candidatesForPrompt = candidates.map((c) => ({
        categoryId: c.categoryId,
        categoryName: idx.categories.find((x) => x.id === c.categoryId)?.name ?? '',
        groups: c.groupIds.map((gid) => ({ groupId: gid, title: titleByGroup.get(gid) ?? '(未知组)' })),
      }));

      const template = await loadCategorizePrompt(this.configDir);
      const userContext = [
        template,
        '',
        '## 本次输入',
        '',
        `### 新组卡`,
        `- groupId: ${groupId}`,
        `- 标题: ${card.title}`,
        `- 概述:`,
        '  ```',
        '  ' + card.summary.replace(/\n/g, '\n  '),
        '  ```',
        `- tags.primary: ${card.tags.primary}`,
        `- tags.secondary: ${JSON.stringify(card.tags.secondary)}`,
        `- tags.scores: ${JSON.stringify(card.tags.scores)}`,
        '',
        `### 候选迁移名单（${candidatesForPrompt.length === 0 ? '无' : `${candidatesForPrompt.length} 组邻近老分类`}）`,
        ...(candidatesForPrompt.length === 0
          ? ['（如选 NEW_CATEGORY，redistribute 留空即可）']
          : candidatesForPrompt.map((g) =>
            `- 分类 ${g.categoryName} (${g.categoryId})：\n` +
            g.groups.map((x) => `  - ${x.groupId} ｜ ${x.title}`).join('\n')
          )),
        '',
        `### 工作区上下文`,
        `- workspaceId: ${workspaceId}`,
        `- 调 ListCategories 时使用此 workspaceId`,
        `- 调 SaveCategory 时使用此 workspaceId 和 groupId=${groupId}`,
      ].join('\n');

      const categoryServer = createCategoryTools();

      let decided: 'join' | 'new' | 'error' = 'error';

      try {
        const agentQuery = query({
          prompt: userContext,
          options: {
            permissionMode: 'dontAsk',
            env,
            abortController,
            ...(tier !== 'haiku' && baseConfig.effort ? { effort: baseConfig.effort } : {}),
            ...(baseConfig.pathToClaudeCodeExecutable && {
              pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
            }),
            mcpServers: {
              'dogear-smart-category': categoryServer,
            },
            allowedTools: [
              'mcp__dogear-smart-category__ListCategories',
              'mcp__dogear-smart-category__SaveCategory',
            ],
          },
        });

        for await (const message of agentQuery) {
          if (message.type === 'result') {
            taskLogger.info('LLM 决策完成:', groupId);
          }
        }

        // 检查最新决策日志判断结果
        const idx2 = await readIndex(workspaceId);
        // trigger 保证 categorize 串行（同一工作区并发=1），
        // 同一 groupId 在 query 完成前不会有其他 SaveCategory 调用。
        // appendDecision 是头插法 → find 命中的即本次最新决策。
        const latestForGroup = idx2.recentDecisions.find((d) => d.groupId === groupId);
        if (latestForGroup && (latestForGroup.decision === 'join' || latestForGroup.decision === 'new')) {
          decided = latestForGroup.decision;
        } else {
          // LLM 没有真正调 SaveCategory
          let idx3 = idx2;
          idx3 = appendDecision(idx3, {
            time: new Date().toISOString(),
            groupId,
            decision: 'error',
            reason: 'LLM 未调 SaveCategory',
          });
          await writeIndex(workspaceId, idx3);
          decided = 'error';
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          taskLogger.info('智能分类被取消:', groupId);
          return 'error';
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        taskLogger.error('LLM 决策失败:', errorMsg);
        let idx4 = await readIndex(workspaceId);
        idx4 = appendDecision(idx4, {
          time: new Date().toISOString(),
          groupId,
          decision: 'error',
          reason: errorMsg,
        });
        await writeIndex(workspaceId, idx4);
        decided = 'error';
      }

      return decided;
    };

    // ──── 主流程 ────

    const decisions = AgentWorker.emptyCategorizeDecisions();

    try {
      if (mode === 'incremental') {
        if (!payload.groupId || !payload.groupDigestPath) {
          return { workspaceId, mode, decisions: AgentWorker.emptyCategorizeDecisions(), error: 'incremental 模式必须提供 groupId + groupDigestPath' };
        }
        const r = await decideForGroup(payload.groupDigestPath, payload.groupId);
        decisions[r]++;
      } else {
        // full-rebuild：清空 index，按 createdAt 升序对所有组卡走相同流程
        taskLogger.info('full-rebuild: 清空 smart-categories.json');
        await writeIndex(workspaceId, { categories: [], recentDecisions: [] });

        const digestsDir = getGroupDigestsDir(workspaceId);
        let entries: string[];
        try {
          entries = await fs.readdir(digestsDir);
        } catch {
          entries = [];
        }
        // 跳过 _cleaned/_archive/_orphan 子目录，只取顶层 .md
        const SKIP = new Set(['_cleaned', '_archive', '_orphan']);
        const mdFiles = entries.filter((n) => !SKIP.has(n) && n.endsWith('.md'));

        // 按 createdAt 升序：parse 一次先排序
        const cards: { path: string; groupId: string; createdAt: string }[] = [];
        for (const name of mdFiles) {
          const p = path.join(digestsDir, name);
          try {
            const raw = await fs.readFile(p, 'utf-8');
            const card = parseGroupDigest(raw);
            if (card?.groupId) {
              cards.push({ path: p, groupId: card.groupId, createdAt: card.createdAt });
            }
          } catch { /* 跳过解析失败 */ }
        }
        cards.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

        taskLogger.info(`full-rebuild: 待处理 ${cards.length} 张组卡`);
        for (const c of cards) {
          if (abortController.signal.aborted) break;
          const r = await decideForGroup(c.path, c.groupId);
          decisions[r]++;
        }
      }

      taskLogger.info('智能分类任务完成，耗时:', Date.now() - startedAt, 'ms', '| decisions:', decisions, '| tier:', tier);
      return { workspaceId, mode, decisions, tier, profileName: resolvedProfile.name };
    } catch (error) {
      if (abortController.signal.aborted) {
        return { workspaceId, mode, decisions, cancelled: true };
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('智能分类任务失败:', errorMsg);
      return { workspaceId, mode, decisions: AgentWorker.emptyCategorizeDecisions(), error: errorMsg };
    } finally {
      this.currentAbortController = null;
    }
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
   * 简化工具输入，减少日志大小
   * 截断过长的字符串，只保留关键信息
   */
  private simplifyToolInput(input: any): any {
    if (!input || typeof input !== 'object') {
      return input;
    }

    const result: any = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && value.length > 100) {
        result[key] = value.substring(0, 100) + '...';
      } else if (Array.isArray(value) && value.length > 5) {
        result[key] = `[${value.slice(0, 5)}... (共${value.length}项)]`;
      } else {
        result[key] = value;
      }
    }
    return result;
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
      this.currentAbortController?.abort();
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

// ==================== 文章解析任务辅助函数 ====================

/**
 * 从 URL 提取平台标识
 * 扩展此函数以支持更多平台。
 */
function detectPlatform(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'mp.weixin.qq.com') return 'wechat';
    return undefined;
  } catch {
    return undefined;
  }
}

interface V2PromptParams {
  articleId: string;
  articleDir: string;
  url: string;
  platform: string | null;
  skillsDir: string;
  trigger: string;
  scriptError?: { type: string; message: string };
  readabilityError?: string;
}

function buildV2ParsePrompt(p: V2PromptParams): string {
  return `你是文章解析器。article-parser Skill 已加载，请按 Skill 中的调试循环工作。

**任务上下文：**
- articleId: ${p.articleId}
- articleDir: ${p.articleDir}
- url: ${p.url}
- platform: ${p.platform || '(未识别)'}
- skillsDir: ${p.skillsDir}
- trigger: ${p.trigger}
${p.scriptError ? `- 脚本错误：${p.scriptError.type} — ${p.scriptError.message}` : ''}
${p.readabilityError ? `- Readability 错误：${p.readabilityError}` : ''}

现在按 SKILL.md 定义的步骤完成解析。
所有工具参数路径都要传入完整绝对路径。`;
}

interface ParseHistoryEntry {
  timestamp: string;
  articleId: string;
  url: string;
  platform?: string | null;
  trigger?: string;
  triggeredAi?: boolean;
  scriptUpdated: string | null;
  articleSaved: boolean;
  parseStatus: string;
  durationMs: number;
  error?: string;
}

/**
 * 追加一行解析历史到 history.jsonl。
 * 并发场景下依赖 safe-json.ts 的文件锁（withFileLock）保证原子性。
 */
async function appendParseHistory(skillsDir: string, entry: ParseHistoryEntry): Promise<void> {
  const { default: path } = await import('path');
  const fs = await import('fs/promises');
  const { withFileLock } = await import('../services/safe-json.js');
  const historyPath = path.join(skillsDir, 'history.jsonl');

  await withFileLock(historyPath, async () => {
    await fs.appendFile(historyPath, JSON.stringify(entry) + '\n', 'utf-8');
  });
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
