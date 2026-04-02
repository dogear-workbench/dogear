import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';

/**
 * 子代理消息的内部格式
 * 对应 getSubAgentHistory 返回值以及 subAgentMessage 实时事件中的消息结构
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
  /** 父会话 sessionId（QueryBasedSession 的 sessionId） */
  parentSessionId: string | null;
  /** 子代理的 agentId */
  agentId: string | null;
  /** 子代理的 sdkSessionId（用于历史文件定位） */
  sdkSessionId: string | null;
  /** 子代理状态 */
  status: 'running' | 'completed' | 'failed' | undefined;
  /** 工作区路径（可选，用于历史文件定位） */
  workspacePath?: string;
}

/**
 * 监听指定子代理的实时消息流（运行中）或加载历史（已完成）
 */
export function useSubAgentMessages({
  parentSessionId,
  agentId,
  sdkSessionId,
  status,
  workspacePath,
}: UseSubAgentMessagesParams) {
  const [streamMessages, setStreamMessages] = useState<SubAgentRawMessage[]>([]);
  const [historyMessages, setHistoryMessages] = useState<SubAgentRawMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 运行中：监听实时 subAgentMessage 事件
  useEffect(() => {
    if (!parentSessionId || !agentId || status !== 'running') return;

    const unsub = rendererEvents.subAgentMessage.listen((data) => {
      if (data.parentSessionId !== parentSessionId || data.agentId !== agentId) return;
      const msg = data.message as any;
      // 将 ExtendedSessionMessage 转为展示用的 SubAgentRawMessage
      setStreamMessages(prev => [...prev, {
        type: msg.type === 'assistant' || msg.role === 'assistant' ? 'assistant' : msg.type,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp ? String(msg.timestamp) : undefined,
        uuid: msg.uuid,
        model: msg.model,
      }]);
    });

    return () => unsub();
  }, [parentSessionId, agentId, status]);

  // 已完成/失败：加载 JSONL 历史文件
  useEffect(() => {
    if (!sdkSessionId || !agentId || status === 'running') return;

    setLoading(true);
    setError(null);
    client.getSubAgentHistory({
      sdkSessionId,
      agentId,
      projectPath: workspacePath,
    })
      .then((result) => {
        if (result.error) {
          setError(result.error as string);
        } else {
          setHistoryMessages((result.messages || []) as SubAgentRawMessage[]);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sdkSessionId, agentId, status, workspacePath]);

  return {
    messages: status === 'running' ? streamMessages : historyMessages,
    loading,
    error,
  };
}
