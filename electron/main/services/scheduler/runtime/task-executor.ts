import {
  TaskStatus,
  TaskType,
  type AgentTask,
  type CustomAgentTaskPayload,
} from '../../../agents/task-types.js';
import { loadSettings } from '../../settings-service.js';
import {
  getById as getWorkspaceById,
  getDefault as getDefaultWorkspace,
  getAll as getAllWorkspaces,
  type Workspace,
} from '../../workspace-json-service.js';
import { mainLogger } from '../../../agents/logger.js';
import type {
  BuiltinScheduledTask,
  CustomScheduledTask,
  RunTokens,
  ScheduledTask,
} from '../types.js';
import { BUILTIN_LABELS } from '../builtin-task-meta.js';

export interface TaskExecResult {
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  error?: string;
  tokens?: RunTokens;
}

const IDLE_POLL_MS = 500;

function waitForQueueIdle(isIdle: () => boolean): Promise<void> {
  if (isIdle()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (isIdle()) {
        clearInterval(timer);
        resolve();
      }
    }, IDLE_POLL_MS);
  });
}

async function resolveTaskWorkspaces(workspaceId: string | undefined): Promise<{ workspaces: Workspace[]; error?: string }> {
  if (workspaceId !== undefined) {
    const ws = await getWorkspaceById(workspaceId);
    if (!ws) return { workspaces: [], error: `工作区不存在: ${workspaceId}` };
    return { workspaces: [ws] };
  }
  return { workspaces: await getAllWorkspaces() };
}

export interface TriggerContext {
  conversationId: string;
}

export interface TaskExecuteHooks {
  onAgentTaskId?: (id: string) => void;
  triggerContext?: TriggerContext;
}

export async function executeTask(task: ScheduledTask, hooks?: TaskExecuteHooks): Promise<TaskExecResult> {
  if (task.kind === 'builtin') return runBuiltinTask(task, hooks);
  return runCustomTask(task, hooks);
}

async function runBuiltinTask(task: BuiltinScheduledTask, hooks?: TaskExecuteHooks): Promise<TaskExecResult> {
  switch (task.builtinId) {
    case 'group_digest': {
      const { triggerScanAll, triggerByConversation, whenGroupDigestIdle, getGroupDigestActivity } =
        await import('../../memory/group-digest-trigger.js');
      const convId = hooks?.triggerContext?.conversationId;
      if (convId !== undefined) {
        await triggerByConversation(convId);
        await whenGroupDigestIdle();
        return { status: 'completed', summary: '已对会话所在组触发精准提炼，队列已清空' };
      }
      await triggerScanAll(task.workspaceId);
      const dirtyCount = getGroupDigestActivity().lastScan?.dirtyCount ?? 0;
      await whenGroupDigestIdle();
      return { status: 'completed', summary: `扫描发现 ${dirtyCount} 个待提炼组，队列已清空` };
    }
    case 'review': {
      const { triggerReviewScan, getReviewActivity } = await import('../../memory/review-trigger.js');
      await triggerReviewScan(task.workspaceId);
      const staleCount = getReviewActivity().lastScan?.dirtyCount ?? 0;
      await waitForQueueIdle(() => {
        const a = getReviewActivity();
        return a.current === null && a.queueDepth === 0;
      });
      return { status: 'completed', summary: `发现 ${staleCount} 个过时工作区，队列已清空` };
    }
    case 'categorize': {
      const { triggerCategorizeSweep, getCategorizeActivity } =
        await import('../../memory/category-trigger.js');
      const { workspaces, error } = await resolveTaskWorkspaces(task.workspaceId);
      if (error) return { status: 'failed', error };
      const results: Array<{ disabled: boolean; pending: number; noTags: number }> = [];
      for (const ws of workspaces) {
        results.push(await triggerCategorizeSweep(ws.id));
      }
      await waitForQueueIdle(() => {
        const a = getCategorizeActivity();
        return a.current === null && a.queueDepth === 0;
      });
      if (results.length > 0 && results.every((r) => r.disabled)) {
        return { status: 'completed', summary: '智能分类已禁用，跳过' };
      }
      const pending = results.reduce((sum, r) => sum + r.pending, 0);
      const noTags = results.reduce((sum, r) => sum + r.noTags, 0);
      if (pending === 0 && noTags === 0) {
        return { status: 'completed', summary: '没有未分类的话题' };
      }
      const parts: string[] = [];
      if (pending > 0) parts.push(`已为 ${pending} 个话题补分类`);
      if (noTags > 0) parts.push(`${noTags} 个话题缺标签需重新提炼`);
      return { status: 'completed', summary: parts.join('，') };
    }
    case 'categorize_organize': {
      const { triggerCategorizeOrganize, getCategorizeActivity } =
        await import('../../memory/category-trigger.js');
      const { workspaces, error } = await resolveTaskWorkspaces(task.workspaceId);
      if (error) return { status: 'failed', error };
      for (const ws of workspaces) {
        await triggerCategorizeOrganize(ws.id);
      }
      await waitForQueueIdle(() => {
        const a = getCategorizeActivity();
        return a.current === null && a.queueDepth === 0;
      });
      return { status: 'completed', summary: `已对 ${workspaces.length} 个工作区触发${BUILTIN_LABELS.categorize_organize}` };
    }
  }
}

function extractTokens(result: any): RunTokens | undefined {
  const usage = result?.tokens ?? result?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  if (typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') return undefined;
  const tokens: RunTokens = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  if (typeof usage.cacheReadInputTokens === 'number') tokens.cacheReadInputTokens = usage.cacheReadInputTokens;
  if (typeof usage.cacheCreationInputTokens === 'number') tokens.cacheCreationInputTokens = usage.cacheCreationInputTokens;
  return tokens;
}

async function runCustomTask(task: CustomScheduledTask, hooks?: TaskExecuteHooks): Promise<TaskExecResult> {
  const workspace = task.workspaceId !== undefined
    ? await getWorkspaceById(task.workspaceId)
    : await getDefaultWorkspace();
  if (!workspace) {
    return {
      status: 'failed',
      error: task.workspaceId !== undefined
        ? `工作区不存在: ${task.workspaceId}`
        : '未设置默认工作区，且任务未指定工作区',
    };
  }
  const settings = await loadSettings();
  const modelSelection = task.modelSelection ?? settings.ai.defaultModelSelection ?? undefined;
  if (!modelSelection) {
    return { status: 'failed', error: '未配置模型：任务未设置 modelSelection 且全局默认模型为空' };
  }
  const payload: CustomAgentTaskPayload = {
    taskName: task.name,
    prompt: task.prompt,
    modelSelection,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    toolPacksOverride: task.toolPacksOverride,
  };
  const agentTask: AgentTask = {
    id: `custom-agent-${task.id}-${Date.now()}`,
    type: TaskType.CUSTOM_AGENT,
    status: TaskStatus.PENDING,
    payload,
    createdAt: Date.now(),
  };
  hooks?.onAgentTaskId?.(agentTask.id);
  const { getAgentManager } = await import('../../../agents/agent-manager.js');
  return await new Promise<TaskExecResult>((resolve) => {
    getAgentManager().submitTask(agentTask, (_taskId, status, result, error) => {
      if (
        status !== TaskStatus.COMPLETED &&
        status !== TaskStatus.FAILED &&
        status !== TaskStatus.CANCELLED
      ) return;
      mainLogger.info(`[scheduler] 自定义任务结束: ${task.name} status=${status}`);
      if (status === TaskStatus.CANCELLED) {
        resolve({ status: 'cancelled', error: error ?? '已取消' });
      } else if (status === TaskStatus.FAILED) {
        resolve({ status: 'failed', error: error ?? result?.error ?? '任务失败' });
      } else if (result?.ok === false) {
        resolve({ status: 'failed', error: result?.error ?? '任务失败', tokens: extractTokens(result) });
      } else {
        resolve({ status: 'completed', summary: result?.summary, tokens: extractTokens(result) });
      }
    }).catch((err) => {
      resolve({
        status: 'failed',
        error: `提交自定义任务失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  });
}
