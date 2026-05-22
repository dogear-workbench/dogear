import type { Message } from './types';

interface TaskState {
  id: string;
  subject: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: number;
}

/**
 * 从消息序列累积所有 Task* 工具调用的最终状态。
 * - TaskCreate：用 output.taskId（SDK 返回值），fallback 到 input.subject
 * - TaskUpdate：以 input.taskId 匹配，覆盖 status/subject/activeForm
 * - TaskList / TaskGet：忽略（只读）
 */
export function aggregateTasks(messages: Message[]): TaskState[] {
  const state = new Map<string, TaskState>();

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.contentBlocks) continue;
    for (const block of msg.contentBlocks) {
      if (block.type !== 'tool_use') continue;
      const name = block.toolName;
      const input = block.toolInput as any;
      const output = block.toolOutput as any;

      if (name === 'TaskCreate') {
        const id = output?.taskId || output?.id || input?.id || input?.subject;
        if (!id) continue;
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
