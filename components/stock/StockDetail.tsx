import { useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStockStore } from '@/stores/stock-store';
import { StockQuote } from './StockQuote';
import { KLineChart } from './KLineChart';
import { TimelineChart } from './TimelineChart';
import { MoneyFlow } from './MoneyFlow';
import { StockFundamental } from './StockFundamental';
import { DailySnapshotList } from './DailySnapshotList';

/**
 * 个股详情容器
 * 右栏布局：行情卡片 + K线图 + 底部 Tab（分时 / 资金流向 / 基本面）
 * Tab 切换时懒加载对应数据
 */
export function StockDetail() {
  const selectedStock = useStockStore((s) => s.selectedStock);
  const loadingDetail = useStockStore((s) => s.loadingDetail);
  const loadTimeline = useStockStore((s) => s.loadTimeline);
  const loadMoneyFlow = useStockStore((s) => s.loadMoneyFlow);
  const loadDailySnapshots = useStockStore((s) => s.loadDailySnapshots);

  /** Tab 切换时懒加载数据 */
  const handleTabChange = useCallback(
    (value: string) => {
      if (value === 'timeline') {
        loadTimeline();
      } else if (value === 'moneyflow') {
        loadMoneyFlow();
      } else if (value === 'snapshot') {
        loadDailySnapshots();
      }
    },
    [loadTimeline, loadMoneyFlow, loadDailySnapshots],
  );

  // 未选中股票时的空状态
  if (!selectedStock) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请从左侧选择一只股票
      </div>
    );
  }

  // 加载中状态
  if (loadingDetail) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        {/* 行情卡片 */}
        <StockQuote />

        {/* K线图 */}
        <div className="rounded-md border overflow-hidden">
          <KLineChart />
        </div>

        {/* 底部 Tab：分时 / 资金流向 / 基本面 */}
        <Tabs defaultValue="timeline" onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="timeline" className="flex-1">
              分时
            </TabsTrigger>
            <TabsTrigger value="moneyflow" className="flex-1">
              资金流向
            </TabsTrigger>
            <TabsTrigger value="fundamental" className="flex-1">
              基本面
            </TabsTrigger>
            <TabsTrigger value="snapshot" className="flex-1">
              历史快照
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            <TimelineChart />
          </TabsContent>

          <TabsContent value="moneyflow">
            <MoneyFlow />
          </TabsContent>

          <TabsContent value="fundamental">
            <StockFundamental />
          </TabsContent>

          <TabsContent value="snapshot">
            <DailySnapshotList />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
