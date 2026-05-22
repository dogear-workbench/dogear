import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Message } from '../types';
import { injectTaskSummary } from '../task-aggregator';

/**
 * 监听 messages 变化，维护 task_summary 块吸附到最后一次 Task* 调用所在的 assistant 消息。
 * 用签名比较防抖：仅当 Task* 调用集合或当前 summary 内容真正变化时才 setMessages，
 * 避免无限循环（setMessages 引用变化也不会触发：injectTaskSummary 是纯函数返回新数组）。
 */
export function useTaskListAggregator(
  messages: Message[],
  setMessages: Dispatch<SetStateAction<Message[]>>
) {
  const lastSignatureRef = useRef<string>('');

  useEffect(() => {
    const taskBlocks: string[] = [];
    const summaryBlocks: string[] = [];
    for (const m of messages) {
      if (!m.contentBlocks) continue;
      for (const b of m.contentBlocks) {
        if (b.type === 'tool_use' && (b.toolName === 'TaskCreate' || b.toolName === 'TaskUpdate')) {
          taskBlocks.push(`${b.toolName}:${JSON.stringify(b.toolInput || {})}:${JSON.stringify(b.toolOutput || null)}`);
        } else if (b.type === 'task_summary') {
          summaryBlocks.push(JSON.stringify(b.tasks || []));
        }
      }
    }
    const signature = `T${taskBlocks.join('|')}#S${summaryBlocks.join('|')}`;
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    if (taskBlocks.length === 0 && summaryBlocks.length === 0) return;

    const next = injectTaskSummary(messages);
    if (next === messages) return;
    setMessages(next);
  }, [messages, setMessages]);
}
