// components/agent-chat/ToolGroupBlock.tsx
import { Boxes, Check, X, Loader2 } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import { ContentBlockItem } from './ContentBlockItem';
import { useToolRegistryStore } from '@/stores/tool-registry-store';
import type { ContentBlock } from './types';
import { cn } from '@/lib/utils';

interface ToolGroupBlockProps {
  blocks: ContentBlock[];
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt?: () => void | Promise<void>;
  searchQuery?: string;
  activeMatchId?: string | null;
  messageId?: string;
  blockIndex?: number;
  readOnly?: boolean;
}

/**
 * 连续工具调用分组容器
 * - 标题：中文大类去重 · N 个工具
 * - 默认完全收起（previewLines=0）
 * - 展开后内部每个工具/思考仍是独立收起的卡片
 */
export function ToolGroupBlock({
  blocks,
  sessionId,
  onPermissionResolved,
  onAskUserResolved,
  onInterrupt,
  searchQuery,
  activeMatchId,
  messageId,
  blockIndex,
  readOnly,
}: ToolGroupBlockProps) {
  const getCategoryLabel = useToolRegistryStore(s => s.getCategoryLabel);

  // 仅统计 tool_use
  const toolBlocks = blocks.filter(b => b.type === 'tool_use');
  const toolCount = toolBlocks.length;

  // 去重的大类列表（保留首次出现顺序）
  const categorySet = new Set<string>();
  const categories: string[] = [];
  for (const b of toolBlocks) {
    const label = getCategoryLabel(b.toolName || '');
    if (!categorySet.has(label)) {
      categorySet.add(label);
      categories.push(label);
    }
  }
  const title = `${categories.join('、')} · ${toolCount} 个工具`;

  // 组内聚合状态
  const hasRunning = toolBlocks.some(b => b.toolOutput === undefined);
  const hasError = toolBlocks.some(b => b.isError);
  const status: 'running' | 'error' | 'success' =
    hasRunning ? 'running' : hasError ? 'error' : 'success';

  const statusIcon =
    status === 'running' ? <Loader2 className="w-4 h-4 text-sky-500 animate-spin" /> :
    status === 'error'   ? <X className="w-4 h-4 text-red-500" /> :
                           <Check className="w-4 h-4 text-muted-foreground" />;

  return (
    <CollapsibleBlock
      icon={<Boxes size={14} className="text-muted-foreground/70" />}
      title={title}
      titleClassName={cn(
        status === 'running' && 'text-sky-600 dark:text-sky-400',
        status === 'error' && 'text-red-600 dark:text-red-400',
      )}
      statusIcon={statusIcon}
      previewLines={0}
      defaultOpen={false}
    >
      <div className="space-y-2">
        {blocks.map((child, idx) => (
          <ContentBlockItem
            key={idx}
            block={child}
            sessionId={sessionId}
            onPermissionResolved={onPermissionResolved}
            onAskUserResolved={onAskUserResolved}
            onInterrupt={onInterrupt}
            searchQuery={searchQuery}
            activeMatchId={activeMatchId}
            messageId={messageId}
            blockIndex={blockIndex !== undefined ? blockIndex * 100 + idx : idx}
            readOnly={readOnly}
          />
        ))}
      </div>
    </CollapsibleBlock>
  );
}
