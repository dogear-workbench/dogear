// components/agent-chat/CollapsibleBlock.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleBlockProps {
  /** 标题行左侧图标 */
  icon?: ReactNode;
  /** 标题文本 */
  title: string;
  /** 标题右侧的状态指示 */
  statusIcon?: ReactNode;
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
  previewLines = 3,
  children,
  className,
  titleClassName,
  defaultOpen = false,
}: CollapsibleBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  // 检测内容是否超出预览行数
  useEffect(() => {
    if (contentRef.current) {
      const lineHeight = parseFloat(getComputedStyle(contentRef.current).lineHeight) || 20;
      const maxHeight = lineHeight * previewLines;
      setNeedsCollapse(contentRef.current.scrollHeight > maxHeight + 4);
    }
  }, [children, previewLines]);

  // 预览区域的最大高度（行数 × 行高）
  const previewMaxHeight = `${previewLines * 1.4}em`;

  return (
    <div className={cn('group/collapsible', className)}>
      {/* 标题行：展开图标 + icon + title + status */}
      <button
        onClick={() => needsCollapse && setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-left w-full hover:opacity-80 transition-opacity cursor-pointer"
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 flex-shrink-0',
            isOpen && 'rotate-90',
            !needsCollapse && 'opacity-0'
          )}
        />
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className={cn('text-sm text-muted-foreground truncate', titleClassName)}>
          {title}
        </span>
        {statusIcon && <span className="ml-auto flex-shrink-0">{statusIcon}</span>}
      </button>

      {/* 内容区域 */}
      <div className="pl-5 mt-0.5">
        {isOpen ? (
          /* 展开：完整内容，限制最大高度 + 内部滚动 */
          <div className="max-h-[500px] overflow-y-auto">
            {children}
          </div>
        ) : (
          /* 收起：预览 N 行 + 渐隐 */
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
    </div>
  );
}
