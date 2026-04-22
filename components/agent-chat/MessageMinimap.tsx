import { useState, useRef, useEffect, useCallback } from 'react';
import { Map } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractMessagePreview } from './minimap-utils';
import type { Message } from './types';

interface MinimapProps {
  messages: Message[];
  hidden?: boolean;
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  /** 跳转到指定 DOM 元素（交给 AgentChat 用统一的 viewport-based 滚动） */
  onJumpTo: (el: HTMLElement) => void;
}

/**
 * 消息 Minimap 浮窗
 * - hover 触发按钮展开浮窗，显示可见消息的文字预览
 * - 再次点击触发按钮可钉住浮窗
 * - 浮窗内部点击任意行跳转到对应消息并触发闪烁
 * - 当前视口覆盖的消息行整体高亮
 */
export function MessageMinimap({ messages, hidden, scrollAreaRef, onJumpTo }: MinimapProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [currentMessageIdx, setCurrentMessageIdx] = useState<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 过滤不可见消息（仅用于"少于 5 条不显示"的判定）
  const visibleCount = messages.filter(
    m => !m.isMeta && !m.isCompactBoundary && !m.isCompactSummary
  ).length;

  const shouldShow = (hovering || pinned) && !hidden;

  // 根据 viewport 中心所在位置，找到当前对应的消息索引
  const updateCurrentMessage = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null;
    if (!viewport) return;

    const vpRect = viewport.getBoundingClientRect();
    const centerY = vpRect.top + vpRect.height / 2;

    // 遍历所有可见消息 DOM，找到距离中心线最近的一条
    let bestIdx: number | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) continue;
      const el = document.querySelector(`[data-message-id="msg-${i}"]`) as HTMLElement | null;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(mid - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    setCurrentMessageIdx(bestIdx);
  }, [messages, scrollAreaRef]);

  // 监听 viewport 滚动，更新当前消息
  useEffect(() => {
    if (!shouldShow) return;
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null;
    if (!viewport) return;

    requestAnimationFrame(updateCurrentMessage);
    viewport.addEventListener('scroll', updateCurrentMessage);
    const resizeObs = new ResizeObserver(updateCurrentMessage);
    resizeObs.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', updateCurrentMessage);
      resizeObs.disconnect();
    };
  }, [shouldShow, scrollAreaRef, updateCurrentMessage]);

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
    const el = document.querySelector(`[data-message-id="msg-${messageIdx}"]`) as HTMLElement | null;
    if (!el) return;
    onJumpTo(el);
    el.classList.add('minimap-flash');
    setTimeout(() => el.classList.remove('minimap-flash'), 1200);
  };

  // 消息少于 5 条不显示（hidden 也不显示）
  if (hidden || visibleCount < 5) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelHide(); setHovering(true); }}
      onMouseLeave={scheduleHide}
    >
      {/* 触发器按钮（作为轨道按钮组的成员，由父容器 flex 布局定位） */}
      <button
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-md transition-colors',
          'hover:bg-muted',
          pinned && 'bg-muted'
        )}
        title={pinned ? '消息地图（已固定，点击取消）' : '消息地图'}
        onClick={() => setPinned(p => !p)}
      >
        <Map size={14} className={cn('text-muted-foreground', pinned && 'text-foreground')} />
      </button>

      {/* 浮窗：在触发按钮左侧展开 */}
      {shouldShow && (
        <div className="absolute top-0 right-10 w-48 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg py-1">
          {messages.map((msg, idx) => {
            if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) return null;
            const isUser = msg.role === 'user';
            const preview = extractMessagePreview(msg) || (isUser ? '(空消息)' : '(AI 回复)');
            const isCurrent = idx === currentMessageIdx;
            return (
              <button
                key={idx}
                onClick={() => jumpTo(idx)}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-1 text-left transition-colors text-xs',
                  'hover:bg-muted border-l-2',
                  isUser ? 'border-l-blue-500' : 'border-l-muted-foreground/40',
                  isCurrent && 'bg-primary/10 ring-1 ring-primary/30'
                )}
                title={preview}
              >
                <span className="truncate flex-1">{preview}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
