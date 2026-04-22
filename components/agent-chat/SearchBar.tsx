import { useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  isOpen: boolean;
  query: string;
  setQuery: (q: string) => void;
  totalMatches: number;
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SearchBar({
  isOpen,
  query,
  setQuery,
  totalMatches,
  activeIndex,
  onPrev,
  onNext,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const display = totalMatches === 0
    ? (query ? '无匹配' : '')
    : `${activeIndex + 1}/${totalMatches}`;

  return (
    <div className="absolute top-2 right-2 z-30 flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-sm">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.shiftKey ? onPrev() : onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="搜索..."
        className="h-6 w-48 px-2 text-xs bg-transparent focus:outline-none"
      />
      <span className="text-xs text-muted-foreground min-w-[40px] text-center">{display}</span>
      <button
        onClick={onPrev}
        disabled={totalMatches === 0}
        className={cn('p-0.5 rounded hover:bg-muted', totalMatches === 0 && 'opacity-30 cursor-not-allowed')}
        title="上一个 (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={onNext}
        disabled={totalMatches === 0}
        className={cn('p-0.5 rounded hover:bg-muted', totalMatches === 0 && 'opacity-30 cursor-not-allowed')}
        title="下一个 (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} className="p-0.5 rounded hover:bg-muted" title="关闭 (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}
