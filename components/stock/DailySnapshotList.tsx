import { useStockStore } from '@/stores/stock-store';
import { cn } from '@/lib/utils';

/** 安全取数值 */
function safe(v: unknown): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

/** 格式化成交量（手） */
function fmtVol(n: unknown): string {
  const v = safe(n);
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return v.toFixed(0);
}

/** 外/内比 */
function outerRatio(outer: number, inner: number): string {
  const total = outer + inner;
  if (total <= 0) return '-';
  return ((outer / total) * 100).toFixed(1) + '%';
}

/**
 * 历史每日快照列表
 * 表格展示：日期 | 外盘 | 内盘 | 外盘占比 | 涨跌幅 | 换手率 | 均价
 */
export function DailySnapshotList() {
  const snapshots = useStockStore((s) => s.dailySnapshots);
  const loading = useStockStore((s) => s.loadingSnapshots);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        暂无历史快照数据，查看个股详情时会自动采集
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-64">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background">
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-1.5 px-1.5 font-normal">日期</th>
            <th className="text-right py-1.5 px-1.5 font-normal">外盘</th>
            <th className="text-right py-1.5 px-1.5 font-normal">内盘</th>
            <th className="text-right py-1.5 px-1.5 font-normal">外盘占比</th>
            <th className="text-right py-1.5 px-1.5 font-normal">涨跌幅</th>
            <th className="text-right py-1.5 px-1.5 font-normal">换手率</th>
            <th className="text-right py-1.5 px-1.5 font-normal">均价</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => {
            const outer = safe(s.outerVolume);
            const inner = safe(s.innerVolume);
            const chg = safe(s.changePercent);
            // 外盘 > 内盘 → 红色（买方强），反之绿色
            const outerColor = outer > inner ? 'text-red-500' : outer < inner ? 'text-green-500' : '';

            return (
              <tr key={s.date} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-1.5 px-1.5 font-mono text-muted-foreground">{s.date}</td>
                <td className={cn('text-right py-1.5 px-1.5 font-mono', outerColor)}>
                  {fmtVol(outer)}
                </td>
                <td className={cn('text-right py-1.5 px-1.5 font-mono', outerColor)}>
                  {fmtVol(inner)}
                </td>
                <td className={cn('text-right py-1.5 px-1.5 font-mono', outerColor)}>
                  {outerRatio(outer, inner)}
                </td>
                <td className={cn(
                  'text-right py-1.5 px-1.5 font-mono',
                  chg > 0 ? 'text-red-500' : chg < 0 ? 'text-green-500' : 'text-muted-foreground',
                )}>
                  {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                </td>
                <td className="text-right py-1.5 px-1.5 font-mono">
                  {safe(s.turnoverRate).toFixed(2)}%
                </td>
                <td className="text-right py-1.5 px-1.5 font-mono">
                  {safe(s.avgPrice).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
