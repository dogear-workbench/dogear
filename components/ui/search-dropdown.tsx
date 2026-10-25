import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { FilterInput } from '@/components/ui/filter-input';

const MAX_RENDER = 50;

export function useDebouncedQuery<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface SearchResultsDropdownProps<T> {
  visible: boolean;
  results: T[];
  total: number;
  /** 索引被扫描上限截断：尾行提示结果可能不全（搜索框侧从 IPC truncated 标记透传） */
  truncated?: boolean;
  onSelect: (item: T) => void;
  onClose: () => void;
  renderItem: (item: T, active: boolean) => ReactNode;
  getKey: (item: T) => string;
  emptyText?: string;
  anchorRef?: RefObject<HTMLElement | null>;
}

export function SearchResultsDropdown<T>({
  visible,
  results,
  total,
  truncated,
  onSelect,
  onClose,
  renderItem,
  getKey,
  emptyText,
  anchorRef,
}: SearchResultsDropdownProps<T>) {
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef({ results, activeIndex, onSelect, onClose });

  useEffect(() => {
    latestRef.current = { results, activeIndex, onSelect, onClose };
  });

  useEffect(() => {
    if (visible) setActiveIndex(0);
  }, [visible, results]);

  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      latestRef.current.onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        latestRef.current.onClose();
        return;
      }
      const { results: items, activeIndex: index, onSelect: select } = latestRef.current;
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(Math.min(index + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(Math.max(index - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[index];
        if (item !== undefined) {
          select(item);
          latestRef.current.onClose();
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, anchorRef]);

  useEffect(() => {
    rootRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, visible]);

  if (!visible) return null;

  const shown = results.slice(0, MAX_RENDER);

  return (
    <div
      ref={rootRef}
      className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {results.length === 0 ? (
        <div className="px-3 py-3 text-center text-xs text-muted-foreground">
          {emptyText ?? '无匹配结果'}
        </div>
      ) : (
        <>
          {shown.map((item, i) => {
            const active = i === activeIndex;
            return (
              <div
                key={getKey(item)}
                data-active={active || undefined}
                className="cursor-pointer rounded-sm data-[active=true]:bg-muted"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                {renderItem(item, active)}
              </div>
            );
          })}
          {(truncated || total > shown.length) && (
            <div className="mt-1 border-t px-3 pb-0.5 pt-1.5 text-center text-[10px] text-muted-foreground">
              {truncated
                ? `共 ${total} 条命中，已达扫描上限，结果可能不全`
                : `共 ${total} 条命中，继续输入可缩小范围`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface PanelSearchBoxProps<T> {
  results: T[];
  total: number;
  truncated?: boolean;
  onSelect: (item: T) => void;
  renderItem: (item: T, active: boolean) => ReactNode;
  getKey: (item: T) => string;
  emptyText?: string;
  placeholder?: string;
  className?: string;
  onQueryChange?: (query: string) => void;
}

export function PanelSearchBox<T>({
  results,
  total,
  truncated,
  onSelect,
  renderItem,
  getKey,
  emptyText,
  placeholder,
  className,
  onQueryChange,
}: PanelSearchBoxProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedQuery(query);
  const onQueryChangeRef = useRef(onQueryChange);

  useEffect(() => {
    onQueryChangeRef.current = onQueryChange;
  });

  useEffect(() => {
    onQueryChangeRef.current?.(debounced);
  }, [debounced]);

  return (
    // FilterInput 不透传键盘/焦点事件，经容器冒泡接管
    <div
      ref={rootRef}
      className={cn('relative', className)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        setQuery('');
        setOpen(false);
      }}
      onFocus={() => {
        if (query.trim() !== '') setOpen(true);
      }}
    >
      <FilterInput
        value={query}
        onChange={(value) => {
          setQuery(value);
          setOpen(value.trim() !== '');
        }}
        placeholder={placeholder}
      />
      <SearchResultsDropdown
        visible={open}
        results={results}
        total={total}
        truncated={truncated}
        onSelect={onSelect}
        onClose={() => setOpen(false)}
        renderItem={renderItem}
        getKey={getKey}
        emptyText={emptyText}
        anchorRef={rootRef}
      />
    </div>
  );
}
