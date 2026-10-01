import type { AgentTask } from '../task-types.js';
import type { ModelProfile } from '../../services/settings-types.js';
import type { PiModelResult } from '../pi/provider.js';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { TaskHandlerContext } from './task-context.js';

/**
 * 定时计划自定义任务（CUSTOM_AGENT）
 *
 * 一次性 headless query：按 payload 组装系统提示词与工具集（buildCustomToolSet，
 * 按设置开关过滤），执行用户 prompt，产物由 agent 用工具自己写入。
 * 模型：payload.modelSelection ?? settings.ai.defaultModelSelection，解析失败返回明确 error。
 */
export async function handleCustomAgentTask(task: AgentTask, taskLogger: any, ctx: TaskHandlerContext): Promise<any> {
  const payload = task.payload as import('../task-types.js').CustomAgentTaskPayload;
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

  const { loadSettingsFromDir } = await import('../agent-query-config.js');
  const { resolvePiModel } = await import('../pi/provider.js');
  const appSettings = await loadSettingsFromDir(ctx.configDir);

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

  const { buildCustomToolSet } = await import('../../services/scheduler/custom-agent-tools.js');
  const { buildCustomAgentPrompt } = await import('../../services/scheduler/custom-agent-prompt.js');
  const { loadAllSkillEntries, formatSkillIndexForPrompt, createSkillTool } = await import('../../agents/pi-session/skill-loader.js');
  const tools = await buildCustomToolSet(workspaceId, workspacePath, ctx.configDir, payload.toolPacksOverride);
  const { systemPrompt, prompt } = buildCustomAgentPrompt(payload);
  const overrideSet = payload.skillsOverride?.length ? new Set(payload.skillsOverride) : null;
  const skillEntries = overrideSet ? (await loadAllSkillEntries()).filter((e) => overrideSet.has(e.name)) : [];
  const skillIndexText = formatSkillIndexForPrompt(skillEntries);
  const fullSystemPrompt = [systemPrompt, skillIndexText].filter(Boolean).join('\n\n');
  if (skillEntries.length) tools.push(createSkillTool(skillEntries));
  taskLogger.info('工具集组装完成:', tools.map((t) => t.name).join(', '), '| 挂载 skill:', skillEntries.map((e) => e.name).join(', ') || '无');

  const { runOnce } = await import('../pi/run-once.js');
  const abortController = new AbortController();
  ctx.setAbortController(abortController);

  try {
    const result = await runOnce({
      systemPrompt: fullSystemPrompt,
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
    ctx.setAbortController(null);
  }
}

/**
 * 处理文本摘要任务
 */
export async function handleSummarizeTask(task: AgentTask, taskLogger: any): Promise<string> {
  const payload = task.payload;

  taskLogger.debug('处理摘要任务,文本长度:', payload.text?.length);

  // TODO: 集成实际的摘要功能
  await delay(1500);

  const preview = payload.text?.substring(0, 50) || '';
  return `[摘要] ${preview}... (完整摘要待实现)`;
}

/**
 * 处理阅读辅助任务
 */
export async function handleReadingAssistTask(task: AgentTask, taskLogger: any): Promise<string> {
  const payload = task.payload;

  taskLogger.debug('处理阅读辅助任务:', payload.action);

  await delay(800);

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
 * 延迟辅助函数 (用于模拟异步操作)
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
