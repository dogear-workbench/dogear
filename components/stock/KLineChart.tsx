import { useEffect, useRef, useCallback } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { useStockStore } from '@/stores/stock-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { KLineDataPoint, KLinePeriod, AdjustType } from '@/types/stock';

// === 周期和复权选项 ===

const PERIOD_OPTIONS: { label: string; value: KLinePeriod }[] = [
  { label: '1分', value: 1 },
  { label: '5分', value: 5 },
  { label: '15分', value: 15 },
  { label: '30分', value: 30 },
  { label: '60分', value: 60 },
  { label: '日K', value: 101 },
  { label: '周K', value: 102 },
  { label: '月K', value: 103 },
];

const ADJUST_OPTIONS: { label: string; value: AdjustType }[] = [
  { label: '不复权', value: 0 },
  { label: '前复权', value: 1 },
  { label: '后复权', value: 2 },
];

// === 均线颜色配置 ===

const MA_CONFIG = [
  { period: 5, color: '#f59e0b' },   // 琥珀色
  { period: 10, color: '#3b82f6' },  // 蓝色
  { period: 20, color: '#a855f7' },  // 紫色
  { period: 60, color: '#6b7280' },  // 灰色
] as const;

/**
 * 将 K线日期字符串转为 lightweight-charts 可用的 time 值
 * - 日K/周K/月K: "2026-03-20" → 直接使用（BusinessDay string）
 * - 分钟K: "2026-03-20 09:31" → 转为 UTCTimestamp（秒数）
 */
function toChartTime(dateStr: string): string | number {
  if (dateStr.includes(' ')) {
    // 分钟级数据，含时间部分，转为 Unix 秒（UTC+8）
    const [datePart, timePart] = dateStr.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    const [h, min] = timePart.split(':').map(Number);
    // 构造北京时间 Date，然后取 UTC 秒数
    const dt = new Date(y, m - 1, d, h, min);
    return Math.floor(dt.getTime() / 1000) as number;
  }
  // 日K/周K/月K，纯日期字符串
  return dateStr;
}

/** 计算移动平均线 */
function calculateMA(data: KLineDataPoint[], period: number) {
  const result: { time: string | number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push({ time: toChartTime(data[i].date), value: sum / period });
  }
  return result;
}

// === 图表主题（暗色系） ===

const CHART_THEME = {
  layout: { background: { color: '#1a1a2e' }, textColor: '#a0a0b0' },
  grid: { vertLines: { color: '#2a2a3e' }, horzLines: { color: '#2a2a3e' } },
  crosshair: { mode: 0 as const },
  rightPriceScale: { borderColor: '#2a2a3e' },
  timeScale: { borderColor: '#2a2a3e', timeVisible: true, secondsVisible: false },
};

// 中国股市：红涨绿跌
const CANDLE_COLORS = {
  upColor: '#ef4444',
  downColor: '#22c55e',
  borderUpColor: '#ef4444',
  borderDownColor: '#22c55e',
  wickUpColor: '#ef4444',
  wickDownColor: '#22c55e',
};

export function KLineChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { klineData, klinePeriod, klineAdjust, loadingDetail, loadKLine } = useStockStore();

  /** 切换周期 */
  const handlePeriodChange = useCallback(
    (period: KLinePeriod) => {
      if (period !== klinePeriod) loadKLine(period);
    },
    [klinePeriod, loadKLine],
  );

  /** 切换复权 */
  const handleAdjustChange = useCallback(
    (adjust: AdjustType) => {
      if (adjust !== klineAdjust) loadKLine(undefined, adjust);
    },
    [klineAdjust, loadKLine],
  );

  // === 初始化 / 更新图表 ===
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || klineData.length === 0) return;

    // 创建图表
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 400,
      ...CHART_THEME,
    });
    chartRef.current = chart;

    // -- 蜡烛图 --
    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_COLORS);
    candleSeries.setData(
      klineData.map((d) => ({
        time: toChartTime(d.date) as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      })),
    );

    // -- 成交量（底部 20%） --
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(
      klineData.map((d) => ({
        time: toChartTime(d.date) as any,
        value: d.volume,
        color: d.close >= d.open ? '#ef444480' : '#22c55e80',
      })),
    );

    // -- 均线 --
    for (const ma of MA_CONFIG) {
      const maData = calculateMA(klineData, ma.period);
      if (maData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: ma.color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(maData);
      }
    }

    // 自适应显示全部数据
    chart.timeScale().fitContent();

    // -- ResizeObserver 响应式 --
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.resize(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [klineData]);

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏：周期切换 + 复权切换 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#2a2a3e] bg-[#1a1a2e] flex-wrap">
        {/* 周期按钮组 */}
        {PERIOD_OPTIONS.map((p) => (
          <Button
            key={p.value}
            size="xs"
            variant={klinePeriod === p.value ? 'secondary' : 'ghost'}
            className={cn(
              'text-xs font-normal',
              klinePeriod === p.value
                ? 'bg-[#2a2a4e] text-white'
                : 'text-[#a0a0b0] hover:text-white hover:bg-[#2a2a3e]',
            )}
            onClick={() => handlePeriodChange(p.value)}
            disabled={loadingDetail}
          >
            {p.label}
          </Button>
        ))}

        {/* 分隔线 */}
        <div className="mx-1.5 h-4 border-l border-[#2a2a3e]" />

        {/* 复权按钮组 */}
        {ADJUST_OPTIONS.map((a) => (
          <Button
            key={a.value}
            size="xs"
            variant={klineAdjust === a.value ? 'secondary' : 'ghost'}
            className={cn(
              'text-xs font-normal',
              klineAdjust === a.value
                ? 'bg-[#2a2a4e] text-white'
                : 'text-[#a0a0b0] hover:text-white hover:bg-[#2a2a3e]',
            )}
            onClick={() => handleAdjustChange(a.value)}
            disabled={loadingDetail}
          >
            {a.label}
          </Button>
        ))}

        {/* 均线图例 */}
        <div className="ml-auto flex items-center gap-3 text-[10px]">
          {MA_CONFIG.map((ma) => (
            <span key={ma.period} className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-[2px] rounded-full"
                style={{ backgroundColor: ma.color }}
              />
              <span className="text-[#a0a0b0]">MA{ma.period}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 图表容器 */}
      <div className="relative flex-1 min-h-[400px]">
        <div ref={chartContainerRef} className="absolute inset-0" />

        {/* 加载中遮罩 */}
        {loadingDetail && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/60 z-10">
            <span className="text-sm text-[#a0a0b0] animate-pulse">加载中...</span>
          </div>
        )}

        {/* 无数据提示 */}
        {!loadingDetail && klineData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-[#a0a0b0]">暂无K线数据</span>
          </div>
        )}
      </div>
    </div>
  );
}
