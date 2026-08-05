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
  const model: string | undefined = block.toolInput?.model;

  // 查看详情：按需注册到 store 并打开面板
  const handleViewDetail = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!block.subAgentId) return;
    const store = useUIStore.getState();
    const conv = useConversationStore.getState().selectedConversation;
    // 按需注册（点击时才注册，不在渲染时注册）
    if (conv?.session_id && conv.id) {
      store.registerSubAgent(conv.id, {
        agentId: block.subAgentId,
        sessionId: conv.session_id,
        description,
        subagentType: agentType,
        model,
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

  // 指标文本（model 放最前面突出）
  const metricsText = [
    model,
    block.subAgentToolUseCount !== undefined ? `${block.subAgentToolUseCount} 工具` : '',
    durationText,
  ].filter(Boolean).join(' · ');

  const detailAction = block.subAgentId ? (
    <span
      role="button"
      tabIndex={0}
      onClick={handleViewDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleViewDetail(e);
      }}
      className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 hover:bg-sky-50 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
      title="查看子代理详情"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      详情
    </span>
  ) : null;

  return (
    <CollapsibleBlock
      icon={<Bot className="w-4 h-4 text-blue-600" />}
      title={titleParts.join(' ')}
      titleClassName={isFailed ? 'text-red-600' : isRunning ? 'text-blue-600' : undefined}
      statusIcon={statusIcon}
      headerActions={detailAction}
      previewLines={0}
    >
      <div className="space-y-1.5 text-xs rounded-md bg-muted/20 px-2.5 py-2">
        {metricsText && (
          <div className="text-muted-foreground text-[10px]">{metricsText}</div>
        )}

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

        {block.subAgentId && (
          <div className="pt-1 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground/60">ID: {block.subAgentId.substring(0, 12)}</span>
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}
