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

        case TaskType.DIGEST_SESSION:
          result = await this.handleDigestSessionTask(task, taskLogger);
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
          effort: baseConfig.effort,
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
   * 处理会话提炼任务（DIGEST_SESSION）
   *
   * 一次性 headless query：agent 自主调 CleanTranscript → ReadExistingDigest → SaveDigest，
   * 把一段会话 JSONL 提炼成「会话摘要卡」。模型按 digestModelTier 覆盖（默认 haiku）。
   */
  private async handleDigestSessionTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').DigestSessionPayload;
    const { workspaceId, workspacePath, sdkSessionId } = payload;

    taskLogger.info('开始会话提炼任务:', sdkSessionId, '| workspace:', workspaceId);
    const startedAt = Date.now();

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { buildQueryBaseConfig } = await import('./agent-query-config.js');
    const baseConfig = await buildQueryBaseConfig({
      configDir: this.configDir,
      isPackaged: this.isPackaged,
      cliPath: this.cliPath,
    });

    // 覆盖提炼模型：payload 优先，否则读 settings，缺省 haiku
    const tier = payload.digestModelTier
      ?? baseConfig.appSettings.ai.digestModelTier
      ?? 'haiku';
    const tierMap: Record<'haiku' | 'sonnet' | 'opus', string> = {
      haiku: baseConfig.activeProfile.haikuModel,
      sonnet: baseConfig.activeProfile.sonnetModel,
      opus: baseConfig.activeProfile.opusModel,
    };
    const env = { ...baseConfig.env, ANTHROPIC_MODEL: tierMap[tier] };

    const { createDigestTools } = await import('./tools/digest-tools.js');
    let saved = false;
    const digestServer = createDigestTools(workspaceId, workspacePath, () => { saved = true; });

    const { loadDigestPrompt } = await import('../services/memory/digest-prompt.js');
    const template = await loadDigestPrompt(this.configDir);
    const prompt = `${template}\n\n目标会话 sessionId: ${sdkSessionId}`;

    try {
      const agentQuery = query({
        prompt,
        options: {
          permissionMode: 'dontAsk',
          env,
          // haiku 不支持 effort 参数（会 API 400），仅非 haiku 档位透传
          ...(tier !== 'haiku' && baseConfig.effort ? { effort: baseConfig.effort } : {}),
          ...(baseConfig.pathToClaudeCodeExecutable && {
            pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
          }),
          mcpServers: {
            'dogear-memory-digest': digestServer,
          },
          allowedTools: [
            'mcp__dogear-memory-digest__CleanTranscript',
            'mcp__dogear-memory-digest__ReadExistingDigest',
            'mcp__dogear-memory-digest__SaveDigest',
          ],
        },
      });

      for await (const message of agentQuery) {
        if (message.type === 'result') {
          taskLogger.info('会话提炼完成');
        }
      }

      taskLogger.info('会话提炼任务完成，耗时:', Date.now() - startedAt, 'ms', '| saved:', saved, '| tier:', tier);
      return { sdkSessionId, saved, tier };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('会话提炼任务失败:', errorMsg);
      return { sdkSessionId, saved: false, error: errorMsg };
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
