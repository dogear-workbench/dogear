---
step: 1
title: 财报缓存服务 + 改 GetFinancials 走缓存
status: done
---

## 目标

给 GetFinancials 加本地缓存，同一 reportPeriod 永远命中，避免每次真调同花顺（0.5s 单股限流）。缓存命中后 agent 就能任意并行读财报。

## 依赖上下文

**现状**（前置调研结果）：
- 工具位置：`electron/main/agents/tools/stock-analysis-tools.ts:399-450` GetFinancials 工具体
- 底层调用：`pythonBridge.call<{symbol, periods: Array<Record<string, number|string|null>>, error?}>('get_financials', {symbol, periods}, 30_000)`
- 返回结构：`result.periods` 是数组，每期一个字典，字段含 `report_date`（如 `"2025-12-31"`）、`revenue`、`revenue_yoy`、`net_profit`、`net_profit_yoy`、`roe`、`gross_margin`、`debt_ratio`、`eps` 等
- Python 端接口在 `python/core/*.py`（走 AKShare `stock_financial_abstract_new_ths`），本 step 不改 Python

**参考已有实现**：
- `electron/main/services/stock/stock-data-service.ts` — K 线 JSONL 增量写的姿势
- `electron/main/services/stock/announcement-service.ts` — index.json + hash 缓存的姿势

## 计划改动

### 新建 `electron/main/services/stock/financials-cache-service.ts`

导出：

```ts
// 缓存的单期财报（就是 Python 返回的一个 period dict + 额外元数据）
interface CachedFinancialsPeriod {
  reportDate: string;              // 如 "2025-12-31"
  reportPeriod: string;            // 派生 key 如 "2025Q4"（Q1=03-31 / Q2=06-30 / Q3=09-30 / Q4=12-31）
  fetchedAt: string;               // ISO 时间
  data: Record<string, number | string | null>;  // 原始 period dict
}

/** 读缓存：返回按 reportDate 倒序的 N 期，缺失部分返回空数组给调用方去补拉 */
export async function readFinancialsCache(
  market: number,
  code: string,
  wantPeriods: number
): Promise<{ hit: CachedFinancialsPeriod[]; missingCount: number }>

/** 写缓存：把新拉到的 periods 追加/合并到 JSONL，去重按 reportPeriod */
export async function writeFinancialsCache(
  market: number,
  code: string,
  periods: Array<Record<string, number | string | null>>
): Promise<void>

/** 从 report_date 字符串派生 reportPeriod key */
export function deriveReportPeriod(reportDate: string): string
```

**存储路径**：`{configDir}/stocks/financials/{market}.{code}.jsonl`（每行一个 CachedFinancialsPeriod JSON）

**命中/合并逻辑**：
1. 读文件所有行，parse 成 CachedFinancialsPeriod[]
2. 按 reportDate 倒序取前 wantPeriods 条
3. 如果条数 >= wantPeriods，全部命中；否则返回已有的 + missingCount
4. 写入时按 reportPeriod 去重（同一期以新数据覆盖旧数据）

**报告期派生规则**：
- `2025-03-31` → `2025Q1`
- `2025-06-30` → `2025Q2`
- `2025-09-30` → `2025Q3`
- `2025-12-31` → `2025Q4`
- 其他日期 → `{YYYY}-{MM}-{DD}`（原样，防御异常）

### 改 `electron/main/agents/tools/stock-analysis-tools.ts`

在 GetFinancials 工具的 handler 里（`stock-analysis-tools.ts:410` 开始的 `async (args) => {...}`）加缓存层：

1. **先查缓存**：调 `readFinancialsCache(market, code, periods)`
2. **全部命中**：直接把 hit 数组转换成原格式返回（不调 Python）
3. **部分命中或未命中**：调 Python 拉全量 N 期 → 写缓存（`writeFinancialsCache`）→ 返回
4. 缓存读/写失败不阻断流程，打日志走原逻辑

**关键**：Python 返回的 `periods` 是完整 N 期，不做增量拉取（AKShare 接口本身就是拿全量的近 N 期），所以简化为"全命中则跳过 Python，否则全量调 Python"。

### 手动验证

- 第一次调 GetFinancials(0, "000682", 3) → 走 Python，看到缓存文件生成
- 第二次调 GetFinancials(0, "000682", 3) → 命中缓存，Python 不被调用（看日志确认）
- 调 GetFinancials(0, "000682", 5) → 缺 2 期，走 Python 全量拉，合并写缓存
- 手动删掉缓存文件 → 下次调恢复原行为

## 实施回填

### 实际改动

- **与计划差异**：无实质差异。`writeFinancialsCache` 用「读全量 → Map 按 reportPeriod 去重合并 → 排序整体覆盖写盘」的姿势（用 `safeFileWrite`），而非纯 append——目的是保证同一文件里 reportPeriod 唯一有序，功能与计划一致。
- **改动文件清单**：
  - 新增 `electron/main/services/stock/financials-cache-service.ts`
  - 修改 `electron/main/agents/tools/stock-analysis-tools.ts`（顶部 import 一行 + GetFinancials handler 内改动 27+ / 15-）

### 给下一步的接力棒

- **新增 API 签名**：
  ```ts
  export function deriveReportPeriod(reportDate: string): string
  export async function readFinancialsCache(market, code, wantPeriods): Promise<{ hit: CachedFinancialsPeriod[]; missingCount: number }>
  export async function writeFinancialsCache(market, code, periods): Promise<void>
  export interface CachedFinancialsPeriod { reportDate; reportPeriod; fetchedAt; data }
  ```
- **缓存目录**：`{configDir}/stocks/financials/{market}.{code}.jsonl`，getConfigDir 采用与 stock-data-service 相同的姿势（app.isPackaged 分支到 userData）。
- **已知边界/限制**：
  - `writeFinancialsCache` 内部会读现有文件 → merge → 覆盖写，若同时并发写同一股票可能相互覆盖（本项目 agent 调用是串行的，暂不加锁）。
  - 缓存不做 TTL：一旦缓存了某个 reportPeriod 就永久有效，除非手动删文件。若上游数据更正需要手动清缓存。
  - lint / build:electron 均通过。手测（真实调 Python 观察缓存命中/未命中/删缓存回退）主会话后续在 Step 3 联动时一起做。
