import { useStockStore } from '@/stores/stock-store';
import { cn } from '@/lib/utils';
import { PercentBadge } from './shared/PercentBadge';

/** 格式化大数字：万亿 / 亿 / 万 */
function formatMarketCap(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + '万亿';
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toFixed(2);
}

/** 单个基本面数据项 */
function FundItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 p-2 rounded-md bg-muted/30">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-mono">{children}</span>
    </div>
  );
}

/**
 * 基本面数据卡片
 * 网格展示市盈率、市净率、市值、涨跌幅等关键指标
 */
export function StockFundamental() {
  const quote = useStockStore((s) => s.currentQuote);

  if (!quote) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        暂无基本面数据
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5">
      <FundItem label="市盈率(动态)">
        <span className={cn(quote.peRatio < 0 && 'text-muted-foreground')}>
          {quote.peRatio > 0 ? quote.peRatio.toFixed(2) : '亏损'}
        </span>
      </FundItem>
      <FundItem label="市盈率(TTM)">
        <span className={cn(quote.peRatioTTM < 0 && 'text-muted-foreground')}>
          {quote.peRatioTTM > 0 ? quote.peRatioTTM.toFixed(2) : '亏损'}
        </span>
      </FundItem>
      <FundItem label="市净率">
        {quote.pbRatio.toFixed(2)}
      </FundItem>
      <FundItem label="总市值">
        {formatMarketCap(quote.totalMarketCap)}
      </FundItem>
      <FundItem label="流通市值">
        {formatMarketCap(quote.floatMarketCap)}
      </FundItem>
      <FundItem label="换手率">
        {quote.turnoverRate.toFixed(2)}%
      </FundItem>
      <FundItem label="60日涨跌幅">
        <PercentBadge value={quote.changePercent60d} className="text-[10px] px-1 py-0" />
      </FundItem>
      <FundItem label="年初至今">
        <PercentBadge value={quote.changePercentYTD} className="text-[10px] px-1 py-0" />
      </FundItem>
      <FundItem label="振幅">
        {quote.amplitude.toFixed(2)}%
      </FundItem>
    </div>
  );
}
