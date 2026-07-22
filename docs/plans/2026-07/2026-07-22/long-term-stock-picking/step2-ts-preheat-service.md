---
step: 2
title: TS 预热编排服务
status: done
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

## 实施回填

### 实际改动
- 主流程 8 步完全按计划实现，无偏差。
- 拆出 3 个文件（types / kline-indicators / preheat-service）避免主入口膨胀；主 service 369 行。
- 未修改 python-bridge.ts（`call<T>` 通用调用够用，无需类型化 method map）。
- 未修改 stock-data-service：周 K 与日 K 共用同一 JSONL 文件名，跳过 appendKLine 只依赖 rate-limiter 60s 内存缓存，避免混合粒度污染缓存。
- `snapshotDate` 暂用当天日期作代理（baostock 快照无独立日期接口），未来需精确可让 Python 侧 `screen_stocks` 返回值加 `snapshot_date` 字段。
- `checkIntegrity` 把 `trendState='insufficient'` 视作 trend 维度 null 语义参与"≥3 个 null 剔除"判定，跟设计意图一致。
- 未做真实数据验证（不新建 tipc handler，Step 4 才做），`bun run build:electron` 通过是主要质量门。

### 改动文件清单
- 新增 `electron/main/services/stock/long-term-types.ts` (70 行) — 公共类型
- 新增 `electron/main/services/stock/long-term-kline-indicators.ts` (103 行) — 纯计算 helper
- 新增 `electron/main/services/stock/long-term-preheat-service.ts` (369 行) — `preheatLongTermPool` 主入口

### 给下一步的接力棒
- **导入方式**：`import type { LongTermCandidateData, LongTermPreheatStatus } from '../services/stock/long-term-types.js'`
- **字段 null 概率估计**（Step 3 排 rank 时的 D 级归零判断依据）：
  - `roeMean5y` / `netProfitCAGR5y` / `revenueCAGR5y` / `weeklyMA26` / `weeklyMA52`：低（<15%）
  - `roeCV5y`：中（20-30%，需 ≥3 年有效 ROE）
  - `trendState='insufficient'`：中（10-20%，新股/次新股/复牌不足 100 期）
  - `currentPrice/yearHigh/yearLow/yearPositionPct`：极低（只要有 1 条 K 线就有值）
- **Step 3 应重点处理**：
  - D 级：某维度全池 null → 权重设 0，其余按比例重分配，返回 `weightsApplied` 透传
  - `growthDowngrade=true` 的候选：`netProfitCAGR5y` 实为"5 年净利同比均值"，语义不同，排 rank 时可在返回表加标注
  - `trendState='insufficient'` 时：yearPositionPct 仍有效，可作为 trend 维度部分分而不是直接归零
- **数据量级**：50 只候选进去，实际剩余约 25-40 只，`top` 默认 15 合理
- **遗留问题**：
  - `insufficientYears` 独立计数，不并入 `failuresByCategory['financials']`（两种失败原因分开展示），Step 4 工具 description 里应说清楚
  - `snapshotDate` 精度问题（见上）
