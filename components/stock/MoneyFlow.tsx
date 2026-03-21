import { useStockStore } from '@/stores/stock-store';
import { cn } from '@/lib/utils';

/** 安全取数值 */
function safe(v: unknown): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

/** 格式化金额：亿 / 万 */
function formatAmount(n: unknown): string {
  const v = safe(n);
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return v.toFixed(0);
}

/** 获取涨跌色 className */
function flowColor(value: unknown): string {
  const v = safe(value);
  if (v > 0) return 'text-red-500';
  if (v < 0) return 'text-green-500';
  return 'text-muted-foreground';
}

/** 获取柱状图背景色 */
function barColor(value: unknown): string {
  return safe(value) > 0 ? 'bg-red-500' : 'bg-green-500';
}

/**
 * 资金流向组件
 * - 主力净流入柱状图（div 模拟）
 * - 表格显示每日明细：日期 | 主力净流入 | 散户净流入
 */
export function MoneyFlow() {
  const moneyFlowData = useStockStore((s) => s.moneyFlowData);

  // 空状态
  if (moneyFlowData.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        暂无资金流向数据
      </div>
    );
  }

  // 计算柱状图最大值，用于归一化高度
  const maxMainNet = Math.max(
    ...moneyFlowData.map((d) => Math.abs(d.mainNetInflow)),
    1, // 防止除零
  );

  return (
    <div className="space-y-3">
      {/* 柱状图区域 */}
      <div className="px-2">
        <div className="flex items-end gap-0.5 h-24">
          {moneyFlowData.map((d) => {
            const pct = Math.abs(d.mainNetInflow) / maxMainNet;
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col justify-end h-full"
                title={`${d.date}\n主力净流入: ${formatAmount(d.mainNetInflow)}`}
              >
                <div
                  className={cn('w-full rounded-t-sm min-h-[2px]', barColor(d.mainNetInflow))}
                  style={{ height: `${pct * 100}%`, opacity: 0.8 }}
                />
              </div>
            );
          })}
        </div>
        {/* X轴日期标签（只显示首、中、末） */}
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">
            {moneyFlowData[0]?.date.slice(5)}
          </span>
          {moneyFlowData.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              {moneyFlowData[Math.floor(moneyFlowData.length / 2)]?.date.slice(5)}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {moneyFlowData[moneyFlowData.length - 1]?.date.slice(5)}
          </span>
        </div>
      </div>

      {/* 明细表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-1.5 px-2 text-left font-medium">日期</th>
              <th className="py-1.5 px-2 text-right font-medium">主力净流入</th>
              <th className="py-1.5 px-2 text-right font-medium">散户净流入</th>
            </tr>
          </thead>
          <tbody>
            {moneyFlowData.map((d) => (
              <tr key={d.date} className="border-b border-border/50">
                <td className="py-1.5 px-2 text-muted-foreground">{d.date.slice(5)}</td>
                <td className={cn('py-1.5 px-2 text-right font-mono', flowColor(d.mainNetInflow))}>
                  {formatAmount(d.mainNetInflow)}
                </td>
                <td className={cn('py-1.5 px-2 text-right font-mono', flowColor(d.retailNetInflow))}>
                  {formatAmount(d.retailNetInflow)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
