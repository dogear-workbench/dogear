import { useState, useRef, useEffect } from 'react';
import { Map, Pin } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { extractMessagePreview } from './minimap-utils';
import type { Message } from './types';

interface MinimapProps {
  messages: Message[];
  hidden?: boolean;
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 消息 Minimap 浮窗
 * - hover 触发按钮展开浮窗，显示所有可见消息的缩略色块
 * - 点击图钉可固定浮窗
 * - 点击色块跳转到对应消息并触发闪烁
 * - 右侧绝对定位覆盖层显示当前视口位置
 */
export function MessageMinimap({ messages, hidden, scrollAreaRef }: MinimapProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minimapContainerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  // 过滤不可见消息
  const visibleMessages = messages.filter(
    m => !m.isMeta && !m.isCompactBoundary && !m.isCompactSummary
  );

  const shouldShow = (hovering || pinned) && !hidden;

  // 视口指示器：监听滚动容器
  useEffect(() => {
    if (!shouldShow) return;
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null;
    if (!viewport) return;

    const update = () => {
      const { scrollTop, clientHeight, scrollHeight } = viewport;
      if (scrollHeight === 0) return;
      const minimapHeight = minimapContainerRef.current?.clientHeight ?? 0;
      if (minimapHeight === 0) return;
      const topRatio = scrollTop / scrollHeight;
      const heightRatio = clientHeight / scrollHeight;
      setIndicator({
        top: topRatio * minimapHeight,
        height: Math.max(8, heightRatio * minimapHeight),
      });
    };

    update();
    viewport.addEventListener('scroll', update);
    const resizeObs = new ResizeObserver(update);
    resizeObs.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', update);
      resizeObs.disconnect();
    };
  }, [shouldShow, scrollAreaRef]);

  const scheduleHide = () => {
    if (pinned) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHovering(false), 500);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const jumpTo = (messageIdx: number) => {
    const el = document.querySelector(`[data-message-id="msg-${messageIdx}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (el as HTMLElement).classList.add('minimap-flash');
      setTimeout(() => (el as HTMLElement).classList.remove('minimap-flash'), 1200);
    }
  };

  // 消息少于 5 条不显示（hidden 也不显示）
  if (hidden || visibleMessages.length < 5) return null;

  return (
    <div
      className="absolute top-2 right-12 z-20"
      onMouseEnter={() => { cancelHide(); setHovering(true); }}
      onMouseLeave={scheduleHide}
    >
      {/* 触发器按钮 */}
      <button
        className="p-1.5 rounded-md bg-background/90 border border-border hover:bg-muted transition-colors"
        title="消息地图"
        onClick={() => setPinned(p => !p)}
      >
        <Map size={14} className={cn('text-muted-foreground', pinned && 'text-foreground')} />
      </button>

      {/* 浮窗 */}
      {shouldShow && (
        <div className="absolute top-8 right-0 w-12 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg p-1.5">
          {/* 图钉固定按钮 */}
          <button
            onClick={() => setPinned(p => !p)}
            className={cn(
              'w-full flex justify-center p-1 rounded hover:bg-muted mb-1',
              pinned && 'bg-muted'
            )}
            title={pinned ? '取消固定' : '固定'}
          >
            <Pin size={12} className={cn('text-muted-foreground', pinned && 'text-foreground')} />
          </button>

          {/* 消息块列表 + 视口指示器 */}
          <TooltipProvider delayDuration={200}>
            <div ref={minimapContainerRef} className="relative flex flex-col gap-0.5">
              {messages.map((msg, idx) => {
                if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) return null;
                const isUser = msg.role === 'user';
                const preview = extractMessagePreview(msg);
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => jumpTo(idx)}
                        className={cn(
                          'h-2 w-full rounded-sm hover:opacity-70 transition-opacity',
                          isUser ? 'bg-blue-500' : 'bg-muted-foreground/40'
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[240px] text-xs">
                      {preview || '(空消息)'}
                    </TooltipContent>
                  </Tooltip>
                );
              })}

              {/* 视口指示器覆盖层 */}
              {indicator && (
                <div
                  className="absolute left-0 right-0 bg-foreground/10 border border-foreground/20 rounded-sm pointer-events-none"
                  style={{ top: indicator.top, height: indicator.height }}
                />
              )}
            </div>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
