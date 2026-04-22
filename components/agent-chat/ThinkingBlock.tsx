import { Brain } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import type { ContentBlock } from './types';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * 思考块组件
 * - compact（简化）：一行 20px 胶囊，不可展开
 * - detailed（详细）：可折叠卡片，默认折叠
 */
export function ThinkingBlock({ block }: { block: ContentBlock }) {
  const hasContent = !!block.content;
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');

  // 简化模式：只渲染胶囊
  if (displayMode === 'compact') {
    const charCount = block.content?.length ?? 0;
    return (
      <div
        className="inline-flex items-center gap-1 px-2 h-5 rounded-full bg-muted/70 text-muted-foreground text-xs"
        title={block.content || '思考中...'}
      >
        {hasContent
          ? <Brain size={10} />
          : <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse" />
        }
        <span>{hasContent ? `思考 · ${charCount}字` : '思考中...'}</span>
      </div>
    );
  }

  // 详细模式：保持原来的可折叠卡片
  return (
    <CollapsibleBlock
      icon={
        hasContent
          ? <Brain size={14} className="text-muted-foreground/60" />
          : <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
      }
      title={hasContent ? '思考' : '思考中...'}
      previewLines={3}
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
