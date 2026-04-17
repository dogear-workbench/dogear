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
import { createBookAnalysisTools, BOOK_ANALYSIS_SYSTEM_PROMPT } from './tools/book-analysis-tools.js';
import * as workspaceService from '../services/workspace-service.js';

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

  // v2: 轻量级 workspace 对象（用于传递给 service 函数）
  private workspace: any = null;

  // v2: MCP Server 配置
  private bookAnalysisMcpServer: any = null;

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
      // v2: 初始化工作区路径
      // 使用配置传递的路径，避免在 Worker 中调用 electron.app
      // 创建轻量级 workspace 对象用于传递给 service 函数
      this.workspacePath = config.workspacePath || '';
      this.workspace = {
        id: 'current',
        name: '当前工作区',
        path: this.workspacePath,
        is_default: 1,
        created_at: Date.now()
      };
      this.logger.info('工作区路径:', this.workspacePath);

      // Phase 0: 保存共享 query 配置的运行时上下文
      this.configDir = config.configDir;
      this.isPackaged = config.isPackaged;
      this.cliPath = config.cliPath;
      this.logger.info('配置目录:', this.configDir, '| 打包环境:', this.isPackaged);

      // v2: 创建 MCP Server
      this.bookAnalysisMcpServer = createBookAnalysisTools(this.workspacePath);
      this.logger.info('书籍分析 MCP Server 已创建');

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

        case TaskType.ANALYZE_BOOK:
          result = await this.handleAnalyzeBookTask(task, taskLogger);
          break;

        case TaskType.READING_ASSIST:
          result = await this.handleReadingAssistTask(task, taskLogger);
          break;

        case TaskType.PARSE_ARTICLE:
          result = await this.handleParseArticleTask(task, taskLogger);
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

    // 如果有 chapterId，获取章节内容作为上下文
    let chapterContent: string | undefined;
    if (context.chapterId) {
      try {
        // 动态导入 bookService，避免循环依赖（Worker 线程）
        const bookService = await import('../services/book-service.js');
        const chapter = await bookService.getChapterFromFile(context.chapterId);
        if (chapter) {
          chapterContent = chapter.content;
          taskLogger.info('已加载章节内容:', chapter.title, '字符数:', chapter.content?.length || 0);
        }
      } catch (error) {
        taskLogger.error('获取章节内容失败:', error);
      }
    }

    // 创建会话配置
    const config: ChatSessionConfig = {
      context,
      chapterContent,  // 传递章节内容

      // v2: 添加 MCP Server 配置，让调试窗口也能使用书籍分析工具
      mcpServers: this.bookAnalysisMcpServer ? {
        'dogear-book-analysis': this.bookAnalysisMcpServer,
      } : undefined,

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
   * 处理书籍分析任务 (v2: 使用 MCP Server)
   */
  private async handleAnalyzeBookTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload;
    const { bookId } = payload;

    taskLogger.info('处理书籍分析任务:', bookId);

    // 获取书籍信息以确定文件路径
    let bookInfo: any;
    let bookFilePath: string;
    try {
      const bookService = await import('../services/book-service.js');
      bookInfo = await bookService.getBookById(bookId);
      if (!bookInfo) {
        throw new Error(`书籍不存在: ${bookId}`);
      }

      // 构建书籍文件路径 - 使用 meta.json 中存储的 file_path（相对于工作区）
      // file_path 格式: {bookId}/filename.ext
      bookFilePath = await workspaceService.getBookFilePath(this.workspace, bookId, bookInfo.file_path);
      taskLogger.info('书籍文件路径:', bookFilePath);

      // 更新 meta.json 状态为"分析中"
      await bookService.updateBookMeta(bookId, {
        analysis_status: 'analyzing',
        analyzed_at: Date.now()
      });
      taskLogger.info('meta.json 状态已更新为: analyzing');
    } catch (error) {
      taskLogger.error('获取书籍信息失败:', error);
      throw error;
    }

    // 更新文件系统中的状态
    // 先创建完整的目录结构（避免后续保存时 ENOENT 错误）
    try {
      await workspaceService.getOrCreateBookDir(this.workspace, bookId);
      taskLogger.info('书籍目录结构已创建');

      await workspaceService.saveAnalysisStatus(this.workspace, bookId, {
        analysisStatus: 'analyzing',
        analyzedAt: Date.now()
      });
      taskLogger.info('文件系统状态已更新为: analyzing');
    } catch (error) {
      taskLogger.error('更新文件系统状态失败:', error);
    }

    // v2: 使用 Claude Agent SDK 的 query 函数进行书籍分析
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    // Phase 0: 加载共享 query 配置（API Key、模型映射、thinking/effort 等）
    const { buildQueryBaseConfig } = await import('./agent-query-config.js');
    const baseConfig = await buildQueryBaseConfig({
      configDir: this.configDir,
      isPackaged: this.isPackaged,
      cliPath: this.cliPath,
    });
    taskLogger.info('已加载 query 配置, profile:', baseConfig.activeProfile.name);

    // 构建分析提示
    const analysisPrompt = `你需要分析这本书并保存分析结果。

**书籍信息:**
- bookId: ${bookId}
- 书名: ${bookInfo.title}
- 作者: ${bookInfo.author || '未知'}
- 文件路径: ${bookFilePath}
- 总章节数: ${bookInfo.total_chapters}

**重要:你必须完成以下所有步骤,缺一不可:**

1. 调用 GetBookInfo 获取书籍基本信息(验证数据)
2. 调用 GetChapterList 获取章节列表
3. 使用 Read 工具读取书籍文件: ${bookFilePath}
   - 如果文件很大,可以只读取前几章来判断类型
4. 根据内容判断类型(fiction/non-fiction/article等)
5. **必须调用 SaveAnalysis** 保存全书分析结果
6. **必须对每个章节调用 SaveChapterAnalysis** 保存章节分析
   - 至少保存章节标题和摘要
7. **必须调用 CompleteAnalysis** 标记完成

请使用中文进行分析。现在开始执行。`;

    try {
      // 创建 query 实例
      const agentQuery = query({
        prompt: analysisPrompt,
        options: {
          // 后台分析任务固定使用 bypassPermissions（不需要用户确认）
          permissionMode: "bypassPermissions",

          // Phase 0: 注入共享配置（API Key、模型映射、thinking/effort、CLI 路径）
          env: baseConfig.env,
          thinking: baseConfig.thinking,
          effort: baseConfig.effort,
          ...(baseConfig.pathToClaudeCodeExecutable && {
            pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
          }),

          // 允许访问工作区目录
          additionalDirectories: [this.workspacePath],

          // 内置工具
          allowedTools: ['Read', 'Glob', 'Grep'],

          // v2: 自定义 MCP Server（书籍分析工具）
          mcpServers: {
            'dogear-book-analysis': this.bookAnalysisMcpServer,
          },

          // 分析专用的 System Prompt
          systemPrompt: BOOK_ANALYSIS_SYSTEM_PROMPT,

          // 启用会话持久化
          persistSession: true,

          // 子代理：章节分析器（可并行分析多个章节）
          agents: {
            'chapter-analyzer': {
              description: '分析单个章节的内容，提取摘要和关键信息',
              prompt: '你是一个章节分析器。分析给定的章节内容，输出结构化的分析结果。使用中文。',
              model: 'haiku',
              tools: ['Read', 'Glob', 'Grep'],
              maxTurns: 3,
            },
          },

          // Hooks - 让分析活动可见
          hooks: {
            PreToolUse: [{
              hooks: [async (input: any) => {
                const { tool_name, tool_input } = input;
                taskLogger.debug('Agent 使用工具:', tool_name);

                // 发送进度到主进程
                this.sendMessage({
                  type: 'analysisProgress',
                  bookId,
                  toolName: tool_name,
                  toolInput: this.simplifyToolInput(tool_input)
                });

                return { continue: true };
              }]
            }],
            PostToolUse: [{
              hooks: [async (input: any) => {
                const { tool_name, tool_input } = input;
                taskLogger.debug('Agent 工具完成:', tool_name);

                // 特殊处理章节保存进度
                if (tool_name === 'SaveChapterAnalysis') {
                  const title = tool_input?.title || '未知章节';
                  this.sendMessage({
                    type: 'analysisProgress',
                    bookId,
                    chapterSaved: true,
                    chapterTitle: title
                  });
                }

                return { continue: true };
              }]
            }],
            // 工具执行失败时记录错误（替代 PostToolUse 中的手动错误检查）
            PostToolUseFailure: [{
              hooks: [async (input: any) => {
                const { tool_name, error } = input;
                taskLogger.warn(`工具 ${tool_name} 执行失败:`, error);

                this.sendMessage({
                  type: 'analysisProgress',
                  bookId,
                  toolName: tool_name,
                  status: 'tool_error',
                  message: `工具 ${tool_name} 执行失败: ${error}`,
                });

                return { continue: true };
              }]
            }],
            // 分析任务被停止时保存已完成的进度
            Stop: [{
              hooks: [async () => {
                taskLogger.info('分析任务 Stop hook 触发，保存已完成进度');

                this.sendMessage({
                  type: 'analysisProgress',
                  bookId,
                  status: 'stopped',
                  message: '分析已停止，已完成的进度已保存',
                });

                // 更新 meta.json 状态为"失败"（分析被中断）
                try {
                  const bookService = await import('../services/book-service.js');
                  await bookService.updateBookMeta(bookId, {
                    analysis_status: 'failed',
                    analyzed_at: Date.now(),
                  });
                } catch (error) {
                  taskLogger.error('保存停止状态失败:', error);
                }

                return { continue: true };
              }]
            }],
          }
        }
      });

      // 收集响应
      let fullResponse = '';

      for await (const message of agentQuery) {
        if (message.type === 'assistant') {
          // SDKMessage 类型中的 assistant 消息
          const msg = message as any;
          if (msg.message && msg.message.content) {
            // 处理内容块
            const content = msg.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text') {
                  const text = block.text;
                  fullResponse += text;

                  // 发送流式进度更新
                  this.sendMessage({
                    type: 'analysisProgress',
                    bookId,
                    message: text
                  });
                }
              }
            }
          }
        } else if (message.type === 'system') {
          const subtype = (message as any).subtype;
          taskLogger.debug('系统消息:', subtype);

          // 发送系统状态更新
          this.sendMessage({
            type: 'analysisProgress',
            bookId,
            status: subtype
          });
        } else if (message.type === 'result') {
          taskLogger.info('分析完成');
        }
      }

      taskLogger.info('书籍分析完成');

      // 分析成功，更新 meta.json 状态为"已分析"
      try {
        const bookService = await import('../services/book-service.js');
        await bookService.updateBookMeta(bookId, {
          analysis_status: 'analyzed',
          analyzed_at: Date.now()
        });
        taskLogger.info('meta.json 状态已更新为: analyzed');
      } catch (error) {
        taskLogger.error('更新 meta.json 状态失败:', error);
      }

      return {
        bookId,
        response: fullResponse || '分析完成',
        completed: true,
        analyzedAt: Date.now()
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('书籍分析失败:', errorMsg);

      // 分析失败，更新 meta.json 状态为"失败"
      try {
        const bookService = await import('../services/book-service.js');
        await bookService.updateBookMeta(bookId, {
          analysis_status: 'failed',
          analyzed_at: Date.now()
        });

        // 更新文件系统状态
        await workspaceService.saveAnalysisStatus(this.workspace, bookId, {
          analysisStatus: 'failed',
          lastError: errorMsg
        });
      } catch (updateError) {
        taskLogger.error('更新失败状态时出错:', updateError);
      }

      return {
        bookId,
        error: errorMsg,
        completed: false
      };
    }
  }

  /**
   * 处理文章解析任务（自进化文章解析系统）
   *
   * 模式分支：
   * - fixedParseSuccess=true  → 质量检查模式：先读当前内容，判断是否达标，不达标再重新解析
   * - fixedParseSuccess=false → 完整解析模式：直接读 raw.html 从零解析
   *
   * 产出：
   * - 若有改进：通过 SaveParsedArticle 覆盖 meta.json / content.md
   * - 若发现新规律：通过 UpdateParserRule 精简重写规则文件
   * - history.jsonl 追加一行解析记录
   */
  private async handleParseArticleTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').ParseArticlePayload;
    const { articleId, articleDir, url, fixedParseSuccess, skillsDir } = payload;

    taskLogger.info('开始文章解析任务:', articleId, '| 固定解析状态:', fixedParseSuccess ? '成功' : '失败');

    const startedAt = Date.now();

    // 从 URL 提取 platform（简单域名映射）
    const platform = detectPlatform(url);

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

    // 构建 prompt（payload 路径嵌入其中，供 AI 调用工具时回填参数）
    const prompt = fixedParseSuccess
      ? buildQualityCheckPrompt({ articleId, articleDir, url, skillsDir, platform })
      : buildFullParsePrompt({ articleId, articleDir, url, skillsDir, platform });

    let resultSummary = '';
    let ruleUpdated: string | null = null;
    let articleSaved = false;

    try {
      const agentQuery = query({
        prompt,
        options: {
          permissionMode: 'bypassPermissions',
          env: baseConfig.env,
          thinking: baseConfig.thinking,
          effort: baseConfig.effort,
          ...(baseConfig.pathToClaudeCodeExecutable && {
            pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
          }),
          mcpServers: {
            'dogear-article-parse': articleParseMcpServer,
          },
          allowedTools: [
            'mcp__dogear-article-parse__ReadRawHtml',
            'mcp__dogear-article-parse__ReadCurrentContent',
            'mcp__dogear-article-parse__ReadParserRules',
            'mcp__dogear-article-parse__SaveParsedArticle',
            'mcp__dogear-article-parse__UpdateParserRule',
          ],
          hooks: {
            PostToolUse: [{
              hooks: [async (input: any) => {
                const { tool_name } = input;
                if (tool_name === 'mcp__dogear-article-parse__SaveParsedArticle') {
                  articleSaved = true;
                  taskLogger.info('文章已保存');
                } else if (tool_name === 'mcp__dogear-article-parse__UpdateParserRule') {
                  const ti = input.tool_input || {};
                  ruleUpdated = ti.type === 'platform' ? `platforms/${ti.platform}.md` : 'common.md';
                  taskLogger.info('规则已更新:', ruleUpdated);
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
        fixedParseSuccess,
        aiArticleSaved: articleSaved,
        ruleUpdated,
        durationMs: Date.now() - startedAt,
      });

      taskLogger.info('文章解析任务完成，耗时:', Date.now() - startedAt, 'ms');

      return {
        articleId,
        articleSaved,
        ruleUpdated,
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
        fixedParseSuccess,
        aiArticleSaved: false,
        ruleUpdated: null,
        durationMs: Date.now() - startedAt,
        error: errorMsg,
      }).catch(() => { /* 历史记录失败不影响主流程 */ });

      return {
        articleId,
        articleSaved: false,
        error: errorMsg,
      };
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

interface PromptBuildParams {
  articleId: string;
  articleDir: string;
  url: string;
  skillsDir: string;
  platform?: string;
}

function buildQualityCheckPrompt(p: PromptBuildParams): string {
  return `你是一个文章解析质量检查员。请按以下步骤工作：

**任务上下文：**
- articleId: ${p.articleId}
- articleDir: ${p.articleDir}
- url: ${p.url}
- skillsDir: ${p.skillsDir}
- platform: ${p.platform || '未知'}

**执行步骤：**

1. 调用 ReadParserRules（skillsDir="${p.skillsDir}"${p.platform ? `, platform="${p.platform}"` : ''}）了解当前的解析规则。
2. 调用 ReadCurrentContent（articleDir="${p.articleDir}"）查看当前已解析的内容。
3. 根据规则中的"质量检查标准"逐项检查：
   - 标题是否非空、合理
   - 正文长度是否 > 200 字符
   - 是否有明显的导航残留、重复内容、垃圾文本
   - 图片 URL 是否看起来正常
4. **判断结论：**
   - 如果质量达标 → 直接输出"✅ 质量检查通过"并结束，不要调用任何写入工具
   - 如果质量不达标 → 继续执行步骤 5-7
5. 调用 ReadRawHtml（articleDir="${p.articleDir}"）获取原始 HTML。
6. 基于规则和 HTML 结构重新提取标题、作者、正文（Markdown 格式），调用 SaveParsedArticle 覆盖保存。
7. 如果过程中发现了规则中未覆盖的新解析模式，调用 UpdateParserRule 精简地更新规则（全量重写，不是追加；文件保持在 common.md ≤ 10KB、平台规则 ≤ 5KB）。

**重要约束：**
- 不要编造 HTML 中不存在的内容。
- 只在质量确实不达标时才保存，避免无谓的覆盖。
- 所有工具调用都要传入完整的绝对路径参数。

现在开始执行。`;
}

function buildFullParsePrompt(p: PromptBuildParams): string {
  return `你是一个文章解析器。固定解析流程已经失败，需要你从零开始解析。

**任务上下文：**
- articleId: ${p.articleId}
- articleDir: ${p.articleDir}
- url: ${p.url}
- skillsDir: ${p.skillsDir}
- platform: ${p.platform || '未知'}

**执行步骤：**

1. 调用 ReadParserRules（skillsDir="${p.skillsDir}"${p.platform ? `, platform="${p.platform}"` : ''}）了解已有的解析策略。
2. 调用 ReadRawHtml（articleDir="${p.articleDir}"）获取原始 HTML（默认最多 50KB）。
3. 基于规则分析 HTML 结构，定位正文、提取标题/作者/摘要。
4. 调用 SaveParsedArticle 保存解析结果（必须提供 title 和 content，content 为 Markdown 格式）。
5. 如果发现了新的解析模式（规则中未覆盖），调用 UpdateParserRule 精简地更新规则（全量重写）。

**重要约束：**
- 不要编造 HTML 中不存在的内容。
- 如果 HTML 内容明显不完整（登录墙、反爬页面），在回答中说明并跳过保存。
- 所有工具调用都要传入完整的绝对路径参数。

现在开始执行。`;
}

interface ParseHistoryEntry {
  timestamp: string;
  articleId: string;
  url: string;
  platform?: string;
  fixedParseSuccess: boolean;
  aiArticleSaved: boolean;
  ruleUpdated: string | null;
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
