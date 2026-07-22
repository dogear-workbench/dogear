---
step: 1
title: Python 长期财报指标计算
status: done
---

## 目标

在 Python 层新增"5 年长期财报指标"计算能力：接收 symbol → 拉近 5 年年报 → 算 CAGR / ROE 均值 / 变异系数 / 下滑年数，一次性返回聚合结果。K 线派生指标由 TS 层负责（跨进程序列化 250 期 K 线成本高），本 step 不涉及。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：无（本 step 是起点）
- **当前关键文件状态**：
  - `python/core/financials.py:178` `get_financials(symbol, periods)` 主入口——主链路 baostock + 兜底同花顺，返回 `{ symbol, periods: [{ report_date, roe, net_profit, net_profit_yoy, revenue, revenue_yoy, ... }], error?, error_type? }`
  - `python/main.py:75-82` 现有 `get_financials` JSON-RPC 方法注册示例（参照它写新方法）
- **关键决策回顾**：
  - Python 只算财报聚合，K 线派生指标由 TS 层做（跨进程序列化 250 期 K 线数据成本高）
  - 至少 3 年年报才算合格，不足 3 年返回 `insufficient_years` 标记让 TS 层剔除
  - 5 年前净利润 ≤ 0 时 CAGR 公式失效，降级为"5 年净利同比均值"（对齐 design.md 段 3 陷阱处理）

## 计划改动

### 新建 `python/core/long_term.py`

暴露一个纯函数：

```python
def compute_long_term_financials(periods: list[dict]) -> dict:
    """
    periods: get_financials 返回的 periods 数组（按 report_date 降序）
    return:
      {
        annual_reports: [{ year, roe, net_profit, revenue, net_profit_yoy }, ...],  # 最多 5 年，按 year 降序
        roe_mean_5y: float | None,
        net_profit_cagr_5y: float | None,      # 百分比，5 年前净利 ≤ 0 时为 None
        revenue_cagr_5y: float | None,          # 百分比
        roe_cv_5y: float | None,                # 变异系数 std/mean（mean=0 时 None）
        net_profit_decline_years: int,          # 近 5 年净利同比 < 0 的年数
        report_years_available: int,            # 实际拿到几年年报（3-5）
        growth_downgrade: bool,                  # True 表示 CAGR 失效已降级为同比均值
      }
    """
```

**核心逻辑**：
1. 从 `periods` 里筛出 `report_date` 以 `-12-31` 结尾的（年报），按年降序取前 5
2. `annual_reports` 直接映射（year 从 report_date 前四位取）
3. `roe_mean_5y` = `mean(annual_reports.roe)`（跳过 null）
4. `net_profit_cagr_5y` = `(最新 / 最早) ^ (1/(年数-1)) - 1`
   - 年数 < 2 → None
   - 最早净利 ≤ 0 → None，同时 `growth_downgrade=True`，用 `mean(annual_reports.net_profit_yoy)` 代替
5. `revenue_cagr_5y` 同上（营收不太会为负，但也做兜底）
6. `roe_cv_5y` = `std(roe) / mean(roe)`；mean=0 或 <3 个值 → None
7. `net_profit_decline_years` = `count(annual_reports.net_profit_yoy < 0)`
8. `report_years_available` = `len(annual_reports)`

### 修改 `python/main.py`

参照现有 `get_financials` 方法（`main.py:75-82`），新增 `long_term_financials` JSON-RPC 方法：

```python
def handle_long_term_financials(params):
    symbol = params.get("symbol")
    if not symbol:
        send_error(...)
        return
    # 内部调 get_financials(symbol, periods=20) 覆盖 5 年 × 4 季度
    fin_result = get_financials(symbol, periods=20)
    if fin_result.get("error"):
        send_response({ "symbol": symbol, "error": fin_result["error"] })
        return
    metrics = compute_long_term_financials(fin_result["periods"])
    send_response({ "symbol": symbol, **metrics })
```

**注意**：
- 内部 `periods=20`（覆盖 5 年 × 4 季度，能筛出 5 个年报期）
- 财报接口失败时返回 `{ symbol, error }`，让 TS 层归入 B 级剔除
- `insufficient_years`（<3）由 TS 层判断（检查 `report_years_available`）

## 手工验证

Step 1 完成后手工跑几只股票，确认字段正确：

```bash
# 启动 Python 守护进程后（bun run dev 会自动启动）
# 用 stdin JSON-RPC 发一次调用
echo '{"jsonrpc":"2.0","method":"long_term_financials","params":{"symbol":"600519"},"id":1}' | python python/main.py
# 或写个临时 test.py 直接调 compute_long_term_financials
```

期望：600519（茅台）能拿到 5 年完整年报，`roe_mean_5y` 大概 30+ %，`net_profit_cagr_5y` 大概 15-20 %，`growth_downgrade=False`，`net_profit_decline_years=0`。

## 实施回填

### 实际改动
- 与计划完全一致，无差异。
- 边界测试全通过（茅台模拟数据 roe_mean_5y≈29.46 / cagr≈10.29% / growth_downgrade=False / net_profit_decline_years=0）。
- 首年净利 ≤ 0 时 CAGR 降级为 `net_profit_yoy` 均值并置 `growth_downgrade=True`；营收 CAGR 无降级路径（营收极少为负）。
- ROE CV 需 ≥3 个非 null 且均值 ≠ 0 才计算；分母取 `abs(mean)` 兜底 ROE 负值。

### 改动文件清单
- 新增 `python/core/long_term.py` (~123 行) — `compute_long_term_financials()`
- 修改 `python/main.py` — 导入 `compute_long_term_financials`；新增 `handle_long_term_financials`；注册 `METHOD_HANDLERS["long_term_financials"]`

### 给下一步的接力棒
- **调用方式**：`python-bridge.call("long_term_financials", { symbol })`
- **snake_case → camelCase 对应**（TS 层做转换）：
  - `annual_reports` → `annualReports`（`net_profit`→`netProfit` / `net_profit_yoy`→`netProfitYoy`）
  - `roe_mean_5y` → `roeMean5y`
  - `net_profit_cagr_5y` → `netProfitCagr5y`
  - `revenue_cagr_5y` → `revenueCagr5y`
  - `roe_cv_5y` → `roeCv5y`
  - `net_profit_decline_years` → `netProfitDeclineYears`
  - `report_years_available` → `reportYearsAvailable`
  - `growth_downgrade` → `growthDowngrade`
- **错误响应**：`{ symbol, error, error_type? }` → TS 层归入 B 级剔除
- **数据不足**：Python 侧不过滤 `report_years_available < 3`，TS 层自己判断
- **超时预算建议**：单只 15s（baostock 连接 2-5s + 拉 20 期财报 1-3s，留冗余）
