/**
 * 股票工具共享格式化助手（stock-tools 与 stock-analysis-tools 共用）
 */

/** 安全数字格式化（防止 undefined.toFixed 崩溃） */
export function safe(val: number | undefined | null, digits = 2): string {
  if (val == null || isNaN(val)) return '-';
  return val.toFixed(digits);
}

/** 金额格式化：亿/万，用于资金流向净额（元）展示 */
export function formatYuan(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '-';
  const abs = Math.abs(val);
  if (abs >= 1e8) return `${(val / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(val / 1e4).toFixed(1)}万`;
  return val.toFixed(0);
}

/** 获取数组最后一个非 null 值 */
export function lastValue(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  }
  return null;
}

/** 格式化单个指标结果为可读文本 */
export function formatIndicatorResult(name: string, data: Record<string, (number | null)[]>): string {
  switch (name) {
    case 'MACD': {
      const dif = lastValue(data.DIF);
      const dea = lastValue(data.DEA);
      const macd = lastValue(data.MACD);
      const trend = dif !== null && dea !== null
        ? (dif > dea ? 'DIF 在 DEA 上方（多头）' : 'DIF 在 DEA 下方（空头）')
        : '';
      const zeroAxis = dif !== null
        ? (dif > 0 ? '，DIF 在零轴上方' : '，DIF 在零轴下方')
        : '';
      return `MACD(12,26,9): DIF=${safe(dif, 4)}, DEA=${safe(dea, 4)}, 柱=${safe(macd, 4)} | ${trend}${zeroAxis}`;
    }
    case 'KDJ': {
      const k = lastValue(data.K);
      const d = lastValue(data.D);
      const j = lastValue(data.J);
      let zone = '';
      if (k !== null) {
        if (k > 80) zone = '超买区(>80)';
        else if (k < 20) zone = '超卖区(<20)';
        else zone = '中性区间';
      }
      return `KDJ(9,3,3): K=${safe(k)}, D=${safe(d)}, J=${safe(j)} | ${zone}`;
    }
    case 'RSI': {
      const rsi = lastValue(data.RSI);
      let zone = '';
      if (rsi !== null) {
        if (rsi > 70) zone = '超买区(>70)';
        else if (rsi < 30) zone = '超卖区(<30)';
        else if (rsi >= 40 && rsi <= 60) zone = '中性区间(40-60)';
        else if (rsi > 60) zone = '偏强(60-70)';
        else zone = '偏弱(30-40)';
      }
      return `RSI(14): ${safe(rsi)} | ${zone}`;
    }
    case 'BOLL': {
      const upper = lastValue(data.UPPER);
      const mid = lastValue(data.MID);
      const lower = lastValue(data.LOWER);
      return `BOLL(20,2): 上轨=${safe(upper, 2)}, 中轨=${safe(mid, 2)}, 下轨=${safe(lower, 2)}`;
    }
    case 'MA': {
      const parts: string[] = [];
      for (const key of Object.keys(data).sort()) {
        const val = lastValue(data[key]);
        parts.push(`${key}=${safe(val, 2)}`);
      }
      return `均线: ${parts.join(', ')}`;
    }
    case 'EMA': {
      const parts: string[] = [];
      for (const key of Object.keys(data).sort()) {
        const val = lastValue(data[key]);
        parts.push(`${key}=${safe(val, 2)}`);
      }
      return `指数均线: ${parts.join(', ')}`;
    }
    case 'WR': {
      const wr = lastValue(data.WR);
      let zone = '';
      if (wr !== null) {
        if (wr > -20) zone = '超买区(>-20)';
        else if (wr < -80) zone = '超卖区(<-80)';
        else zone = '中性区间';
      }
      return `WR(14): ${safe(wr)} | ${zone}`;
    }
    case 'OBV': {
      const obv = lastValue(data.OBV);
      return `OBV: ${obv !== null ? obv.toLocaleString() : '-'}`;
    }
    case 'ATR': {
      const atr = lastValue(data.ATR);
      return `ATR(14): ${safe(atr, 4)}`;
    }
    case 'VWAP': {
      const vwap = lastValue(data.VWAP);
      return `VWAP: ${safe(vwap, 2)}`;
    }
    default:
      return `${name}: ${JSON.stringify(data)}`;
  }
}
