import { Brain } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import type { ContentBlock } from './types';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * 思考块组件
 * - compact（简化）：CollapsibleBlock，previewLines=0，完全收起
 * - detailed（详细）：CollapsibleBlock，previewLines=3，显示预览
 */
export function ThinkingBlock({ block }: { block: ContentBlock }) {
  const hasContent = !!block.content;
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const charCount = block.content?.length ?? 0;

  return (
    <CollapsibleBlock
      icon={
        hasContent
          ? <Brain size={14} className="text-muted-foreground/60" />
          : <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
      }
      title={hasContent ? (displayMode === 'compact' ? `思考 · ${charCount}字` : '思考') : '思考中...'}
      previewLines={displayMode === 'compact' ? 0 : 3}
      defaultOpen={false}
    >
      {hasContent && (
        <div className="border-l-2 border-muted-foreground/20 pl-2.5 text-xs text-muted-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
          {block.content}
        </div>
      )}
    </CollapsibleBlock>
  );
}
