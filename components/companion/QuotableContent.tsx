import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requireReferenceAnchorId } from '@/lib/reference-guard';
import { isDraftAnchorId } from '@/stores/draft-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useInputFocusStore } from '@/stores/input-focus-store';

function SelectionTooltip({
  position,
  onQuote,
}: {
  position: { top: number; left: number };
  onQuote: () => void;
}) {
  return (
    <div
      className="absolute z-50 animate-in fade-in zoom-in-95 duration-150"
      style={{ top: position.top, left: position.left }}
    >
      <button
        onMouseDown={(e) => {
          // 用 mousedown 而非 click，避免点击时选区被清除
          e.preventDefault();
          e.stopPropagation();
          onQuote();
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg shadow-lg hover:bg-purple-700"
      >
        <Quote className="w-3 h-3" />
        引用到对话
      </button>
    </div>
  );
}

/**
 * 选字引用共享容器：mouseup 选区检测 + mousedown 防清除 + 相对容器定位的浮动引用按钮。
 * 选区确认后取引用锚定会话，回调 onQuote(text, anchorId)，锚定会话在本窗口 tab 栏时切过去聚焦。
 */
export function QuotableContent({
  onQuote,
  className,
  children,
}: {
  onQuote: (text: string, anchorConversationId: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback(() => {
    if (!contentRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setTooltipPos(null);
      setSelectedText('');
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setTooltipPos(null);
      setSelectedText('');
      return;
    }

    const range = selection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setTooltipPos(null);
      setSelectedText('');
      return;
    }

    const rangeRect = range.getBoundingClientRect();
    const containerRect = contentRef.current.getBoundingClientRect();

    setSelectedText(text);
    setTooltipPos({
      top: rangeRect.top - containerRect.top - 36,
      left: rangeRect.left - containerRect.left + rangeRect.width / 2 - 50,
    });
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-quote-tooltip]')) return;
    setTooltipPos(null);
    setSelectedText('');
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [handleMouseDown]);

  const handleQuote = useCallback(() => {
    if (!selectedText) return;
    const anchorId = requireReferenceAnchorId();
    if (!anchorId) return;

    onQuote(selectedText, anchorId);

    window.getSelection()?.removeAllRanges();
    setTooltipPos(null);
    setSelectedText('');

    // 草稿伪锚无 tab：switchTab(DRAFT_VIEW_ID) 保持草稿视图并聚焦草稿输入框；独立窗口无 session tabs，不打断当前视图
    const session = useSessionStore.getState();
    if (isDraftAnchorId(anchorId)) {
      session.switchTab(DRAFT_VIEW_ID);
      useInputFocusStore.getState().requestFocus(anchorId);
    } else if (session.getTab(anchorId)) {
      session.switchTab(anchorId);
      useInputFocusStore.getState().requestFocus(anchorId);
    }
  }, [selectedText, onQuote]);

  return (
    <div className={cn('relative', className)} ref={contentRef} onMouseUp={handleMouseUp}>
      {children}
      {tooltipPos && (
        <div data-quote-tooltip>
          <SelectionTooltip position={tooltipPos} onQuote={handleQuote} />
        </div>
      )}
    </div>
  );
}
