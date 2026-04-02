import { useState, useEffect } from 'react';
import { Bot, ChevronRight, Clock, Cpu, Wrench, ExternalLink } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import { useUIStore } from '@/stores/ui-store';
import type { ContentBlock } from './types';

/**
 * 查看详情按钮：在右侧子代理 tab 中显示子代理会话历史
 */
function ViewDetailButton({ agentId, description }: { agentId: string; description: string }) {
  const sdkSessionId = useConversationStore((s) => s.selectedConversation?.sdk_session_id);

  if (!sdkSessionId) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[10px] text-violet-600 hover:text-violet-700 hover:bg-violet-100"
      onClick={(e) => {
        e.stopPropagation();
        const store = useUIStore.getState();
        // 确保已注册（可能从历史加载，不一定走了运行时注册流程）
        store.registerSubAgent({ agentId, sdkSessionId, description, status: 'completed' });
        store.selectSubAgent(agentId);
        store.setRightPanelTab('subagents');
        store.openRightPanel();
      }}
    >
      <ExternalLink className="w-3 h-3 mr-1" />
      查看详情
    </Button>
  );
}

/**
 * 子代理调用卡片
 * 替代 Agent tool_use 的默认 ToolBlock 渲染，展示子代理的调用信息和执行结果
 */
export function SubAgentBlock({ block }: { block: ContentBlock }) {
  const [isOpen, setIsOpen] = useState(false);
  const registerSubAgent = useUIStore((s) => s.registerSubAgent);
  const updateSubAgentStatus = useUIStore((s) => s.updateSubAgentStatus);
  const sdkSessionId = useConversationStore((s) => s.selectedConversation?.sdk_session_id);

  // 状态判断
  const hasOutput = block.toolOutput !== undefined || !!block.subAgentResultText;
  const isCompleted = block.subAgentStatus === 'completed' || hasOutput;
  const isFailed = block.subAgentStatus === 'failed' || block.isError;
  const isRunning = !isCompleted && !isFailed;

  // 描述信息
  const description = block.subAgentDescription || block.toolInput?.description || '子代理任务';
  const agentType = block.subAgentType || block.toolInput?.subagent_type || '';

  // 运行时注册子代理到 store（一旦有 agentId 就注册，或者一创建就注册为 running）
  useEffect(() => {
    if (!sdkSessionId) return;
    if (block.subAgentId) {
      const status = isFailed ? 'failed' : isCompleted ? 'completed' : 'running';
      registerSubAgent({ agentId: block.subAgentId, sdkSessionId, description, status });
    }
  }, [block.subAgentId, sdkSessionId]);

  // 状态变化时更新 store
  useEffect(() => {
    if (!block.subAgentId) return;
    if (isCompleted) updateSubAgentStatus(block.subAgentId, 'completed');
    else if (isFailed) updateSubAgentStatus(block.subAgentId, 'failed');
  }, [isCompleted, isFailed, block.subAgentId]);

  // 状态样式
  const statusConfig = isFailed
    ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' }
    : isCompleted
      ? { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dot: 'bg-violet-500' }
      : { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dot: 'bg-violet-500 animate-pulse' };

  // 格式化时长
  const formatDuration = (ms?: number) => {
    if (!ms) return null;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn('rounded-lg border', statusConfig.bg, statusConfig.border)}>
        {/* 头部 */}
        <CollapsibleTrigger className="w-full flex items-center gap-2 p-3 text-left hover:bg-opacity-80 transition-colors cursor-pointer">
          <ChevronRight className={cn(
            'w-4 h-4 transition-transform duration-200',
            statusConfig.text,
            isOpen && 'rotate-90',
          )} />

          <Bot className={cn('w-4 h-4', statusConfig.text)} />

          <span className={cn('font-medium text-sm', statusConfig.text)}>
            子代理
          </span>

          {agentType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 shrink-0">
              {agentType}
            </span>
          )}

          <span className="text-xs text-gray-500 truncate flex-1 ml-1">
            {description}
          </span>

          {/* 执行指标 */}
          <div className="flex items-center gap-2 shrink-0">
            {block.subAgentToolUseCount !== undefined && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400" title="工具调用次数">
                <Wrench className="w-3 h-3" />
                {block.subAgentToolUseCount}
              </span>
            )}
            {block.subAgentTokens !== undefined && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400" title="Token 消耗">
                <Cpu className="w-3 h-3" />
                {block.subAgentTokens.toLocaleString()}
              </span>
            )}
            {block.subAgentDurationMs !== undefined && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400" title="执行时长">
                <Clock className="w-3 h-3" />
                {formatDuration(block.subAgentDurationMs)}
              </span>
            )}
          </div>

          {/* 状态指示 */}
          <div className="ml-1 shrink-0">
            {isRunning ? (
              <div className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
            ) : (
              <div className={cn('w-2 h-2 rounded-full', statusConfig.dot)} />
            )}
          </div>
        </CollapsibleTrigger>

        {/* 展开内容 */}
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2">
            <div className={cn('border-t', statusConfig.border)} />

            {/* 子代理 prompt（可折叠） */}
            {block.toolInput?.prompt && (
              <details className="group">
                <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                  任务 Prompt
                </summary>
                <pre className="mt-1 text-xs bg-white/50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {block.toolInput.prompt}
                </pre>
              </details>
            )}

            {/* 子代理返回结果 */}
            {block.subAgentResultText && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">执行结果</div>
                <div className="text-sm bg-white/50 rounded p-2 max-h-60 overflow-y-auto">
                  <MarkdownRenderer content={block.subAgentResultText} className="text-sm" />
                </div>
              </div>
            )}

            {/* 如果没有 subAgentResultText，fallback 到 toolOutput */}
            {!block.subAgentResultText && block.toolOutput && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  工具输出 {block.isError && <span className="text-red-500">（错误）</span>}
                </div>
                <pre className={cn(
                  'text-xs rounded p-2 overflow-x-auto max-h-60 overflow-y-auto',
                  block.isError ? 'bg-red-100/50' : 'bg-white/50',
                )}>
                  {typeof block.toolOutput === 'string' ? block.toolOutput : JSON.stringify(block.toolOutput, null, 2)}
                </pre>
              </div>
            )}

            {/* 子代理 ID + 查看详情 */}
            {block.subAgentId && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">
                  Agent ID: {block.subAgentId}
                </span>
                <ViewDetailButton
                  agentId={block.subAgentId}
                  description={description}
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
