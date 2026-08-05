import { useEffect, useState } from 'react';
import { client } from '@/lib/client';

/**
 * 子代理消息的内部格式
 * 对应 getSubAgentHistory 返回的 JSONL 历史结构
 */
export interface SubAgentRawMessage {
  type: string;
  role?: string;
  content?: any;
  timestamp?: string;
  uuid?: string;
  model?: string;
}

interface UseSubAgentMessagesParams {
  /** 子代理的 agentId */
  agentId: string | null;
  /** 子代理的 sessionId（用于历史文件定位） */
  sessionId: string | null;
  /** 子代理状态 */
  status: 'running' | 'completed' | 'failed' | undefined;
  /** 工作区路径（可选，用于历史文件定位） */
  workspacePath?: string;
}

/**
 * 加载子代理的 JSONL 历史。
 * 运行中的子代理 tool_use 块由主会话流自带 effect 提取，详情页此处只读历史文件。
 */
export function useSubAgentMessages({
  agentId,
  sessionId,
  status,
  workspacePath,
}: UseSubAgentMessagesParams) {
  const [messages, setMessages] = useState<SubAgentRawMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !agentId) {
      // 切到无效目标时，主动清空历史，避免旧详情残留
      setMessages([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setMessages([]);
    setError(null);
    setLoading(true);
    client.getSubAgentHistory({
      sessionId,
      agentId,
      projectPath: workspacePath,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error as string);
        } else {
          setMessages((result.messages || []) as SubAgentRawMessage[]);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, agentId, status, workspacePath]);

  return { messages, loading, error };
}
