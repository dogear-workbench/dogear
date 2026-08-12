/**
 * Agent Worker 进程
 * 独立运行的后台进程,处理 AI 任务（全部走 pi 运行时）
 *
 * 功能:
 * - 接收来自主进程的任务
 * - 使用 pi runOnce / PiSession 处理任务
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
} from './task-types.js';
import { workerLogger, createTaskLogger } from './logger.js';
import type { ModelProfile } from '../services/settings-types.js';
import type { PiModelResult } from './pi/provider.js';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

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

  private configDir: string = '';

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

      this.logger.info('配置目录:', this.configDir);

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

        case TaskType.CATEGORIZE_ORGANIZE:
          result = await this.handleCategorizeOrganizeTask(task, taskLogger);
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
   * 处理文章解析任务（pi runOnce 驱动）
   *
   * 流程：
   * - 手动读取 SKILL.md（剥 frontmatter）作为 systemPrompt
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

    // 读取设置 + 解析模型
    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
      ?? appSettings.ai.defaultModelSelection;

    let model: PiModelResult['model'];
    let resolvedProfile: ModelProfile;
    let thinkingLevel: ThinkingLevel;
    try {
      const r = resolvePiModel(appSettings, selection, null, null);
      model = r.model;
      resolvedProfile = r.profile;
      thinkingLevel = r.thinkingLevel;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('文章解析任务终止（模型解析失败）:', error);
      const errorStatus = 'failed' as const;
      await updateArticleParseStatus(workspacePath, articleId, errorStatus).catch(() => {});
      this.sendMessage({ type: 'articleParseStatusChanged', articleId, workspacePath, parseStatus: errorStatus });
      return { articleId, articleSaved: false, parseStatus: errorStatus, error };
    }

    // 手动读取 SKILL.md（剥 frontmatter）作为 systemPrompt
    const skillSystemPrompt = await loadArticleParseSkill(skillsDir);

    // 创建文章解析工具
    const { createArticleParseToolDefs } = await import('./tools/article-parse-tools.js');
    let articleSaved = false;
    let scriptUpdated: string | null = null;
    const toolDefs = createArticleParseToolDefs().map((def) => {
      if (def.name === 'SaveParsedArticle') {
        const orig = def.handler;
        def.handler = async (args: any) => {
          const result = await orig(args);
          if (!result.isError) {
            articleSaved = true;
            taskLogger.info('文章已保存');
          }
          return result;
        };
      } else if (def.name === 'UpdatePlatformScript') {
        const orig = def.handler;
        def.handler = async (args: any) => {
          const result = await orig(args);
          if (!result.isError) {
            scriptUpdated = `platforms/${args.platform}.py`;
            taskLogger.info('平台脚本已更新:', scriptUpdated);
          }
          return result;
        };
      }
      return def;
    });

    // 构建 prompt
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

    const { runOnce } = await import('./pi/run-once.js');
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    const systemPrompt = `${skillSystemPrompt}

你是一个后台文章解析 agent。收到指令后，调用工具完成工作，直接使用工具裸名（不加任何前缀）。完成任务后直接结束，无需寒暄。`;

    try {
      const result = await runOnce({
        systemPrompt,
        prompt,
        tools: toolDefs,
        model,
        profile: resolvedProfile,
        thinkingLevel,
        signal: abortController.signal,
        maxTurns: 30,
        onLog: (m) => {
          if (m.startsWith('[tool-error]')) taskLogger.warn(m);
          else taskLogger.info(m);
        },
      });

      if (!result.ok) {
        if (result.cancelled) {
          taskLogger.info('文章解析被取消:', articleId);
        } else {
          taskLogger.error('文章解析任务失败:', result.error);
        }
      } else {
        taskLogger.info('AI 解析完成');
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
    } finally {
      this.currentAbortController = null;
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

    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
      ?? appSettings.ai.digestModelSelection
      ?? appSettings.ai.defaultModelSelection;

    let model: PiModelResult['model'];
    let tier: string;
    let resolvedProfile: ModelProfile;
    let thinkingLevel: ThinkingLevel;
    try {
      const r = resolvePiModel(appSettings, selection, null, null);
      model = r.model;
      tier = r.tier;
      resolvedProfile = r.profile;
      thinkingLevel = r.thinkingLevel;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('组级摘要卡任务终止:', error);
      return { groupId, saved: false, error };
    }

    const { createGroupDigestToolDefs } = await import('./tools/group-digest-tools.js');
    const { createDigestToolDefs } = await import('./tools/digest-tools.js');
    const { createGroupToolDefs } = await import('./tools/group-tools.js');

    let saved = false;
    let backgroundSaved = false;
    const groupDigestDefs = createGroupDigestToolDefs(
      workspaceId, workspacePath, groupId, dirtyConversations,
      () => { saved = true; },
      () => { backgroundSaved = true; },
    );
    const transcriptDefs = createDigestToolDefs(workspaceId, workspacePath);
    // group-tools 有 2 个工具，digest 任务只需 ListGroupFiles
    const groupDefs = createGroupToolDefs(workspaceId, groupId)
      .filter((t) => t.name === 'ListGroupFiles');

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

    // 分类词汇表（打 tag 时优先复用）：冷启动（无分类）不注入此段
    const { readIndex: readCategoryIndex } = await import('../services/memory/smart-category-store.js');
    const categoryIdx = await readCategoryIndex(workspaceId);
    const categoryVocabLines = categoryIdx.categories.length > 0
      ? [
        '',
        '当前工作区分类词汇表（打 tag 时优先从中选择，实在没合适才自造）：',
        ...categoryIdx.categories.map((c) => `- ${c.name}: [${c.anchorTags.join(', ')}]`),
      ]
      : [];

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
      `- shared/_notes/ 文件清单（通过 ListGroupFiles 可读取完整内容）:`,
      notesFileText,
      ...categoryVocabLines,
    ].join('\n');

    const prompt = `${template}${contextSection}`;

    const { runOnce } = await import('./pi/run-once.js');
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    const systemPrompt = '你是一个后台内容提炼 agent。收到指令后，调用工具完成工作，直接使用工具裸名（不加任何前缀）。完成任务后直接结束，无需寒暄。';

    try {
      const result = await runOnce({
        systemPrompt,
        prompt,
        tools: [...groupDigestDefs, ...transcriptDefs, ...groupDefs],
        model,
        profile: resolvedProfile,
        thinkingLevel,
        signal: abortController.signal,
        maxTurns: 30,
        onLog: (m) => {
          if (m.startsWith('[tool-error]')) taskLogger.warn(m);
          else taskLogger.info(m);
        },
      });

      if (!result.ok) {
        if (result.cancelled) {
          taskLogger.info('组级摘要卡被取消:', groupId);
          return { groupId, saved: false, backgroundSaved, cancelled: true };
        }
        taskLogger.error('组级摘要卡任务失败:', result.error);
        return { groupId, saved: false, error: result.error };
      }

      taskLogger.info('组级摘要卡任务完成，耗时:', Date.now() - startedAt, 'ms', '| saved:', saved, '| background:', backgroundSaved, '| tier:', tier);
      return { groupId, saved, backgroundSaved, tier, profileName: resolvedProfile.name };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('组级摘要卡意外失败:', errorMsg);
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

    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
      ?? appSettings.ai.reviewModelSelection
      ?? appSettings.ai.defaultModelSelection;

    let model: PiModelResult['model'];
    let tier: string;
    let resolvedProfile: ModelProfile;
    let thinkingLevel: ThinkingLevel;
    try {
      const r = resolvePiModel(appSettings, selection, null, null);
      model = r.model;
      tier = r.tier;
      resolvedProfile = r.profile;
      thinkingLevel = r.thinkingLevel;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('跨会话复盘任务终止:', error);
      return { workspaceId, saved: false, error };
    }

    const { createReviewToolDefs } = await import('./tools/review-tools.js');
    const { createMemoryToolDefs } = await import('./tools/memory-tools.js');
    const { runOnce } = await import('./pi/run-once.js');
    let saved = false;
    // 10 个工具全部授权：review 5 个 + memory autonomous 5 个
    const reviewDefs = createReviewToolDefs(workspaceId, workspacePath, () => { saved = true; });
    const memoryDefs = createMemoryToolDefs(workspacePath, { autonomous: true });

    const { loadReviewPrompt } = await import('../services/memory/review-prompt.js');
    const template = await loadReviewPrompt(this.configDir);
    const prompt = template;

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    const systemPrompt = '你是一个后台内容复盘 agent。收到指令后，调用工具完成工作，直接使用工具裸名（不加任何前缀）。完成任务后直接结束，无需寒暄。';

    try {
      const result = await runOnce({
        systemPrompt,
        prompt,
        tools: [...reviewDefs, ...memoryDefs],
        model,
        profile: resolvedProfile,
        thinkingLevel,
        signal: abortController.signal,
        maxTurns: 30,
        onLog: (m) => {
          if (m.startsWith('[tool-error]')) taskLogger.warn(m);
          else taskLogger.info(m);
        },
      });

      if (!result.ok) {
        if (result.cancelled) {
          taskLogger.info('跨会话复盘被取消:', workspaceId);
          return { workspaceId, saved: false, cancelled: true };
        }
        taskLogger.error('跨会话复盘任务失败:', result.error);
        return { workspaceId, saved: false, error: result.error };
      }

      taskLogger.info('跨会话复盘任务完成，耗时:', Date.now() - startedAt, 'ms', '| saved:', saved, '| tier:', tier);
      return { workspaceId, saved, tier, profileName: resolvedProfile.name };
    } catch (error) {
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

    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
      ?? appSettings.ai.categorizeModelSelection
      ?? appSettings.ai.defaultModelSelection;

    let model: PiModelResult['model'];
    let tier: string;
    let resolvedProfile: ModelProfile;
    let thinkingLevel: ThinkingLevel;
    try {
      const r = resolvePiModel(appSettings, selection, null, null);
      model = r.model;
      tier = r.tier;
      resolvedProfile = r.profile;
      thinkingLevel = r.thinkingLevel;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('智能分类任务终止:', error);
      return { workspaceId, mode, decisions: AgentWorker.emptyCategorizeDecisions(), error };
    }

    const threshold = appSettings.smartCategory?.threshold ?? 0.5;

    // ──── 内部辅助：处理单张摘要卡（Step A + LLM）────

    const {
      readIndex, writeIndex, pushGroup, removeGroupEverywhere, appendDecision,
    } = await import('../services/memory/smart-category-store.js');
    const { matchByThreshold, pickRedistributeCandidates } = await import('../services/memory/smart-category-engine.js');
    const { parseGroupDigest, getGroupsRootDir, getGroupDigestPath } = await import('../services/memory/group-digest-store.js');
    const { getByWorkspaceId } = await import('../services/conversation-service.js');
    const groupService = await import('../services/group-service.js');
    const { deriveGroupTitle } = await import('../services/group-helpers.js');
    const { loadCategorizePrompt } = await import('../services/memory/categorize-prompt.js');
    const { createCategoryToolDefs } = await import('./tools/category-tools.js');
    const { runOnce } = await import('./pi/run-once.js');
    const fs = await import('node:fs/promises');

    // 授权子集：ListCategories / SaveCategoryJoin / SaveCategoryNew / SaveCategoryMerge（不含 PruneCategoryTags）
    const sessionCategoryDefs = createCategoryToolDefs()
      .filter((t) => ['ListCategories', 'SaveCategoryJoin', 'SaveCategoryNew', 'SaveCategoryMerge'].includes(t.name));

    const systemPromptCategorize = '你是一个后台智能分类 agent。收到指令后，调用工具完成工作，直接使用工具裸名（不加任何前缀）。完成任务后直接结束，无需寒暄。';

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
      const group = await groupService.getGroup(workspaceId, groupId);
      if (!group || group.archivedAt !== undefined) return 'skip';

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
        idx = removeGroupEverywhere(idx, groupId);
        const best = matches[0];
        const cat = idx.categories.find((c) => c.id === best.categoryId);
        if (cat) {
          const updated = pushGroup(cat, groupId);
          idx.categories = idx.categories.map((c) => (c.id === cat.id ? updated : c));
        }
        idx = appendDecision(idx, {
          time: new Date().toISOString(),
          groupId,
          decision: 'match',
          reason: `matched ${best.categoryId}`,
        });
        await writeIndex(workspaceId, idx);
        taskLogger.info('Step A 命中:', groupId, '→', best.categoryId);
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
          titleByGroup.set(gid, deriveGroupTitle(g));
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

      let decided: 'join' | 'new' | 'error' = 'error';

      const queryResult = await runOnce({
        systemPrompt: systemPromptCategorize,
        prompt: userContext,
        tools: sessionCategoryDefs,
        model,
        profile: resolvedProfile,
        thinkingLevel,
        signal: abortController.signal,
        maxTurns: 30,
        onLog: (m) => {
          if (m.startsWith('[tool-error]')) taskLogger.warn(m);
          else taskLogger.info(m);
        },
      });

      if (!queryResult.ok) {
        if (queryResult.cancelled) {
          taskLogger.info('智能分类被取消:', groupId);
          return 'error';
        }
        const errorMsg = queryResult.error;
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
      } else {
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
        const existingIndex = await readIndex(workspaceId);
        const activeGroupIds = new Set(
          (await groupService.listActiveGroups(workspaceId)).map((group) => group.id),
        );
        const preservedCategories = existingIndex.categories
          .map((category) => ({
            ...category,
            groupIds: category.groupIds.filter((groupId) => !activeGroupIds.has(groupId)),
          }))
          .filter((category) => category.groupIds.length > 0);
        taskLogger.info('full-rebuild: 重建活跃话题分类并保留归档引用');
        await writeIndex(workspaceId, { categories: preservedCategories, recentDecisions: [] });

        const groupsRoot = getGroupsRootDir(workspaceId);
        let dirents: import('node:fs').Dirent[];
        try {
          dirents = await fs.readdir(groupsRoot, { withFileTypes: true });
        } catch {
          dirents = [];
        }
        // 只扫子目录 groups/<groupId>/digest.md，跳过下划线开头的保留目录
        const cards: { path: string; groupId: string; createdAt: string }[] = [];
        for (const dirent of dirents) {
          if (!dirent.isDirectory()) continue;
          if (dirent.name.startsWith('_')) continue;
          const p = getGroupDigestPath(workspaceId, dirent.name);
          try {
            const raw = await fs.readFile(p, 'utf-8');
            const card = parseGroupDigest(raw);
            if (card?.groupId) {
              cards.push({ path: p, groupId: card.groupId, createdAt: card.createdAt });
            }
          } catch { /* 跳过解析失败或文件不存在 */ }
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
   * 处理存量分类整理任务（CATEGORIZE_ORGANIZE）
   *
   * 一次性 headless query：agent 自主调 ListCategories → PruneCategoryTags（压 anchorTags ≤10）
   * + SaveCategory(MERGE_CATEGORIES)（合并语义重合分类）。与 CATEGORIZE_SESSION 共享同一串行队列（互斥）。
   * 模型按 categorizeModelSelection 覆盖（默认 haiku）；可取消。
   */
  private async handleCategorizeOrganizeTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').CategorizeOrganizeSessionPayload;
    const { workspaceId } = payload;

    taskLogger.info('开始存量分类整理任务:', '| workspace:', workspaceId);
    const startedAt = Date.now();

    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
      ?? appSettings.ai.categorizeModelSelection
      ?? appSettings.ai.defaultModelSelection;

    let model: PiModelResult['model'];
    let tier: string;
    let resolvedProfile: ModelProfile;
    let thinkingLevel: ThinkingLevel;
    try {
      const r = resolvePiModel(appSettings, selection, null, null);
      model = r.model;
      tier = r.tier;
      resolvedProfile = r.profile;
      thinkingLevel = r.thinkingLevel;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      taskLogger.error('存量分类整理任务终止:', error);
      return { workspaceId, decisions: { prune: 0, merge: 0 }, error };
    }

    const { readIndex: readCategoryIndex } = await import('../services/memory/smart-category-store.js');
    const { createCategoryToolDefs } = await import('./tools/category-tools.js');
    const { loadOrganizePrompt } = await import('../services/memory/organize-prompt.js');

    const idxBefore = await readCategoryIndex(workspaceId);
    const template = await loadOrganizePrompt(this.configDir);
    const prompt = [
      template,
      '',
      '## 本次输入',
      `- workspaceId: ${workspaceId}`,
      `- 当前分类数: ${idxBefore.categories.length}`,
      '- 调 ListCategories / PruneCategoryTags / SaveCategory 时使用此 workspaceId',
    ].join('\n');

    // 授权子集：ListCategories / PruneCategoryTags / SaveCategoryMerge（不含 Join / New）
    const categoryDefs = createCategoryToolDefs()
      .filter((t) => ['ListCategories', 'PruneCategoryTags', 'SaveCategoryMerge'].includes(t.name));

    const { runOnce } = await import('./pi/run-once.js');
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    const systemPrompt = '你是一个后台分类整理 agent。收到指令后，调用工具完成工作，直接使用工具裸名（不加任何前缀）。完成任务后直接结束，无需寒暄。';

    try {
      const result = await runOnce({
        systemPrompt,
        prompt,
        tools: categoryDefs,
        model,
        profile: resolvedProfile,
        thinkingLevel,
        signal: abortController.signal,
        maxTurns: 30,
        onLog: (m) => {
          if (m.startsWith('[tool-error]')) taskLogger.warn(m);
          else taskLogger.info(m);
        },
      });

      if (!result.ok) {
        if (result.cancelled) {
          taskLogger.info('存量分类整理被取消:', workspaceId);
          return { workspaceId, decisions: { prune: 0, merge: 0 }, cancelled: true };
        }
        taskLogger.error('存量分类整理任务失败:', result.error);
        return { workspaceId, decisions: { prune: 0, merge: 0 }, error: result.error };
      }

      // 统计本次新增的决策条数：recentDecisions 是头插法（按时间倒序），
      // 单队列串行保证整理期间不会有其他决策写入，遇到 startedAt 之前的条目即可停止统计
      const idxAfter = await readCategoryIndex(workspaceId);
      const decisions = { prune: 0, merge: 0 };
      for (const d of idxAfter.recentDecisions) {
        if (new Date(d.time).getTime() < startedAt) break;
        if (d.decision === 'prune') decisions.prune++;
        else if (d.decision === 'merge') decisions.merge++;
      }

      taskLogger.info('存量分类整理任务完成，耗时:', Date.now() - startedAt, 'ms', '| decisions:', decisions, '| tier:', tier);
      return { workspaceId, decisions, tier, profileName: resolvedProfile.name };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('存量分类整理任务失败:', errorMsg);
      return { workspaceId, decisions: { prune: 0, merge: 0 }, error: errorMsg };
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

/**
 * 从 skillsDir/SKILL.md 读取文章解析 Skill 正文（剥 frontmatter），作为 systemPrompt 注入。
 * 替代旧 SDK 的 plugins skill 发现机制。
 */
async function loadArticleParseSkill(skillsDir: string): Promise<string> {
  const fs = await import('fs/promises');
  const skillPath = path.join(skillsDir, 'SKILL.md');
  try {
    const raw = await fs.readFile(skillPath, 'utf-8');
    const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
    return fmMatch ? raw.slice(fmMatch[0].length) : raw;
  } catch {
    return '（SKILL.md 不存在，按通用常识解析文章）';
  }
}

function buildV2ParsePrompt(p: V2PromptParams): string {
  return `**任务上下文：**
- articleId: ${p.articleId}
- articleDir: ${p.articleDir}
- url: ${p.url}
- platform: ${p.platform || '(未识别)'}
- skillsDir: ${p.skillsDir}
- trigger: ${p.trigger}
${p.scriptError ? `- 脚本错误：${p.scriptError.type} — ${p.scriptError.message}` : ''}
${p.readabilityError ? `- Readability 错误：${p.readabilityError}` : ''}

现在按上述 Skill 定义的步骤完成解析。
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
