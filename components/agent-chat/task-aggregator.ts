import type { Message } from './types';

interface TaskState {
  id: string;
  subject: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: number;
}

// SDK TaskCreate 返回 { task: { id, subject } }，但经 transformers 后会被 JSON.stringify 成字符串。
// 这里同时支持对象形态（live 流）和字符串形态（历史回放）。
function extractCreateTaskId(output: any): string | undefined {
  if (!output) return undefined;
  if (typeof output === 'object') {
    return output?.task?.id || output?.taskId || output?.id;
  }
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      return parsed?.task?.id || parsed?.taskId || parsed?.id;
    } catch {
      const m = output.match(/"id"\s*:\s*"([^"]+)"/);
      return m ? m[1] : undefined;
    }
  }
  return undefined;
}

/**
 * 从消息序列累积所有 Task* 工具调用的最终状态。
 * - TaskCreate：用 output.task.id（SDK 返回值），按 toolUseId 兜底保留草稿
 * - TaskUpdate：以 input.taskId 匹配
 * - TaskList / TaskGet：忽略（只读）
 */
export function aggregateTasks(messages: Message[]): TaskState[] {
  const state = new Map<string, TaskState>();
  // toolUseId → 真正 taskId 的映射，处理 TaskCreate 还在 running（无 output）时的临时状态
  const pendingByToolUseId = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.contentBlocks) continue;
    for (const block of msg.contentBlocks) {
      if (block.type !== 'tool_use') continue;
      const name = block.toolName;
      const input = block.toolInput as any;
      const output = block.toolOutput as any;

      if (name === 'TaskCreate') {
        const realId = extractCreateTaskId(output);
        // 还没有 output 时退而求其次用 toolUseId 当 key，等 output 到了再合并
        const id = realId || (block.toolUseId ? `__pending__:${block.toolUseId}` : input?.subject);
        if (!id) continue;
        if (realId && block.toolUseId) {
          pendingByToolUseId.set(block.toolUseId, realId);
          const pendingKey = `__pending__:${block.toolUseId}`;
          if (state.has(pendingKey) && !state.has(realId)) {
            const prev = state.get(pendingKey)!;
            state.set(realId, { ...prev, id: realId });
            state.delete(pendingKey);
          }
        }
        if (!state.has(id)) {
          state.set(id, {
            id,
            subject: input?.subject || id,
            activeForm: input?.activeForm,
            status: 'pending',
            createdAt: block.timestamp || Date.now(),
          });
        }
      } else if (name === 'TaskUpdate') {
        const id = input?.taskId;
        if (!id) continue;
        const existing = state.get(id);
        if (!existing) continue;
        state.set(id, {
          ...existing,
          status: input?.status || existing.status,
          subject: input?.subject || existing.subject,
          activeForm: input?.activeForm || existing.activeForm,
        });
      }
    }
  }

  return Array.from(state.values()).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 在消息数组末尾追加 task_summary 块到最后一条含 Task* 的 assistant 消息。
 * 同时清除其他位置上的旧 task_summary（保证唯一吸附点）。
 * 纯函数：不修改原数组。
 */
export function injectTaskSummary(messages: Message[]): Message[] {
  const tasks = aggregateTasks(messages);
  if (tasks.length === 0) {
    // 即使没有 task 也要清掉旧的 summary 块（防止 TaskCreate 全被回滚的极端情况）
    let touched = false;
    const cleaned = messages.map((m) => {
      if (!m.contentBlocks?.some((b) => b.type === 'task_summary')) return m;
      touched = true;
      return { ...m, contentBlocks: m.contentBlocks.filter((b) => b.type !== 'task_summary') };
    });
    return touched ? cleaned : messages;
  }

  let lastTaskMsgIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.contentBlocks) continue;
    if (msg.contentBlocks.some((b) =>
      b.type === 'tool_use' &&
      (b.toolName === 'TaskCreate' || b.toolName === 'TaskUpdate')
    )) {
      lastTaskMsgIdx = i;
      break;
    }
  }
  if (lastTaskMsgIdx < 0) return messages;

  const taskList = tasks.map(({ id, subject, activeForm, status }) => ({ id, subject, activeForm, status }));
  const result = messages.map((m, i) => {
    const hasOld = m.contentBlocks?.some((b) => b.type === 'task_summary') ?? false;
    if (i === lastTaskMsgIdx) {
      const baseBlocks = (m.contentBlocks || []).filter((b) => b.type !== 'task_summary');
      const lastBlock = baseBlocks[baseBlocks.length - 1];
      const summaryTimestamp = (lastBlock?.timestamp ?? Date.now()) + 1;
      return {
        ...m,
        contentBlocks: [
          ...baseBlocks,
          { type: 'task_summary' as const, tasks: taskList, timestamp: summaryTimestamp },
        ],
      };
    }
    if (!hasOld) return m;
    return { ...m, contentBlocks: m.contentBlocks!.filter((b) => b.type !== 'task_summary') };
  });

  return result;
}
