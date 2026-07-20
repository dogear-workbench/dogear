/**
 * 财报缓存服务
 *
 * 存储路径：.dogear/stocks/financials/{market}.{code}.jsonl
 * JSONL 格式：每行一个 CachedFinancialsPeriod JSON。
 *
 * 缓存策略：按 reportPeriod（如 "2025Q4"）缓存，同一期永远命中，无需过期。
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { safeFileWrite } from '../safe-json.js';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/** 缓存的单期财报（Python 返回的一个 period dict + 缓存元数据） */
export interface CachedFinancialsPeriod {
  /** 报告日期，如 "2025-12-31" */
  reportDate: string;
  /** 派生报告期 key，如 "2025Q4" */
  reportPeriod: string;
  /** 写入缓存时间（ISO） */
  fetchedAt: string;
  /** 原始 period 字典 */
  data: Record<string, number | string | null>;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取配置目录。
 * - 开发阶段：<项目根目录>/.dogear
 * - 打包发布后：AppData/Roaming/Dogear/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 获取指定股票的财报缓存 JSONL 文件路径 */
function getFinancialsCachePath(market: number, code: string): string {
  return path.join(getConfigDir(), 'stocks', 'financials', `${market}.${code}.jsonl`);
}

/** 解析 JSONL 文本为 CachedFinancialsPeriod 数组，跳过空行/解析失败行 */
function parseJsonl(content: string): CachedFinancialsPeriod[] {
  const results: CachedFinancialsPeriod[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed) as CachedFinancialsPeriod;
      if (entry.reportPeriod) results.push(entry);
    } catch {
      // 跳过无法解析的行
    }
  }

  return results;
}

/**
 * 从 report_date 字符串派生 reportPeriod key。
 * "2025-03-31" → "2025Q1"，"2025-06-30" → "2025Q2"，
 * "2025-09-30" → "2025Q3"，"2025-12-31" → "2025Q4"。
 * 其他日期原样返回（防御异常）。
 */
export function deriveReportPeriod(reportDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate);
  if (!match) return reportDate;

  const [, year, month, day] = match;
  const monthDay = `${month}-${day}`;
  const quarterMap: Record<string, string> = {
    '03-31': 'Q1',
    '06-30': 'Q2',
    '09-30': 'Q3',
    '12-31': 'Q4',
  };

  const quarter = quarterMap[monthDay];
  return quarter ? `${year}${quarter}` : reportDate;
}

// ============================================================
// 读写缓存
// ============================================================

/**
 * 读取财报缓存。
 *
 * @param market 市场代码（1=沪 0=深）
 * @param code 股票代码
 * @param wantPeriods 期望的期数
 * @returns hit：按 reportDate 倒序取到的前 wantPeriods 条（不足则返回已有的全部）；
 *          missingCount：还缺多少期（0 表示全部命中）
 */
export async function readFinancialsCache(
  market: number,
  code: string,
  wantPeriods: number
): Promise<{ hit: CachedFinancialsPeriod[]; missingCount: number }> {
  const filePath = getFinancialsCachePath(market, code);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const all = parseJsonl(content);
    all.sort((a, b) => b.reportDate.localeCompare(a.reportDate));

    const hit = all.slice(0, wantPeriods);
    const missingCount = Math.max(0, wantPeriods - hit.length);
    return { hit, missingCount };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { hit: [], missingCount: wantPeriods };
    }
    console.warn('[FinancialsCache] 读缓存失败，当作未命中:', err);
    return { hit: [], missingCount: wantPeriods };
  }
}

/**
 * 写入财报缓存：与已有数据按 reportPeriod 去重合并（同一期以新数据覆盖旧数据），整体覆盖写盘。
 *
 * @param market 市场代码（1=沪 0=深）
 * @param code 股票代码
 * @param periods Python 返回的原始 period 字典数组（需含 report_date 字段）
 */
export async function writeFinancialsCache(
  market: number,
  code: string,
  periods: Array<Record<string, number | string | null>>
): Promise<void> {
  const filePath = getFinancialsCachePath(market, code);

  try {
    const existing = await fs.readFile(filePath, 'utf-8').then(parseJsonl).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    });

    const merged = new Map<string, CachedFinancialsPeriod>();
    for (const entry of existing) {
      merged.set(entry.reportPeriod, entry);
    }

    const fetchedAt = new Date().toISOString();
    for (const data of periods) {
      const reportDate = String(data.report_date ?? '');
      if (!reportDate) continue;
      const reportPeriod = deriveReportPeriod(reportDate);
      merged.set(reportPeriod, { reportDate, reportPeriod, fetchedAt, data });
    }

    const result = Array.from(merged.values()).sort((a, b) => b.reportDate.localeCompare(a.reportDate));
    const jsonlContent = result.map((entry) => JSON.stringify(entry)).join('\n') + (result.length ? '\n' : '');

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await safeFileWrite(filePath, jsonlContent);
  } catch (err) {
    console.warn('[FinancialsCache] 写缓存失败，不影响本次返回:', err);
  }
}
