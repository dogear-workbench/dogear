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

        case TaskType.CUSTOM_AGENT:
          result = await this.handleCustomAgentTask(task, taskLogger);
          break;

        case TaskType.STATE_EXTRACT:
          result = await this.handleStateExtractTask(task, taskLogger);
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
   * - 若有改进：通过 dogear__SaveParsedArticle 覆盖 meta.json / content.md
   * - 若发现新平台脚本模式：通过 dogear__UpdatePlatformScript 更新 platforms/<platform>.py
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
      ?? appSettings.ai.parseModelSelection
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
      if (def.name === 'dogear__SaveParsedArticle') {
        const orig = def.handler;
        def.handler = async (args: any) => {
          const result = await orig(args);
          if (!result.isError) {
            articleSaved = true;
            taskLogger.info('文章已保存');
          }
          return result;
        };
      } else if (def.name === 'dogear__UpdatePlatformScript') {
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

你是一个后台文章解析 agent。收到指令后，调用工具完成工作，直接使用工具清单里给出的完整工具名。完成任务后直接结束，无需寒暄。`;

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
        layer: 'ai',
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
        layer: 'ai',
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
   * 处理话题状态卡增量抽取任务（STATE_EXTRACT）
   *
   * 逐会话处理（通常 1-2 个）：readSessionBranchEntries 读 sourcesSeen mtime 之后的新增 entry →
   * transcript-adapter 清洗 → prompt（新增逐字稿 + 本组现有条目）→ runOnce 便宜模型，
   * agent 调 emit_state_increment 工具输出增量（toPiTools 层 zod parse + handler 内 uuid/id 保真校验）→
   * mergeIncrementAndSave 写回状态卡并推进 sourcesSeen。单会话失败记 failed 继续下一个，
   * 失败会话不推进 sourcesSeen（保持滞后标注，下轮重抽；合并去重保证重抽幂等）。
   * 模型依次回退：payload.modelSelection → ai.stateModelSelection → ai.defaultModelSelection。
   */
  private async handleStateExtractTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').StateExtractPayload;
    const { workspaceId, groupId, conversations } = payload;

    taskLogger.info('开始话题状态抽取任务:', groupId, '| workspace:', workspaceId, '| conversations:', conversations.length);
    const startedAt = Date.now();

    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
      ?? appSettings.ai.stateModelSelection
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
      taskLogger.error('话题状态抽取任务终止:', error);
      return { groupId, processed: 0, skipped: 0, failed: conversations.length, error };
    }

    const { readTopicStateCard, mergeIncrementAndSave } = await import('../services/memory/background-store.js');
    const { TOPIC_CARD_CATEGORIES, StateIncrementSchema } = await import('../services/memory/state-card.js');
    const { readSessionBranchEntries } = await import('./pi-session/session-history-reader.js');
    const { cleanMessagesFromEntries } = await import('./pi-session/transcript-adapter.js');
    const { loadStateExtractPrompt } = await import('../services/memory/state-extract-prompt.js');
    const { defineTool } = await import('./pi/tool-adapter.js');
    const { runOnce } = await import('./pi/run-once.js');

    const template = await loadStateExtractPrompt(this.configDir);
    const { getGroup } = await import('../services/group-service.js');
    const group = await getGroup(workspaceId, groupId);
    const groupTitle = group?.title?.trim() || '';
    const systemPrompt = '你是一个后台话题状态抽取 agent。读完输入后调用 emit_state_increment 工具输出增量，完成后直接结束，无需寒暄。';

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    const processed: string[] = [];
    const skipped: string[] = [];
    const failures: Array<{ conversationId: string; error: string }> = [];

    const tokens = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    let hasTokens = false;

    try {
      for (const conv of conversations) {
        if (abortController.signal.aborted) break;

        try {
          // 每会话重读卡：上个会话的写入要立刻对下个会话的旧条目/resolved 池可见
          const card = await readTopicStateCard(workspaceId, groupId);
          const lastSeenMtime = card?.sourcesSeen.find((s) => s.sessionId === conv.sessionId)?.mtime;

          const entries = await readSessionBranchEntries(workspaceId, conv.sessionId);
          const allMessages = cleanMessagesFromEntries(entries);
          const newMessages = lastSeenMtime === undefined
            ? allMessages
            : allMessages.filter((m) => Date.parse(m.timestamp) > lastSeenMtime);

          // resolved 候选池 = 本组全部六类条目（与 mergeIncrement 跨类退休范围一致）
          const oldEntries = new Map<string, { id: string; category: string; text: string }>();
          if (card) {
            for (const cat of TOPIC_CARD_CATEGORIES) {
              for (const e of card.entries[cat]) {
                oldEntries.set(e.id, { id: e.id, category: cat, text: e.text });
              }
            }
          }

          // 无新增可抽消息 → 空增量合并只推进 sourcesSeen，不白跑模型
          if (newMessages.length === 0) {
            await mergeIncrementAndSave(workspaceId, groupId, StateIncrementSchema.parse({}), {
              conversationId: conv.conversationId,
              dirtySources: [conv],
            });
            skipped.push(conv.conversationId);
            continue;
          }

          const uuidSet = new Set(newMessages.map((m) => m.uuid));
          const transcriptText = newMessages.map((m) => m.formatted).join('\n\n');
          const oldEntryText = oldEntries.size
            ? [...oldEntries.values()].map((e) => `- [${e.category}] ${e.id}: ${e.text}`).join('\n')
            : '（无）';

          let increment: import('../services/memory/state-card.js').StateIncrement | null = null;

          const emitTool = defineTool(
            'emit_state_increment',
            '输出话题状态增量',
            '把本次逐字稿中抽取到的状态增量按 schema 一次性提交。uuid 必须来自逐字稿头部，resolved 必须引用「本组现有条目」列表中的 id。',
            StateIncrementSchema,
            async (args) => {
              const badUuids = new Set<string>();
              for (const cat of TOPIC_CARD_CATEGORIES) {
                for (const item of args[cat]) {
                  if (!uuidSet.has(item.uuid)) badUuids.add(item.uuid);
                }
              }
              if (args.topicChange?.uuid && !uuidSet.has(args.topicChange.uuid)) badUuids.add(args.topicChange.uuid);
              const badResolved = args.resolved.filter((id) => !oldEntries.has(id));
              if (badUuids.size > 0 || badResolved.length > 0) {
                const lines = [
                  '校验失败，未接受本次提交：',
                  ...(badUuids.size > 0 ? [`非法 uuid（必须逐字复制逐字稿头部的 id）：${[...badUuids].join(', ')}`] : []),
                  ...(badResolved.length > 0 ? [`resolved 引用了不存在的条目 id（只能用「本组现有条目」列出的 id）：${badResolved.join(', ')}`] : []),
                  '请修正后重新调用 emit_state_increment。',
                ];
                return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError: true };
              }
              increment = args;
              const itemCount = args.completed.length + args.inProgress.length + args.decisions.length
                + args.blockers.length + args.nextSteps.length + args.openQuestions.length;
              return { content: [{ type: 'text' as const, text: `已接受增量：${itemCount} 条新条目，${args.resolved.length} 条 resolved${args.topicChange ? '，含话题变更' : ''}` }] };
            },
          );

          const prompt = [
            template,
            '',
            '## 本次输入',
            `- groupId: ${groupId}`,
            `- conversationId: ${conv.conversationId}`,
            `- sessionId: ${conv.sessionId}`,
            `- 当前组标题: ${groupTitle || '（空）'}`,
            '',
            `### 新增逐字稿（上次提炼位置之后的新增消息，共 ${newMessages.length} 条）`,
            '',
            transcriptText,
            '',
            '### 本组现有条目（resolved 只能引用这里的 id）',
            oldEntryText,
          ].join('\n');

          const result = await runOnce({
            systemPrompt,
            prompt,
            tools: [emitTool],
            model,
            profile: resolvedProfile,
            thinkingLevel,
            signal: abortController.signal,
            maxTurns: 5,
            revive: {
              shouldContinue: () => increment === null,
              continuePrompt: '你还没有成功提交任何增量。立即调用 emit_state_increment 工具（uuid 从逐字稿头部逐字复制，resolved 只引用现有条目列表中的 id）。',
              maxRevives: 1,
            },
            onLog: (m) => {
              if (m.startsWith('[tool-error]')) taskLogger.warn(m);
              else taskLogger.info(m);
            },
          });

          if (result.ok) {
            if (result.usage) {
              hasTokens = true;
              tokens.inputTokens += result.usage.inputTokens;
              tokens.outputTokens += result.usage.outputTokens;
              tokens.cacheReadInputTokens += result.usage.cacheReadInputTokens;
              tokens.cacheCreationInputTokens += result.usage.cacheCreationInputTokens;
            }
          } else {
            throw new Error(result.cancelled ? '已取消' : result.error);
          }
          if (!increment) throw new Error('模型未成功调 emit_state_increment');

          await mergeIncrementAndSave(workspaceId, groupId, increment, {
            conversationId: conv.conversationId,
            dirtySources: [conv],
          });
          processed.push(conv.conversationId);
          taskLogger.info(`会话 ${conv.conversationId} 抽取完成`);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          failures.push({ conversationId: conv.conversationId, error: errorMsg });
          taskLogger.warn(`会话 ${conv.conversationId} 抽取失败（不推进 sourcesSeen，保持滞后）:`, errorMsg);
        }
      }

      if (abortController.signal.aborted) {
        taskLogger.info('话题状态抽取被取消:', groupId);
        return { groupId, processed: processed.length, skipped: skipped.length, failed: failures.length, cancelled: true, tokens: hasTokens ? { ...tokens } : undefined };
      }

      taskLogger.info('话题状态抽取任务完成，耗时:', Date.now() - startedAt, 'ms', '| processed:', processed.length, '| skipped:', skipped.length, '| failed:', failures.length, '| tier:', tier);
      return {
        groupId,
        processed: processed.length,
        skipped: skipped.length,
        failed: failures.length,
        failures,
        tier,
        profileName: resolvedProfile.name,
        tokens: hasTokens ? { ...tokens } : undefined,
      };
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * 处理定时计划自定义任务（CUSTOM_AGENT）
   *
   * 一次性 headless query：按 payload 组装系统提示词与工具集（buildCustomToolSet，
   * 按设置开关过滤），执行用户 prompt，产物由 agent 用工具自己写入。
   * 模型：payload.modelSelection ?? settings.ai.defaultModelSelection，解析失败返回明确 error。
   */
  private async handleCustomAgentTask(task: AgentTask, taskLogger: any): Promise<any> {
    const payload = task.payload as import('./task-types.js').CustomAgentTaskPayload;
    const { workspaceId, workspacePath } = payload;

    taskLogger.info('开始自定义任务:', payload.taskName, '| workspace:', workspaceId);
    const startedAt = Date.now();

    const fs = await import('node:fs/promises');
    try {
      await fs.stat(workspacePath);
    } catch {
      const error = `工作区路径不存在: ${workspacePath}`;
      taskLogger.error('自定义任务终止:', error);
      return { ok: false, error };
    }

    const { loadSettingsFromDir } = await import('./agent-query-config.js');
    const { resolvePiModel } = await import('./pi/provider.js');
    const appSettings = await loadSettingsFromDir(this.configDir);

    const selection = payload.modelSelection
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
      taskLogger.error('自定义任务终止（模型解析失败）:', error);
      return { ok: false, error };
    }

    const { buildCustomToolSet } = await import('../services/scheduler/custom-agent-tools.js');
    const { buildCustomAgentPrompt } = await import('../services/scheduler/custom-agent-prompt.js');
    const tools = await buildCustomToolSet(workspaceId, workspacePath, this.configDir, payload.toolPacksOverride);
    const { systemPrompt, prompt } = buildCustomAgentPrompt(payload);
    taskLogger.info('工具集组装完成:', tools.map((t) => t.name).join(', '));

    const { runOnce } = await import('./pi/run-once.js');
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    try {
      const result = await runOnce({
        systemPrompt,
        prompt,
        tools,
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
          taskLogger.info('自定义任务被取消:', payload.taskName);
          return { ok: false, error: '已取消', cancelled: true };
        }
        taskLogger.error('自定义任务失败:', result.error);
        return { ok: false, error: result.error };
      }

      const summary = result.lastText?.trim().slice(0, 500) || undefined;
      taskLogger.info('自定义任务完成，耗时:', Date.now() - startedAt, 'ms', '| tier:', tier, '| 产物自述:', summary ? '有' : '无');
      return {
        ok: true,
        summary,
        tokens: result.usage,
        tier,
        profileName: resolvedProfile.name,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLogger.error('自定义任务意外失败:', errorMsg);
      return { ok: false, error: errorMsg };
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
  layer?: 'script' | 'readability' | 'browser' | 'ai';
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
