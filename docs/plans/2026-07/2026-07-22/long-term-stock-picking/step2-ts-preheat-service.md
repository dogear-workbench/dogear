---
step: 2
title: TS 预热编排服务
status: pending
---

## 目标

在 TS 层新建 `long-term-preheat-service.ts`，实现 `preheatLongTermPool(conditions, options)` 主入口。负责：硬筛 → 稳定排序截断 → 可获取性预检 → 5 年财报拉取（调 Step 1 的 Python 方法）→ 250 期周 K 拉取 → K 线派生指标计算 → 聚合返回。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：Step 1 落地了 Python `long_term_financials` JSON-RPC 方法，接收 `{ symbol }`，返回 `{ symbol, annual_reports, roe_mean_5y, net_profit_cagr_5y, revenue_cagr_5y, roe_cv_5y, net_profit_decline_years, report_years_available, growth_downgrade, error? }`（具体签名以 Step 1 回填的接力棒为准）
- **当前关键文件状态**：
  - `electron/main/services/stock/preheat-service.ts` 是旧的短期视角实现，可参照它的结构（硬筛 + 分批并发 + status 汇总）但**不复用它的输出结构**（字段完全变了）
  - `electron/main/services/stock/python-bridge.ts` 已有 `pythonBridge.call(method, params, timeoutMs)` 通用调用入口
  - `electron/main/services/stock/stock-service.ts` 的 `getKLine({ secid, period, adjust, limit })` 拉 K 线（period=102 是周 K）
  - `electron/main/services/stock/stock-data-service.ts` 的 `appendKLine(market, code, klineData)` 落 JSONL 缓存
  - `python/core/screener.py` 的 `screen_stocks(conditions, limit)` 硬筛入口（通过 pythonBridge 调用）
- **关键决策回顾**：
  - 财报走 Python 每只单独调（Python 端串行天然限流）
  - K 线走 TS 每批 5 并发（rate-limiter 保护）
  - K 线派生指标（MA26/MA52/trendState/yearPositionPct）在 TS 端算，用纯 JS（简单数学，不引入 danfojs）
  - 硬筛后按 `market * 1e5 + code` 稳定排序（同条件重跑成分一致）
  - 预检并发 10 只只拉 1 期财报
  - `insufficient_years`（<3）归入 B 级剔除

## 计划改动

### 新建 `electron/main/services/stock/long-term-preheat-service.ts`

**入参类型**（参照 design.md「关键接口」段）：
```typescript
interface LongTermPreheatConditions {
  industries: string[];              // 必填 min 1
  excludeNegativePe?: boolean;       // 默认 true
  excludeSt?: boolean;               // 默认 true
}

interface LongTermPreheatOptions {
  limit?: number;                    // 默认 50，最大 100
  wantBatchSize?: number;            // 默认 5
}
```

**返回类型**（严格对齐 plan.md 全局决策的 CandidateData 字段）：
```typescript
interface LongTermCandidateData {
  market: number;
  code: string;
  name: string;
  industry: string;

  // 5 年财报聚合（Step 1 Python 返回，字段名转 camelCase）
  annualReports: Array<{ year: number; roe: number|null; netProfit: number|null; revenue: number|null; netProfitYoY: number|null }>;
  roeMean5y: number | null;
  netProfitCAGR5y: number | null;
  revenueCAGR5y: number | null;
  roeCV5y: number | null;
  netProfitDeclineYears: number;
  reportYearsAvailable: number;
  growthDowngrade: boolean;

  // 周 K 聚合（TS 端算）
  weeklyMA26: number | null;
  weeklyMA52: number | null;
  ma26Slope: 'up' | 'flat' | 'down';
  trendState: 'strong_bull' | 'consolidation' | 'pullback' | 'bear' | 'insufficient';
  klinePeriodsAvailable: number;

  // 年内位置（TS 端算）
  currentPrice: number;
  yearHigh: number;
  yearLow: number;
  yearPositionPct: number;

  failures: Array<'financials' | 'kline'>;
}

interface LongTermPreheatStatus {
  total: number;                    // 硬筛+稳定排序+截断后的数量
  afterPreflight: number;           // 预检剔除后剩余数量
  preflightFailed: number;
  insufficientYears: number;        // <3 年年报被剔除的数量
  klineFailed: number;              // 周 K 拉不到被剔除的数量
  financialsFullYears: number;      // 拿到 5 年年报的数量
  financialsPartialYears: number;   // 拿到 3-4 年年报的数量
  klineSuccess: number;
  snapshotDate: string;             // baostock 快照实际日期
  failuresByCategory: Record<string, number>;
}

interface LongTermPreheatResult {
  ok: true;
  candidates: LongTermCandidateData[];
  status: LongTermPreheatStatus;
  elapsedMs: number;
} | {
  ok: false;
  error: string;                    // A 级中止错误
}
```

**主流程 8 步**（对齐 design.md「数据流」段）：

1. **硬筛**：对每个 industry 调 `pythonBridge.call('screen_stocks', ...)`（复用现有 python screener），合并去重
2. **本地二次过滤**：excludeSt 按名称前缀，excludeNegativePe 按 peTTM > 0
3. **稳定排序 + 截断**：按 `market * 1e5 + code` 数值升序，截断到 `limit`
4. **可获取性预检**：并发 10 只 → 每只调 `pythonBridge.call('get_financials', { symbol: code, periods: 1 })`。返回 error 或 periods=[] 的剔除
5. **5 年财报拉取**：每批 5 只 → 调 `pythonBridge.call('long_term_financials', { symbol: code })`。失败或 `report_years_available < 3` 剔除
6. **周 K 拉取 + 派生指标**：每批 5 只 → 调 `stockService.getKLine({ secid, period: 102, adjust: 1, limit: 250 })`。计算 MA26 / MA52 / trendState / yearPositionPct（下方公式）。失败或 periods < 100 → trendState='insufficient' 但保留；periods=0 → 剔除
7. **数据完整性检查**：4 维度里 (roeMean / cagr / trend / stability) 有至少 3 个是 null → 剔除
8. **汇总 status + 返回**

**周 K 派生指标公式**（TS 内实现）：

```typescript
// MA 计算：简单移动平均
function calcMA(closes: number[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  const slice = closes.slice(index - period + 1, index + 1);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

// trendState 判定（对齐 design.md 段 3）
function computeTrendState(latestClose, ma26, ma52, ma26Slope):
  if (close > ma26 && ma26 > ma52 && ma26Slope === 'up') return 'strong_bull';
  if (close > ma26 && Math.abs(ma26 - ma52) / ma52 < 0.02) return 'consolidation';
  if (close < ma26 && ma52Slope === 'up') return 'pullback';
  return 'bear';

// ma26Slope 判定：拿最近 4 周 MA26，若上升趋势 (最新 > 3 周前 * 1.005) 为 up
// yearPositionPct = (close - min(low, 250 期)) / (max(high, 250 期) - min(low, 250 期)) * 100
```

**并发工具函数**：复用 preheat-service.ts 里的 `processBatches` 模式，可以直接抄一份。

### 修改 `electron/main/services/stock/python-bridge.ts`

如果 Step 1 需要新增 `long_term_financials` 的 TypeScript 类型定义（比如 pythonBridge 有类型化的 method map），一并加。否则 `pythonBridge.call<T>(method, params, timeout)` 通用即可。

## 手工验证

Step 2 完成后临时写一个测试脚本或 tipc handler 触发调用：

```typescript
const result = await preheatLongTermPool({
  industries: ['C39计算机、通信和其他电子设备制造业'],
}, { limit: 20 });
console.log(JSON.stringify(result, null, 2));
```

期望：
- `status.total` = 20 左右（硬筛+稳定序取前 20）
- `status.afterPreflight` >= 10（大部分应能通过预检）
- 候选池里能看到 `roeMean5y` / `netProfitCAGR5y` / `weeklyMA26` / `yearPositionPct` 等字段
- 耗时 60-90 秒（20 只规模）

## 实施回填（做完后填）

### 实际改动
（与计划的差异、K 线接口的坑、并发调优等）

### 改动文件清单
（`long-term-preheat-service.ts` / 可能修改的 `python-bridge.ts` / 其他）

### 给下一步的接力棒
（Step 3 rank 服务要接收 `LongTermCandidateData[]`，关键字段签名，null 值出现规律等）
