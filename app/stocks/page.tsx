import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStockStore } from '@/stores/stock-store';
import { WatchList } from '@/components/stock/WatchList';
import { StockDetail } from '@/components/stock/StockDetail';
import { StockSearch } from '@/components/stock/StockSearch';

/**
 * 股票主页面
 * 双栏布局：左侧自选股列表 + 右侧个股详情
 */
export default function StockPage() {
  const loadWatchlist = useStockStore((s) => s.loadWatchlist);
  const refreshQuotes = useStockStore((s) => s.refreshQuotes);
  const [searchOpen, setSearchOpen] = useState(false);

  // 刷新按钮 500ms 防抖
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return; // 防抖期间忽略点击
    refreshQuotes();
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
    }, 500);
  }, [refreshQuotes]);

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // 初始化：加载自选股 → 刷新行情
  useEffect(() => {
    loadWatchlist().then(() => refreshQuotes());
  }, [loadWatchlist, refreshQuotes]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
        <h1 className="text-sm font-medium">自选股行情</h1>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)}>
          <Search className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </header>

      {/* 双栏 */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-60 border-r flex flex-col">
          <WatchList onAddClick={() => setSearchOpen(true)} />
        </aside>
        <main className="flex-1 overflow-hidden">
          <StockDetail />
        </main>
      </div>

      {/* 搜索弹窗 */}
      <StockSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
