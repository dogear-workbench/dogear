import { Plus, Trash2, Loader2, TrendingUp } from 'lucide-react';
import { useStockStore } from '@/stores/stock-store';
import { showConfirm } from '@/stores/confirm-store';
import { cn } from '@/lib/utils';
import { PriceText } from './shared/PriceText';
import { PercentBadge } from './shared/PercentBadge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';

interface WatchListProps {
  /** 点击添加按钮时触发，由父组件控制搜索弹窗 */
  onAddClick: () => void;
}

export function WatchList({ onAddClick }: WatchListProps) {
  const watchlist = useStockStore((s) => s.watchlist);
  const quotes = useStockStore((s) => s.quotes);
  const selectedStock = useStockStore((s) => s.selectedStock);
  const loadingQuotes = useStockStore((s) => s.loadingQuotes);
  const selectStock = useStockStore((s) => s.selectStock);
  const removeFromWatchlist = useStockStore((s) => s.removeFromWatchlist);

  const items = watchlist?.items ?? [];

  /** 右键删除：确认后移除自选股 */
  const handleRemove = async (market: number, code: string, name: string) => {
    const confirmed = await showConfirm(
      '删除自选股',
      `确定要将 ${name}(${code}) 从自选股中移除吗？`,
    );
    if (confirmed) {
      removeFromWatchlist(market, code);
    }
  };

  // 空状态
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <TrendingUp className="size-10 opacity-40" />
          <p className="text-sm">暂无自选股</p>
          <p className="text-xs">点击下方按钮添加关注的股票</p>
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center gap-1.5"
            onClick={onAddClick}
          >
            <Plus className="size-4" />
            添加股票
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 自选股列表 */}
      <ScrollArea className="flex-1">
        <div className="space-y-px p-1">
          {items.map((item) => {
            const key = `${item.market}.${item.code}`;
            const quote = quotes.get(key);
            const isSelected =
              selectedStock?.market === item.market &&
              selectedStock?.code === item.code;

            return (
              <ContextMenu key={key}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors',
                      'hover:bg-accent/50',
                      isSelected && 'bg-accent',
                    )}
                    onClick={() => selectStock(item.market, item.code)}
                  >
                    {/* 左侧：名称 + 代码 */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.code}
                      </div>
                    </div>

                    {/* 右侧：价格 + 涨跌幅 */}
                    <div className="flex items-center gap-2">
                      {loadingQuotes && !quote ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : quote ? (
                        <>
                          <PriceText
                            value={quote.price}
                            prevClose={quote.prevClose}
                            className="text-sm font-mono"
                          />
                          <PercentBadge value={quote.changePercent} />
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </div>
                  </div>
                </ContextMenuTrigger>

                {/* 右键菜单 */}
                <ContextMenuContent>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() =>
                      handleRemove(item.market, item.code, item.name)
                    }
                  >
                    <Trash2 className="size-4" />
                    删除自选股
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </ScrollArea>

      {/* 底部添加按钮 */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center gap-1.5"
          onClick={onAddClick}
        >
          <Plus className="size-4" />
          添加股票
        </Button>
      </div>
    </div>
  );
}
