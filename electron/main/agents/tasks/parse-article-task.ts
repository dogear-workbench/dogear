import path from 'node:path';
import type { AgentTask } from '../task-types.js';
import type { ModelProfile } from '../../services/settings-types.js';
import type { PiModelResult } from '../pi/provider.js';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { TaskHandlerContext } from './task-context.js';
import { writeParseTrace } from './parse-trace.js';

/**
 * 文章解析任务（pi runOnce 驱动）
 *
 * 流程：
 * - 手动读取 SKILL.md（剥 frontmatter）作为 systemPrompt
 * - AI 按 SKILL.md 定义的调试循环工作
 * - trigger 说明触发原因（script_failed / parse_failed / user_requested）
 *
 * 产出：
 * - 若有改进：通过 dogear__SaveParsedArticle 覆盖 meta.json / content.md
 * - 若发现新平台脚本模式：通过 dogear__UpdatePlatformScript 更新 platforms/<platform>.py
 * - history.jsonl 追加一行解析记录（共用 parse-ai-fallback 的统一入口）
 */
export async function handleParseArticleTask(task: AgentTask, taskLogger: any, ctx: TaskHandlerContext): Promise<any> {
  const payload = task.payload as import('../task-types.js').ParseArticlePayload;
  const { articleId, articlePath, workspaceId, workspacePath, url, skillsDir } = payload;
  const platform = payload.platform ?? null;
  const trigger = payload.trigger ?? 'parse_failed';
  const scriptError = payload.scriptError;
  const readabilityError = payload.readabilityError;

  taskLogger.info('开始文章解析任务:', articleId, '| trigger:', trigger, '| platform:', platform ?? '(未识别)');

  const startedAt = Date.now();

  // 进入 AI 解析中状态 → 回写 meta.json + 广播事件
  const { updateArticleParseStatus } = await import('../../services/article-service.js');
  await updateArticleParseStatus(workspaceId, workspacePath, articleId, 'ai_parsing').catch((err) => {
    taskLogger.warn('写入 ai_parsing 状态失败:', err);
  });
  ctx.sendMessage({
    type: 'articleParseStatusChanged',
    articleId,
    workspaceId,
    parseStatus: 'ai_parsing',
  });

  // 读取设置 + 解析模型
  const { loadSettingsFromDir } = await import('../agent-query-config.js');
  const { resolvePiModel } = await import('../pi/provider.js');
  const appSettings = await loadSettingsFromDir(ctx.configDir);

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
    await updateArticleParseStatus(workspaceId, workspacePath, articleId, errorStatus, failureTitleFromUrl(url)).catch(() => {});
    ctx.sendMessage({ type: 'articleParseStatusChanged', articleId, workspaceId, parseStatus: errorStatus });
    return { articleId, articleSaved: false, parseStatus: errorStatus, error };
  }

  // 手动读取 SKILL.md（剥 frontmatter）作为 systemPrompt
  const skillSystemPrompt = await loadArticleParseSkill(skillsDir);

  // 创建文章解析工具
  const { createArticleParseToolDefs } = await import('../tools/article-parse-tools.js');
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
    articlePath,
    url,
    platform,
    skillsDir,
    trigger,
    scriptError,
    readabilityError,
  });

  const { runOnce } = await import('../pi/run-once.js');
  const abortController = new AbortController();
  ctx.setAbortController(abortController);

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
      collectMessages: true,
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

    // 留痕 md 写入失败不影响任务（writeParseTrace 内部吞错，null 时仅告警）
    const traceFile = await writeParseTrace(
      {
        articleId,
        workspacePath,
        url,
        platform,
        trigger,
        durationMs: Date.now() - startedAt,
        articleSaved,
        scriptUpdated,
        statusLabel: !result.ok
          ? result.cancelled ? '已取消' : `失败：${result.error}`
          : articleSaved ? '成功（文章已保存）' : '完成（未保存文章，质量警告）',
        error: result.ok ? undefined : result.error,
        model: model.id,
      },
      result.transcript,
    );
    if (!traceFile) taskLogger.warn('解析留痕写入失败:', articleId);

    // 追加历史记录（与管线层共用统一追加入口）
    const { appendParseHistoryEntry } = await import('../../services/article/parse-ai-fallback.js');
    await appendParseHistoryEntry({
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
    }, { skillsDir });

    // 判定最终状态：若 AI 成功 save → ai_enhanced；否则 → quality_warning（AI 也无法解析）
    const finalStatus = articleSaved
      ? 'ai_enhanced' as const
      : 'quality_warning' as const;

    await updateArticleParseStatus(
      workspaceId,
      workspacePath,
      articleId,
      finalStatus,
      finalStatus === 'quality_warning' ? failureTitleFromUrl(url) : undefined,
    ).catch((err) => {
      taskLogger.warn('写入最终状态失败:', err);
    });
    ctx.sendMessage({
      type: 'articleParseStatusChanged',
      articleId,
      workspaceId,
      parseStatus: finalStatus,
    });

    taskLogger.info('文章解析任务完成，耗时:', Date.now() - startedAt, 'ms', '| 最终状态:', finalStatus);

    return {
      articleId,
      articleSaved,
      scriptUpdated,
      parseStatus: finalStatus,
      traceFile,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    taskLogger.error('文章解析任务失败:', errorMsg);

    const traceFile = await writeParseTrace(
      {
        articleId,
        workspacePath,
        url,
        platform,
        trigger,
        durationMs: Date.now() - startedAt,
        articleSaved,
        scriptUpdated: null,
        statusLabel: `失败：${errorMsg}`,
        error: errorMsg,
        model: model.id,
      },
      undefined,
    );
    if (!traceFile) taskLogger.warn('解析留痕写入失败:', articleId);

    // 记录失败历史
    const { appendParseHistoryEntry } = await import('../../services/article/parse-ai-fallback.js');
    await appendParseHistoryEntry({
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
    }, { skillsDir }).catch(() => { /* 历史记录失败不影响主流程 */ });

    const errorStatus = 'failed' as const;
    await updateArticleParseStatus(workspaceId, workspacePath, articleId, errorStatus, failureTitleFromUrl(url)).catch(() => {});
    ctx.sendMessage({
      type: 'articleParseStatusChanged',
      articleId,
      workspaceId,
      parseStatus: errorStatus,
    });

    return {
      articleId,
      articleSaved: false,
      parseStatus: errorStatus,
      error: errorMsg,
      traceFile,
    };
  } finally {
    ctx.setAbortController(null);
  }
}

function decodeUriSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function failureTitleFromUrl(url: string): string {
  let tail = url;
  try {
    const parsed = new URL(url);
    tail = parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.hostname;
  } catch {
    tail = url;
  }
  return `(解析失败) ${decodeUriSafe(tail).slice(0, 40)}`;
}

interface V2PromptParams {
  articleId: string;
  articlePath: string;
  url: string;
  platform: string | null;
  skillsDir: string;
  trigger: string;
  scriptError?: { type: string; message: string };
  readabilityError?: string;
}

/**
 * 从 skillsDir/SKILL.md 读取文章解析 Skill 正文（剥 frontmatter），作为 systemPrompt 注入。
 * 替代旧 SDK 的 plugins skill 发现机制。场景页展示路由与解析任务共用（同源同 fallback）。
 */
export async function loadArticleParseSkill(skillsDir: string): Promise<string> {
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

/** 读 SKILL.md 原始全文（含 frontmatter 元信息）供场景页展示；缺失返回 null */
export async function readArticleParseSkillMd(skillsDir: string): Promise<string | null> {
  const fs = await import('fs/promises');
  try {
    return await fs.readFile(path.join(skillsDir, 'SKILL.md'), 'utf-8');
  } catch {
    return null;
  }
}

function buildV2ParsePrompt(p: V2PromptParams): string {
  return `**任务上下文：**
- articleId: ${p.articleId}
- articlePath: ${p.articlePath}
- url: ${p.url}
- platform: ${p.platform || '(未识别)'}
- skillsDir: ${p.skillsDir}
- trigger: ${p.trigger}
${p.scriptError ? `- 脚本错误：${p.scriptError.type} — ${p.scriptError.message}` : ''}
${p.readabilityError ? `- Readability 错误：${p.readabilityError}` : ''}

现在按上述 Skill 定义的步骤完成解析。
所有工具参数路径都要传入完整绝对路径。`;
}




