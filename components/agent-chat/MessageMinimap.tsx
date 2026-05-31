import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractMessagePreview } from './minimap-utils';
import { isSdkInjectedUserMessage } from './utils';
import { buildTurns } from './turns';
import { useConversationStore } from '@/stores/conversation-store';
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';
import type { Message } from './types';

interface MinimapProps {
  messages: Message[];
  hidden?: boolean;
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  /** 跳转到指定消息(由 useChatScroll 的 scrollToMessage 提供) */
  onJumpToMessage: (messageIndex: number) => void;
}

interface MinimapTurn {
  turnId: number;
  userPreview: string | null;
  assistantPreviews: string[]; // 同一 turn 内多条 assistant 合并展示
  jumpTargetIdx: number; // 点击跳转到哪条消息
}

/**
 * 消息 Minimap 浮窗
 * - hover 触发按钮展开浮窗;点击按钮固定/取消固定
 * - 按轮次(user + assistant)聚合展示,点击跳转到该轮次 user 消息
 * - 当前视口中心所在 turn 淡蓝背景高亮
 */
export function MessageMinimap({ messages, hidden, scrollAreaRef, onJumpToMessage }: MinimapProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [currentTurnId, setCurrentTurnId] = useState<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // compact 折叠状态：折叠时，最后一个 compact_boundary 之前的消息不进入 minimap
  const conversationId = useConversationStore((s) => s.selectedConversation?.id) || null;
  const isHistoryCollapsed = useCompactCollapseStore((s) => s.isCollapsed(conversationId));

  // Turn 分组: 复用共享 buildTurns，预览文案从 memberIdxs 派生
  const { turns, turnByIndex } = useMemo(() => {
    const { turns: rawTurns, turnByIndex } = buildTurns(messages, {
      collapsed: isHistoryCollapsed,
    });

    const turns: MinimapTurn[] = rawTurns.map((t) => {
      const userPreview =
        t.headerIdx !== null
          ? extractMessagePreview(messages[t.headerIdx]) || '(空消息)'
          : null;

      const assistantPreviews = t.memberIdxs
        .filter((i) => {
          if (i === t.headerIdx) return false;
          const m = messages[i];
          if (m.isMeta || m.isCompactBoundary || m.isCompactSummary) return false;
          if (m.role === 'user' && isSdkInjectedUserMessage(m.content)) return false;
          return true;
        })
        .map((i) => extractMessagePreview(messages[i]) || '(AI 回复)');

      return {
        turnId: t.turnId,
        userPreview,
        assistantPreviews,
        jumpTargetIdx: t.headerIdx ?? t.memberIdxs[0],
      };
    });

    return { turns, turnByIndex };
  }, [messages, isHistoryCollapsed]);

  const shouldShow = (hovering || pinned) && !hidden;

  // 计算当前 viewport 垂直中心所在的消息 idx → 该 turn id
  // 用 offsetTop(原位置)避免 sticky 干扰
  const recomputeCurrentTurn = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null;
    if (!viewport) return;
    const content = viewport.firstElementChild as HTMLElement | null;
    if (!content) return;

    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    const nodes = content.querySelectorAll<HTMLElement>('[data-message-id]');

    let hitIdx: number | null = null;
    for (const node of nodes) {
      const top = node.offsetTop;
      const bottom = top + node.offsetHeight;
      if (centerY >= top && centerY < bottom) {
        const match = node.dataset.messageId?.match(/^msg-(\d+)$/);
        if (match) hitIdx = Number(match[1]);
        break;
      }
    }

    if (hitIdx === null) {
      setCurrentTurnId(null);
      return;
    }
    setCurrentTurnId(turnByIndex.get(hitIdx) ?? null);
  }, [scrollAreaRef, turnByIndex]);

  useEffect(() => {
    if (!shouldShow) return;
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null;
    if (!viewport) return;

    requestAnimationFrame(recomputeCurrentTurn);
    viewport.addEventListener('scroll', recomputeCurrentTurn);
    const ro = new ResizeObserver(recomputeCurrentTurn);
    ro.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', recomputeCurrentTurn);
      ro.disconnect();
    };
  }, [shouldShow, scrollAreaRef, recomputeCurrentTurn]);

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

  if (hidden || turns.length < 3) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelHide();
        setHovering(true);
      }}
      onMouseLeave={scheduleHide}
    >
      {/* 触发器按钮 */}
      <button
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-md transition-colors',
          'hover:bg-muted',
          pinned && 'bg-muted',
        )}
        title={pinned ? '消息地图(已固定,点击取消)' : '消息地图'}
        onClick={() => setPinned((p) => !p)}
      >
        <MapIcon size={14} className={cn('text-muted-foreground', pinned && 'text-foreground')} />
      </button>

      {/* 浮窗: 按轮次展示,每个轮次一张卡片 */}
      {shouldShow && (
        <div className="absolute top-0 right-10 w-64 max-h-[500px] overflow-y-auto rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg p-1 space-y-1">
          {turns.map((turn) => {
            const isCurrent = turn.turnId === currentTurnId;
            const assistantMerged = turn.assistantPreviews.join('\n');
            return (
              <button
                key={turn.turnId}
                onClick={() => onJumpToMessage(turn.jumpTargetIdx)}
                className={cn(
                  'w-full text-left rounded-md border transition-colors p-2',
                  'hover:bg-muted',
                  isCurrent
                    ? 'bg-primary/10 border-primary/40'
                    : 'border-transparent',
                )}
              >
                {turn.userPreview && (
                  <div className="text-xs font-medium text-foreground whitespace-pre-wrap break-words line-clamp-2">
                    {turn.userPreview}
                  </div>
                )}
                {assistantMerged && (
                  <div
                    className={cn(
                      'text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-2',
                      turn.userPreview && 'mt-1 pt-1 border-t border-border/50',
                    )}
                  >
                    {assistantMerged}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
