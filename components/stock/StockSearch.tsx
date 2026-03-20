import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStockStore } from '@/stores/stock-store';

interface StockSearchProps {
  open: boolean;
  onClose: () => void;
}

/** 根据市场和类型返回市场标签文本 */
function getMarketLabel(market: number, type: string): string {
  // type 字段可能包含 "A股"、"创业板"、"科创板" 等
  if (type.includes('科创板')) return '科创板';
  if (type.includes('创业板')) return '创业板';
  if (market === 1) return '沪A';
  if (market === 0) return '深A';
  return type || '其他';
}

/** 根据市场标签返回颜色 */
function getMarketColor(label: string): string {
  switch (label) {
    case '沪A': return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
    case '深A': return 'bg-purple-500/15 text-purple-600 dark:text-purple-400';
    case '创业板': return 'bg-orange-500/15 text-orange-600 dark:text-orange-400';
    case '科创板': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

/**
 * 股票搜索弹窗
 * 固定定位 overlay，输入防抖 300ms 搜索，点击结果添加到自选
 */
export function StockSearch({ open, onClose }: StockSearchProps) {
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { searchResults, searchLoading, searchStocks, clearSearch, addToWatchlist } = useStockStore();

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      // 延迟一帧确保 DOM 已渲染
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 关闭时清理状态
  useEffect(() => {
    if (!open) {
      setKeyword('');
      clearSearch();
    }
  }, [open, clearSearch]);

  // 输入防抖搜索
  const handleInputChange = useCallback((value: string) => {
    setKeyword(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchStocks(value);
    }, 300);
  }, [searchStocks]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // 点击搜索结果，添加自选并关闭
  const handleSelect = useCallback(async (result: { code: string; market: number; name: string }) => {
    await addToWatchlist({ code: result.code, market: result.market, name: result.name });
    onClose();
  }, [addToWatchlist, onClose]);

  // ESC 关闭
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-20"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      {/* 搜索面板 - 阻止点击冒泡 */}
      <div
        className="bg-background rounded-lg shadow-lg w-96 max-h-[60vh] flex flex-col border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索头部 */}
        <div className="p-3 border-b flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={keyword}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="输入代码或名称搜索..."
            className="h-8 border-0 shadow-none focus-visible:ring-0 px-0"
          />
          {searchLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* 搜索结果列表 */}
        <ScrollArea className="flex-1">
          {searchResults.length > 0 ? (
            <div className="p-1">
              {searchResults.map((result) => {
                const label = getMarketLabel(result.market, result.type);
                return (
                  <button
                    key={`${result.market}-${result.code}`}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left',
                      'hover:bg-accent transition-colors cursor-pointer',
                      'group'
                    )}
                    onClick={() => handleSelect(result)}
                  >
                    {/* 代码 + 名称 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{result.code}</span>
                        <Badge
                          variant="secondary"
                          className={cn('text-[10px] px-1.5 py-0 h-4 font-normal', getMarketColor(label))}
                        >
                          {label}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{result.name}</div>
                    </div>
                    {/* 添加按钮 */}
                    <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {keyword.trim()
                ? (searchLoading ? '搜索中...' : '无匹配结果')
                : '输入代码或名称搜索'}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
