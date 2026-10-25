import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConversationSearchProvider } from '@/components/ConversationSearchProvider';
import {
  conversationSearchActions,
  useConversationSearchStore,
} from '@/stores/conversation-search-store';
import {
  useActiveProvider,
  type SearchHit,
} from '@/stores/search-store';

const DEBOUNCE_MS = 150;
const WIDTH = 330;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitKeywords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function highlightText(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const re = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(re).map((part, i) =>
    words.includes(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-amber-200/60 px-0.5 text-foreground dark:bg-amber-500/30">{part}</mark>
    ) : (
      part
    ),
  );
}

export function TopBarSearch() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeProvider = useActiveProvider();
  const conversationMode = activeProvider?.mode === 'conversation';
  const bridgeQuery = useConversationSearchStore((s) => s.query);
  const bridgeUnitCount = useConversationSearchStore((s) => s.unitCount);
  const bridgeUnitIndex = useConversationSearchStore((s) => s.unitIndex);
  const keywords = useMemo(() => splitKeywords(query), [query]);

  useEffect(() => {
    if (conversationMode || !query.trim() || !activeProvider) {
      setHits([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.resolve(activeProvider.search(query))
        .then((result) => {
          if (seq !== seqRef.current) return;
          setHits(result);
          setLoading(false);
        })
        .catch((error) => {
          console.error('[search] 搜索失败:', error);
          if (seq !== seqRef.current) return;
          setHits([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, activeProvider, conversationMode]);

  useEffect(() => {
    if (!focused) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setFocused(false);
      inputRef.current?.blur();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [focused]);

  const enabled = !!activeProvider;
  const value = conversationMode ? bridgeQuery : query;
  const dropVisible = !conversationMode && focused && query.trim() !== '';

  const collapse = (clearQuery: boolean) => {
    if (clearQuery) {
      if (conversationMode) conversationSearchActions.close();
      else setQuery('');
    }
    setFocused(false);
    inputRef.current?.blur();
  };

  const handleInput = (next: string) => {
    if (conversationMode) conversationSearchActions.setQuery(next);
    else setQuery(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      collapse(true);
      return;
    }
    if (conversationMode && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) conversationSearchActions.prev();
      else conversationSearchActions.next();
    }
  };

  const handleSelect = (hit: SearchHit) => {
    collapse(true);
    hit.onSelect();
  };

  const placeholder = activeProvider?.placeholder ?? '搜索';
  const showConvNav = focused && conversationMode && !!value.trim();
  const countDisplay =
    bridgeUnitCount === 0 ? '无匹配' : `${bridgeUnitIndex + 1}/${bridgeUnitCount}`;

  return (
    <>
      <ConversationSearchProvider />
      <div
        ref={rootRef}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <div
          className={cn(
            'flex items-center gap-1.5 h-7 rounded-full border px-3',
            focused
              ? 'bg-background border-primary/45'
              : 'bg-muted/50 border-transparent',
            enabled && !focused && 'cursor-text hover:bg-muted',
            !enabled && 'opacity-60',
          )}
          style={{ width: WIDTH, maxWidth: '38vw' }}
          onClick={() => enabled && inputRef.current?.focus()}
        >
          <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={!enabled}
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground disabled:cursor-default"
          />
          {showConvNav && (
            <>
              <span className="shrink-0 min-w-[40px] text-center text-xs text-muted-foreground tabular-nums">
                {countDisplay}
              </span>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => conversationSearchActions.prev()}
                disabled={bridgeUnitCount === 0}
                className={cn('shrink-0 p-0.5 rounded hover:bg-muted', bridgeUnitCount === 0 && 'opacity-30 cursor-not-allowed')}
                title="上一处 (Shift+Enter)"
              >
                <ChevronUp size={14} />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => conversationSearchActions.next()}
                disabled={bridgeUnitCount === 0}
                className={cn('shrink-0 p-0.5 rounded hover:bg-muted', bridgeUnitCount === 0 && 'opacity-30 cursor-not-allowed')}
                title="下一处 (Enter)"
              >
                <ChevronDown size={14} />
              </button>
            </>
          )}
        </div>

        {dropVisible && (
          <div className="absolute left-0 top-full mt-2 w-[330px] max-w-[60vw] rounded-xl border bg-popover shadow-lg p-1 z-50">
            {loading && hits.length === 0 ? (
              <div className="flex items-center justify-center gap-1.5 px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                搜索中
              </div>
            ) : query.trim() && hits.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                没有找到「{query.trim()}」
              </div>
            ) : (
              hits.map((hit) => {
                const Icon = hit.icon;
                return (
                  <button
                    key={hit.id}
                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-xs text-left cursor-pointer text-foreground hover:bg-muted"
                    onClick={() => handleSelect(hit)}
                  >
                    {Icon && <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{hit.title}</span>
                      {hit.description && (
                        <span className="mt-0.5 block truncate text-[10px] leading-snug text-muted-foreground">
                          {highlightText(hit.description, keywords)}
                        </span>
                      )}
                    </span>
                    {hit.subtitle && (
                      <span className="shrink-0 max-w-24 truncate text-[10px] leading-none text-muted-foreground border rounded-full px-1.5 py-1 mt-0.5">
                        {hit.subtitle}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </>
  );
}
