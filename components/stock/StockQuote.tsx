import { useStockStore } from '@/stores/stock-store';
import { PriceText } from './shared/PriceText';
import { PercentBadge } from './shared/PercentBadge';
import { cn } from '@/lib/utils';

/** 安全取数值，undefined/NaN 返回 0 */
function safeNum(v: unknown): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

/** 格式化大数字：亿 / 万亿 / 万 */
function formatLargeNumber(n: unknown): string {
  const v = safeNum(n);
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return v.toFixed(2);
}

/** 格式化成交量（手） */
function formatVolume(n: unknown): string {
  const v = safeNum(n);
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿手';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万手';
  return v.toFixed(0) + '手';
}

/** 安全 toFixed */
function fmt(v: unknown, digits = 2): string {
  return safeNum(v).toFixed(digits);
}

/** 市场标签文字 */
function marketLabel(market: number): string {
  return market === 1 ? '沪A' : '深A';
}

/** 单个数据项 */
function DataItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-mono', className)}>{value}</span>
    </div>
  );
}

/** 涨跌色数据项（根据正负值着色） */
function ColoredDataItem({ label, value, raw }: { label: string; value: string; raw: number }) {
  const colorClass = raw > 0 ? 'text-red-500' : raw < 0 ? 'text-green-500' : 'text-muted-foreground';
  return <DataItem label={label} value={value} className={colorClass} />;
}

export function StockQuote() {
  const quote = useStockStore((s) => s.currentQuote);

  if (!quote) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        暂无行情数据
      </div>
    );
  }

  const {
    code, name, market, price, changePercent, changeAmount,
    volume, turnover, open, high, low, prevClose,
    amplitude, turnoverRate, peRatio, pbRatio,
    totalMarketCap, floatMarketCap, volumeRatio,
    speedPercent, mainNetInflow,
  } = quote;

  // 涨跌额前缀
  const changeSign = changeAmount > 0 ? '+' : '';

  return (
    <div className="space-y-3">
      {/* 头部：名称 + 代码 + 市场 */}
      <div className="flex items-baseline justify-between px-2">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold">{name}</span>
          <span className="text-xs text-muted-foreground">{code}</span>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {marketLabel(market)}
        </span>
      </div>

      {/* 价格行：大字价格 + 涨跌额 + 涨跌幅 */}
      <div className="flex items-baseline gap-3 px-2">
        <PriceText
          value={price}
          prevClose={prevClose}
          prefix="¥"
          className="text-2xl font-bold tabular-nums"
        />
        <PriceText
          value={changeAmount}
          prevClose={0}
          prefix={changeSign}
          className="text-sm font-medium tabular-nums"
        />
        <PercentBadge value={changePercent} />
      </div>

      {/* 数据网格：3列 */}
      <div className="grid grid-cols-3 gap-px bg-border rounded-md overflow-hidden">
        <div className="bg-background">
          <DataItem label="开盘" value={fmt(open)} />
          <DataItem label="昨收" value={fmt(prevClose)} />
          <ColoredDataItem label="振幅" value={fmt(amplitude) + '%'} raw={safeNum(amplitude)} />
          <DataItem label="市盈率" value={fmt(peRatio, 1)} />
          <DataItem label="总市值" value={formatLargeNumber(totalMarketCap)} />
        </div>
        <div className="bg-background">
          <DataItem label="最高" value={fmt(high)} />
          <DataItem label="最低" value={fmt(low)} />
          <DataItem label="换手率" value={fmt(turnoverRate) + '%'} />
          <DataItem label="市净率" value={fmt(pbRatio)} />
          <DataItem label="流通市值" value={formatLargeNumber(floatMarketCap)} />
        </div>
        <div className="bg-background">
          <DataItem label="成交量" value={formatVolume(volume)} />
          <DataItem label="成交额" value={formatLargeNumber(turnover)} />
          <DataItem label="量比" value={fmt(volumeRatio)} />
          <ColoredDataItem label="涨速" value={fmt(speedPercent) + '%'} raw={safeNum(speedPercent)} />
          <ColoredDataItem label="主力净流入" value={formatLargeNumber(mainNetInflow)} raw={safeNum(mainNetInflow)} />
        </div>
      </div>
    </div>
  );
}
