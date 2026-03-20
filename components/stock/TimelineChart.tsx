import { useEffect, useRef } from 'react';
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import { useStockStore } from '@/stores/stock-store';

/**
 * 将 "09:30" 格式的时间字符串转换为当天的 UTC 时间戳（秒）
 * lightweight-charts 要求 UTCTimestamp 类型
 */
function timeToTimestamp(timeStr: string): UTCTimestamp {
  const now = new Date();
  const [h, m] = timeStr.split(':').map(Number);
  // 构造当天该时刻的 Date 对象
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  return (date.getTime() / 1000) as UTCTimestamp;
}

/**
 * 分时图组件
 * - 价格线（蓝色）+ 均价线（橙色）
 * - 底部成交量柱状图
 * - X 轴时间范围：09:30-15:00（A股交易时间）
 */
export function TimelineChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const timelineData = useStockStore((s) => s.timelineData);
  const currentQuote = useStockStore((s) => s.currentQuote);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 创建图表，暗色主题
    const chart = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(75, 85, 99, 0.3)' },
        horzLines: { color: 'rgba(75, 85, 99, 0.3)' },
      },
      crosshair: {
        vertLine: { labelVisible: true },
        horzLine: { labelVisible: true },
      },
      rightPriceScale: {
        borderColor: 'rgba(75, 85, 99, 0.5)',
      },
      timeScale: {
        borderColor: 'rgba(75, 85, 99, 0.5)',
        timeVisible: true,
        secondsVisible: false,
        // 自定义 tick 格式，只显示 HH:mm
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000);
          const hh = String(date.getHours()).padStart(2, '0');
          const mm = String(date.getMinutes()).padStart(2, '0');
          return `${hh}:${mm}`;
        },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    // 价格线（蓝色）
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    // 均价线（橙色）
    const avgSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // 成交量柱状图（底部独立 pane）
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'volume',
    }, 1);

    // 成交量 pane 的价格轴设置
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: 0 },
    });

    // 设置数据
    if (timelineData.length > 0) {
      const prevClose = currentQuote?.prevClose ?? timelineData[0].price;

      const priceData = timelineData.map((p) => ({
        time: timeToTimestamp(p.time),
        value: p.price,
      }));

      const avgData = timelineData.map((p) => ({
        time: timeToTimestamp(p.time),
        value: p.avgPrice,
      }));

      const volumeData = timelineData.map((p) => ({
        time: timeToTimestamp(p.time),
        value: p.volume,
        // 涨跌色：当前价高于昨收为红色，否则绿色
        color: p.price >= prevClose
          ? 'rgba(239, 68, 68, 0.5)'
          : 'rgba(34, 197, 94, 0.5)',
      }));

      priceSeries.setData(priceData);
      avgSeries.setData(avgData);
      volumeSeries.setData(volumeData);
      chart.timeScale().fitContent();
    }

    // ResizeObserver 响应式
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [timelineData, currentQuote]);

  // 空状态
  if (timelineData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        暂无分时数据
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-64"
    />
  );
}
