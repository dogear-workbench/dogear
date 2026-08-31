
import { useEffect, useState } from 'react';
import { useConversationStore } from '@/stores/conversation-store';
import { AgentChat } from '@/components/AgentChat';

// 局部类型声明：旧版调试 API（已从全局 preload 类型中移除）
declare global {
  interface Window {
    electronDebug?: {
      getAgentStatus: () => Promise<any>;
    };
  }
}

/**
 * 调试窗口页面
 * 开发阶段专用,用于测试和调试 Agent 功能
 */

interface TaskStatus {
  workers: number;
  maxWorkers: number;
  queuedTasks: number;
  activeTasks: number;
}

export default function DebugPage() {
  const [agentStatus, setAgentStatus] = useState<TaskStatus | null>(null);
  const conversationId = useConversationStore((s) => s.selectedConversation?.id ?? undefined);

  // 加载 Agent 状态
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const status = await window.electronDebug?.getAgentStatus();
        if (status) {
          setAgentStatus(status);
        }
      } catch (error) {
        console.error('获取 Agent 状态失败:', error);
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, 5000); // 每 5 秒更新

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* 头部:标题和状态 */}
      <div className="flex-none p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Agent 调试窗口</h1>
          <div className="text-xs text-gray-400">开发环境专用</div>
        </div>

        {agentStatus && (
          <div className="mt-3 text-sm text-gray-400 space-y-1">
            <div className="flex items-center space-x-4">
              <span>Workers: <span className="text-white font-mono">{agentStatus.workers}/{agentStatus.maxWorkers}</span></span>
              <span>队列任务: <span className="text-white font-mono">{agentStatus.queuedTasks}</span></span>
              <span>活动任务: <span className="text-white font-mono">{agentStatus.activeTasks}</span></span>
            </div>
          </div>
        )}
      </div>

      {/* 主要内容:使用 AgentChat 组件 */}
      <div className="flex-1 p-4 overflow-hidden">
        <AgentChat
          placeholder="输入消息测试 Agent... (Enter 发送, Shift+Enter 换行)"
          showStatusHint={false}
          conversationIdOverride={conversationId}
          visible
        />
      </div>
    </div>
  );
}