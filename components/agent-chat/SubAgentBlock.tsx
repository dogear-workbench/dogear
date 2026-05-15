import { CollapsibleBlock } from './CollapsibleBlock';
import { Bot, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import { useUIStore } from '@/stores/ui-store';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { ContentBlock } from './types';

/**
 * 子代理调用卡片
 * 使用 CollapsibleBlock 渐隐预览风格（和 ToolBlock 一致）
 * 不主动注册到 ui-store，子代理列表由 IPC 事件驱动
 */
export function SubAgentBlock({ block }: { block: ContentBlock }) {
  const hasOutput = block.toolOutput !== undefined || !!block.subAgentResultText;
  const isCompleted = block.subAgentStatus === 'completed' || hasOutput;
  const isFailed = block.subAgentStatus === 'failed' || block.isError;
  const isRunning = !isCompleted && !isFailed;
  const description = block.subAgentDescription || block.toolInput?.description || '子代理任务';
  const agentType = block.subAgentType || block.toolInput?.subagent_type || '';

  // 查看详情：按需注册到 store 并打开面板
  const handleViewDetail = () => {
    if (!block.subAgentId) return;
    const store = useUIStore.getState();
    const conv = useConversationStore.getState().selectedConversation;
    // 按需注册（点击时才注册，不在渲染时注册）
    if (conv?.sdk_session_id && conv.id) {
      store.registerSubAgent(conv.id, {
        agentId: block.subAgentId,
        sdkSessionId: conv.sdk_session_id,
        description,
        subagentType: agentType,
        status: isFailed ? 'failed' : isCompleted ? 'completed' : 'running',
        durationMs: block.subAgentDurationMs,
        tokens: block.subAgentTokens,
        toolUseCount: block.subAgentToolUseCount,
      });
    }
    if (conv?.id) {
      store.selectSubAgent(conv.id, block.subAgentId);
    }
    store.setRightPanelTab('subagents');
    store.openRightPanel();
  };

  // 格式化时长
  const durationText = block.subAgentDurationMs
    ? block.subAgentDurationMs < 1000
      ? `${block.subAgentDurationMs}ms`
      : `${(block.subAgentDurationMs / 1000).toFixed(1)}s`
    : '';

  // 标题文本
  const titleParts = [description];
  if (agentType) titleParts.push(`(${agentType})`);

  // 状态图标
  const statusIcon = isRunning ? (
    <div className="w-4 h-4 rounded-full border-2 border-blue-300 border-t-blue-600 animate-spin" />
  ) : isFailed ? (
    <span className="text-red-500 text-xs">✗</span>
  ) : (
    <span className="text-muted-foreground text-xs">✓</span>
  );

  // 指标文本
  const metricsText = [
    block.subAgentToolUseCount !== undefined ? `${block.subAgentToolUseCount} 工具` : '',
    durationText,
  ].filter(Boolean).join(' · ');

  return (
    <CollapsibleBlock
      icon={
        <span className="flex items-center justify-center w-5 h-5 rounded border border-blue-200 bg-blue-50">
          <Bot className="w-3 h-3 text-blue-600" />
        </span>
      }
      title={titleParts.join(' ')}
      titleClassName={isFailed ? 'text-red-600' : isRunning ? 'text-blue-600' : undefined}
      statusIcon={statusIcon}
      previewLines={2}
    >
      <div className="space-y-1.5 text-xs rounded-md bg-muted/20 px-2.5 py-2">
        {/* 指标 */}
        {metricsText && (
          <div className="text-muted-foreground text-[10px]">{metricsText}</div>
        )}

        {/* 执行结果（不截断，CollapsibleBlock 自带渐隐折叠） */}
        {block.subAgentResultText && (
          <div className="text-muted-foreground whitespace-pre-wrap break-all">
            <MarkdownRenderer content={block.subAgentResultText} className="text-xs" />
          </div>
        )}
        {!block.subAgentResultText && block.toolOutput && (
          <div className={cn(
            "whitespace-pre-wrap break-all text-muted-foreground",
            block.isError && "text-red-600",
          )}>
            {typeof block.toolOutput === 'string' ? block.toolOutput : JSON.stringify(block.toolOutput, null, 2)}
          </div>
        )}

        {/* 查看详情 */}
        {block.subAgentId && (
          <div className="flex items-center justify-between pt-1 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground/60">ID: {block.subAgentId.substring(0, 12)}</span>
            <button
              onClick={handleViewDetail}
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
              查看详情
            </button>
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}
