import { Brain } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import type { ContentBlock } from './types';

/**
 * 思考块组件
 * 默认 3 行预览 + 渐隐，无边框无背景
 */
export function ThinkingBlock({ block }: { block: ContentBlock }) {
  const hasContent = !!block.content;

  return (
    <CollapsibleBlock
      icon={
        hasContent
          ? <Brain size={14} className="text-muted-foreground/60" />
          : <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
      }
      title={hasContent ? '思考' : '思考中...'}
      previewLines={3}
    >
      {hasContent && (
        <div className="border-l-2 border-muted-foreground/20 pl-2.5 text-xs text-muted-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
          {block.content}
        </div>
      )}
    </CollapsibleBlock>
  );
}
