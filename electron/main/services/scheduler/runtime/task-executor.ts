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
} from '../../workspace-json-service.js';
import { mainLogger } from '../../../agents/logger.js';
import type {
  CustomScheduledTask,
  RunTokens,
  ScheduledTask,
} from '../types.js';

export interface TaskExecResult {
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  error?: string;
  tokens?: RunTokens;
}

export interface TriggerContext {
  conversationId: string;
}

export interface TaskExecuteHooks {
  onAgentTaskId?: (id: string) => void;
  triggerContext?: TriggerContext;
}

export async function executeTask(task: ScheduledTask, hooks?: TaskExecuteHooks): Promise<TaskExecResult> {
  return runCustomTask(task, hooks);
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
    skillsOverride: task.skillsOverride,
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
