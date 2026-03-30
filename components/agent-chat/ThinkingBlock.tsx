import { useState } from 'react';
import { ChevronRight, Brain } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ContentBlock } from './types';

/**
 * 思考块组件
 * 可折叠面板，默认收起，点击展开查看思考内容
 */
export function ThinkingBlock({ block }: { block: ContentBlock }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasContent = !!block.content;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-border bg-secondary/50">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors cursor-pointer">
          <ChevronRight
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
          {!hasContent ? (
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
          ) : (
            <Brain size={14} className="text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">
            {hasContent ? '思考摘要' : '思考中...'}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {hasContent && (
            <div className="px-3 pb-3">
              <div className="border-t border-border pt-2">
                <div className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted/50 rounded p-3 max-h-80 overflow-y-auto">
                  {block.content}
                </div>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
