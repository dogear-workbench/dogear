import { useState, useEffect, useCallback, type RefObject } from 'react';
import { MessageSquareQuote, StickyNote } from 'lucide-react';

const TOOLTIP_WIDTH = 148;
const TOOLTIP_GAP = 36;

interface SelectionPosition {
  top: number;
  left: number;
}

/**
 * 会话消息选中后的浮动操作按钮组（受控：位置与回调由容器层提供）
 */
export function SelectionActionTooltip({
  position,
  onQuote,
  onSaveNote,
}: {
  position: SelectionPosition;
  onQuote: () => void;
  onSaveNote: () => void;
}) {
  return (
    <div
      data-selection-actions
      className="absolute z-50 flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150"
      style={{ top: position.top, left: position.left }}
    >
      <button
        onMouseDown={(e) => {
          // mousedown 触发而非 click，避免点击瞬间选区被浏览器清除
          e.preventDefault();
          e.stopPropagation();
          onQuote();
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 text-white text-xs rounded-lg shadow-lg hover:bg-slate-800 transition-colors"
      >
        <MessageSquareQuote className="w-3 h-3" />
        引用
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSaveNote();
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 text-white text-xs rounded-lg shadow-lg hover:bg-slate-800 transition-colors"
      >
        <StickyNote className="w-3 h-3" />
        存笔记
      </button>
    </div>
  );
}

/**
 * 消息流容器选区检测：mouseup 命中容器内选区时返回浮钮位置与选中文本，mousedown 容器外自动关闭
 */
export function useMessageSelection(containerRef: RefObject<HTMLDivElement | null>) {
  const [position, setPosition] = useState<SelectionPosition | null>(null);
  const [selectedText, setSelectedText] = useState('');

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setPosition(null);
    setSelectedText('');
  }, []);

  const reset = useCallback(() => {
    setPosition(null);
    setSelectedText('');
  }, []);

  const handleMouseUp = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const selection = window.getSelection();
    const text = selection && !selection.isCollapsed && selection.rangeCount > 0
      ? selection.toString().trim()
      : '';
    if (!text) {
      reset();
      return;
    }

    const range = selection!.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      reset();
      return;
    }

    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelectedText(text);
    setPosition({
      top: Math.max(rangeRect.top - containerRect.top - TOOLTIP_GAP, 4),
      left: Math.min(
        Math.max(rangeRect.left - containerRect.left + rangeRect.width / 2 - TOOLTIP_WIDTH / 2, 8),
        Math.max(containerRect.width - TOOLTIP_WIDTH - 8, 8),
      ),
    });
  }, [containerRef, reset]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-selection-actions]')) return;
      reset();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [reset]);

  return { position, selectedText, clear, handleMouseUp };
}
