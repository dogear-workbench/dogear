import type { Message } from './types';

interface TaskState {
  id: string;
  subject: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: number;
}

// SDK TaskCreate 类型签名是 { task: { id, subject } }，但 tool_result 实际下发的是人类可读字符串：
//   "Task #<id> created successfully: <subject>"
// 经主进程/transformers 拍扁后到这里永远是 string。对象/JSON 分支保留作未来兼容。
function extractCreateTaskId(output: any): string | undefined {
  if (!output) return undefined;
  if (typeof output === 'object') {
    return output?.task?.id || output?.taskId || output?.id;
  }
  if (typeof output === 'string') {
    const m = output.match(/Task\s+#([A-Za-z0-9_-]+)\s+created/i);
    if (m) return m[1];
    try {
      const parsed = JSON.parse(output);
      return parsed?.task?.id || parsed?.taskId || parsed?.id;
    } catch {
      const jm = output.match(/"id"\s*:\s*"([^"]+)"/);
      return jm ? jm[1] : undefined;
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
