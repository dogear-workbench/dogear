// components/agent-chat/CollapsibleBlock.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleBlockProps {
  /** 标题行左侧图标 */
  icon?: ReactNode;
  /** 标题文本 */
  title: string;
  /** 标题右侧的状态指示 */
  statusIcon?: ReactNode;
  /** 标题右侧的额外操作（在 statusIcon 之前），用 span+onClick 避免按钮嵌套 */
  headerActions?: ReactNode;
  /** 默认预览行数（超出部分渐隐） */
  previewLines?: number;
  /** 子内容 */
  children: ReactNode;
  /** 额外的 className */
  className?: string;
  /** 标题文字颜色类名 */
  titleClassName?: string;
  /** 是否默认展开 */
  defaultOpen?: boolean;
}

/**
 * 通用渐隐预览组件
 * - 无边框、无背景色，和周围文本融为一体
 * - 默认显示 N 行预览，超出部分 gradient mask 渐隐
 * - 展开按钮在左上角（ChevronRight 旋转动画）
 * - 展开后显示完整内容，max-height + 内部滚动
 */
export function CollapsibleBlock({
  icon,
  title,
  statusIcon,
  headerActions,
  previewLines = 3,
  children,
  className,
  titleClassName,
  defaultOpen = false,
}: CollapsibleBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [clampPx, setClampPx] = useState<number | null>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  useEffect(() => {
    if (contentRef.current) {
      const lineHeight = parseFloat(getComputedStyle(contentRef.current).lineHeight) || 20;
      const maxHeight = lineHeight * previewLines;
      setClampPx(maxHeight);
      setNeedsCollapse(contentRef.current.scrollHeight > maxHeight + 4);
    }
  }, [children, previewLines]);

  const previewMaxHeight = clampPx != null ? `${clampPx}px` : `${previewLines * 1.4}em`;

  return (
    <div className={cn('group/collapsible', className)}>
      {/* 标题行：展开图标 + icon + title + status */}
      <button
        onClick={() => (previewLines === 0 || needsCollapse) && setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-left w-full hover:opacity-80 transition-opacity cursor-pointer"
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 flex-shrink-0',
            isOpen && 'rotate-90',
            previewLines === 0 ? 'opacity-100' : !needsCollapse && 'opacity-0'
          )}
        />
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className={cn('text-sm text-muted-foreground truncate', titleClassName)}>
          {title}
        </span>
        {headerActions && <span className="ml-auto flex-shrink-0">{headerActions}</span>}
        {statusIcon && (
          <span className={cn('flex-shrink-0', !headerActions && 'ml-auto')}>{statusIcon}</span>
        )}
      </button>

      {/* 内容区域：previewLines=0 且收起时不渲染任何内容 */}
      {(isOpen || previewLines > 0) && (
        <div className="pl-5 mt-0.5">
          {isOpen ? (
            <>
              {/* 展开：完整内容，限制最大高度 + 内部滚动 */}
              <div className="max-h-[500px] overflow-y-auto">
                {children}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center gap-1 w-full py-1 mt-0.5 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 rounded transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
                <span>收起</span>
              </button>
            </>
          ) : (
            /* 收起：预览 N 行 + 渐隐（仅 previewLines>0 时进入此分支） */
            <div className="relative">
              <div
                ref={contentRef}
                className="overflow-hidden"
                style={{ maxHeight: previewMaxHeight }}
              >
                {children}
              </div>
              {/* 渐隐遮罩 */}
              {needsCollapse && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                  style={{
                    background: 'linear-gradient(to bottom, transparent, var(--background, white))',
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
