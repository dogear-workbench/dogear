import { ToolBlock } from '@/components/ToolBlock';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ThinkingBlock } from './ThinkingBlock';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { PermissionRequestCard } from './PermissionRequestCard';
import type { ContentBlock } from './types';

export function ContentBlockItem({ block, sessionId, onPermissionResolved, onAskUserResolved }: {
  block: ContentBlock;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
}) {
  switch (block.type) {
    case 'tool_use':
      // 使用新的 ToolBlock 组件，支持折叠和状态显示
      // 根据是否有输出结果判断状态
      const toolStatus = block.toolOutput !== undefined
        ? (block.isError ? 'error' : 'success')
        : 'running';
      return (
        <ToolBlock
          toolName={block.toolName || '未知工具'}
          toolInput={block.toolInput}
          toolOutput={block.toolOutput}
          toolUseId={block.toolUseId}
          status={toolStatus}
          isError={block.isError}
          citations={block.citations}
        />
      );

    case 'tool_result':
      // tool_result 不独立渲染，结果已整合到对应 tool_use 的 ToolBlock 中
      return null;

    case 'status':
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            {block.status}
          </div>
        </div>
      );

    case 'thinking':
      return <ThinkingBlock block={block} />;

    case 'permission_request':
      return (
        <PermissionRequestCard
          block={block}
          sessionId={sessionId || null}
          onResolved={onPermissionResolved || (() => {})}
        />
      );

    case 'ask_user_question':
      return (
        <AskUserQuestionCard
          block={block}
          sessionId={sessionId || null}
          onResolved={onAskUserResolved || (() => {})}
        />
      );

    // ==================== Hook 事件渲染 ====================

    case 'session_start': {
      const sourceLabel: Record<string, string> = {
        startup: '会话已启动',
        resume: '会话已恢复',
        clear: '会话已重新开始',
        compact: '会话已压缩重启',
      };
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-50 border border-green-200 text-xs text-green-700">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
          {sourceLabel[block.sessionStartSource || ''] || '会话已启动'}
        </div>
      );
    }

    case 'session_end':
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-100 border border-gray-200 text-xs text-gray-500">
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
          会话已结束{block.sessionEndReason ? `（${block.sessionEndReason}）` : ''}
        </div>
      );

    case 'stop':
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full"></div>
          执行已停止
        </div>
      );

    case 'tool_failure':
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-700 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            工具执行失败
            {block.failedToolName && (
              <span className="text-xs px-1.5 py-0.5 bg-red-100 rounded font-mono">{block.failedToolName}</span>
            )}
          </div>
          {block.failedToolError && (
            <div className="text-xs text-red-600 bg-red-100/50 rounded p-2 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {block.failedToolError}
            </div>
          )}
        </div>
      );

    case 'notification':
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {block.notificationTitle || '通知'}
          </div>
          {block.notificationMessage && (
            <div className="text-xs text-blue-600">{block.notificationMessage}</div>
          )}
        </div>
      );

    case 'task_notification': {
      // 根据任务状态设置颜色
      const statusColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
        completed: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
        failed: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
        cancelled: { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-600', dot: 'bg-gray-400' },
      };
      const colors = statusColors[block.taskStatus || ''] || { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500' };
      const statusLabels: Record<string, string> = { completed: '已完成', failed: '失败', cancelled: '已取消', in_progress: '进行中' };
      return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md ${colors.bg} border ${colors.border} text-xs ${colors.text}`}>
          <div className={`w-1.5 h-1.5 ${colors.dot} rounded-full`}></div>
          <span>子任务 {block.taskId ? `[${block.taskId.substring(0, 8)}]` : ''} {statusLabels[block.taskStatus || ''] || block.taskStatus}</span>
          {block.taskSummary && <span className="text-gray-500 ml-1">- {block.taskSummary}</span>}
        </div>
      );
    }

    case 'error':
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            错误: {block.error}
          </div>
        </div>
      );

    case 'result':
      // result 类型不显示任何内容，只是标志消息结束
      return null;

    case 'user':
      // 用户消息（来自 SDK 重放）
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {block.isReplay && <span className="text-xs text-blue-500">(历史)</span>}
            用户消息
          </div>
          {block.content && (
            <div className="text-sm text-blue-700 whitespace-pre-wrap">
              {block.content}
            </div>
          )}
        </div>
      );

    case 'text':
    default:
      return block.content ? (
        <MarkdownRenderer content={block.content} className="text-sm" />
      ) : null;
  }
}
