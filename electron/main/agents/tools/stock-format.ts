/**
 * 股票工具共享格式化助手（stock-tools 与 stock-analysis-tools 共用）
 */

/** 安全数字格式化（防止 undefined.toFixed 崩溃） */
export function safe(val: number | undefined | null, digits = 2): string {
  if (val == null || isNaN(val)) return '-';
  return val.toFixed(digits);
}
