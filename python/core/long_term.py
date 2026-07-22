"""
长期财报指标计算：接收 get_financials 返回的 periods 数组，聚合出 5 年年报指标。
"""

import math
import statistics
import sys


def _log(msg: str):
    print(f"[long_term] {msg}", file=sys.stderr, flush=True)


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _cagr(start: float, end: float, years: int) -> float | None:
    """计算 CAGR（百分比）。start ≤ 0 时返回 None（CAGR 公式失效）。"""
    if years < 2 or start is None or end is None:
        return None
    if start <= 0:
        return None
    try:
        return (math.pow(end / start, 1.0 / (years - 1)) - 1) * 100
    except (ZeroDivisionError, ValueError):
        return None


def compute_long_term_financials(periods: list[dict]) -> dict:
    """
    从 get_financials 的 periods 数组中聚合 5 年长期财报指标。

    periods: 按 report_date 降序排列（get_financials 默认行为）

    return:
      {
        annual_reports: list[{ year, roe, net_profit, revenue, net_profit_yoy }],  # ≤5年，降序
        roe_mean_5y: float | None,
        net_profit_cagr_5y: float | None,   # 百分比；5年前净利≤0时为None
        revenue_cagr_5y: float | None,      # 百分比
        roe_cv_5y: float | None,            # std/mean，数据<3或mean=0时None
        net_profit_decline_years: int,      # 近5年净利同比<0的年数
        report_years_available: int,        # 实际年报数（1-5）
        growth_downgrade: bool,             # True=net_profit_cagr_5y因首年≤0降级为同比均值
      }
    """
    # 筛年报（-12-31）并取前5年（降序）
    annual = [
        p for p in periods
        if isinstance(p.get("report_date"), str) and p["report_date"].endswith("-12-31")
    ]
    annual = annual[:5]

    annual_reports = []
    for p in annual:
        year = int(p["report_date"][:4])
        annual_reports.append({
            "year": year,
            "roe": _safe_float(p.get("roe")),
            "net_profit": _safe_float(p.get("net_profit")),
            "revenue": _safe_float(p.get("revenue")),
            "net_profit_yoy": _safe_float(p.get("net_profit_yoy")),
        })

    n = len(annual_reports)

    # ROE 均值（跳过 None）
    roe_vals = [r["roe"] for r in annual_reports if r["roe"] is not None]
    roe_mean_5y = statistics.mean(roe_vals) if roe_vals else None

    # ROE 变异系数（需 ≥3 个值且均值 ≠ 0）
    roe_cv_5y = None
    if len(roe_vals) >= 3:
        mean_roe = statistics.mean(roe_vals)
        if mean_roe != 0:
            roe_cv_5y = statistics.pstdev(roe_vals) / abs(mean_roe)

    # 净利润 CAGR
    growth_downgrade = False
    net_profit_cagr_5y = None
    if n >= 2:
        newest_np = annual_reports[0]["net_profit"]
        oldest_np = annual_reports[-1]["net_profit"]
        cagr = _cagr(oldest_np, newest_np, n)
        if cagr is not None:
            net_profit_cagr_5y = cagr
        else:
            # 首年净利 ≤ 0，降级为同比均值
            growth_downgrade = True
            yoy_vals = [r["net_profit_yoy"] for r in annual_reports if r["net_profit_yoy"] is not None]
            net_profit_cagr_5y = statistics.mean(yoy_vals) if yoy_vals else None

    # 营收 CAGR（营收很少为负，同样做兜底）
    revenue_cagr_5y = None
    if n >= 2:
        newest_rev = annual_reports[0]["revenue"]
        oldest_rev = annual_reports[-1]["revenue"]
        revenue_cagr_5y = _cagr(oldest_rev, newest_rev, n)

    # 净利润下滑年数（同比 < 0）
    net_profit_decline_years = sum(
        1 for r in annual_reports
        if r["net_profit_yoy"] is not None and r["net_profit_yoy"] < 0
    )

    return {
        "annual_reports": annual_reports,
        "roe_mean_5y": roe_mean_5y,
        "net_profit_cagr_5y": net_profit_cagr_5y,
        "revenue_cagr_5y": revenue_cagr_5y,
        "roe_cv_5y": roe_cv_5y,
        "net_profit_decline_years": net_profit_decline_years,
        "report_years_available": n,
        "growth_downgrade": growth_downgrade,
    }
