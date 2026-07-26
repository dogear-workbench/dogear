"""
财报数据获取模块

通过 AKShare 获取个股财务数据，格式化后返回。
"""

import sys
import pandas as pd
from utils.akshare_client import get_financial_abstract
from utils.baostock_client import get_financial_series, get_industry_map, BaostockError
from core.snapshot import get_industry_snapshot


def _log(msg: str):
    print(f"[financials] {msg}", file=sys.stderr, flush=True)


def _safe_float(val) -> float | None:
    """安全转换数值，支持中文单位（亿/万）和百分号"""
    if val is None or val is False:
        return None
    if isinstance(val, (int, float)):
        if pd.isna(val):
            return None
        return float(val)
    s = str(val).strip()
    if not s or s.lower() in ('none', 'false', '-', '--'):
        return None
    # 去除百分号
    if s.endswith('%'):
        try:
            return float(s[:-1])
        except ValueError:
            return None
    # 处理中文单位
    multiplier = 1.0
    if s.endswith('亿'):
        multiplier = 1e8
        s = s[:-1]
    elif s.endswith('万'):
        multiplier = 1e4
        s = s[:-1]
    try:
        return float(s) * multiplier
    except (ValueError, TypeError):
        return None


def _pct(val) -> float | None:
    """baostock 财务比率字段是小数（如 0.1056），转换为百分比数值"""
    f = _safe_float(val)
    return f * 100 if f is not None else None


def _symbol_to_bs_code(symbol: str) -> str:
    """股票代码转 baostock 格式（如 600519 → sh.600519）"""
    if symbol.startswith(('600', '601', '603', '605', '688', '689', '900')):
        return f"sh.{symbol}"
    if symbol.startswith(('000', '001', '002', '003', '300', '301', '200')):
        return f"sz.{symbol}"
    if symbol.startswith(('4', '8', '920')):
        return f"bj.{symbol}"
    raise BaostockError(f"无法识别的股票代码格式: {symbol}", error_type="ApiError")


def _select_or_empty(df: pd.DataFrame | None, cols: list[str]) -> pd.DataFrame:
    """从 df 中取出指定列，缺失的列填 None，df 为空则返回全 None 的空表"""
    if df is None or df.empty:
        return pd.DataFrame(columns=cols)
    sub = pd.DataFrame({c: (df[c] if c in df.columns else None) for c in cols})
    return sub


def _get_financials_from_baostock(symbol: str, periods: int) -> dict:
    """
    通过 baostock 5 个财务接口组合获取财报数据，字段映射回旧同花顺输出的英文键名。

    baostock 字段 → 输出字段：
      profit.MBRevenue → revenue（元，累计口径）
      profit.netProfit → net_profit（元，累计口径）
      profit.roeAvg → roe（×100，累计口径）
      profit.npMargin → net_margin（×100）
      profit.gpMargin → gross_margin（×100）
      profit.epsTTM → eps
      growth.YOYPNI → net_profit_yoy（×100，官方归母净利润同比）
      balance.liabilityToAsset → debt_ratio（×100）
      balance.currentRatio → current_ratio（新增字段，不做单位转换）
      revenue_yoy 用相邻年份同报告期（月/日相同）的 revenue 自算，因 growth 表无营收同比字段

    net_profit_deducted / bvps / operating_cash_flow_per_share：baostock 无对应数据，固定 None
    revenue_mom / revenue_single_yoy / net_profit_mom / net_profit_single_yoy 等 mom/single_yoy 字段：MVP 阶段固定 None
    """
    bs_code = _symbol_to_bs_code(symbol)
    year_range = max(2, (periods // 4) + 1)
    data = get_financial_series(bs_code, year_range=year_range)

    if all(df is None or df.empty for df in data.values()):
        raise BaostockError(f"baostock 财务数据为空: {symbol}", error_type="EmptyResult")

    profit_cols = ['statDate', 'roeAvg', 'npMargin', 'gpMargin', 'netProfit', 'epsTTM', 'MBRevenue']
    growth_cols = ['statDate', 'YOYPNI']
    balance_cols = ['statDate', 'liabilityToAsset', 'currentRatio']

    profit_sub = _select_or_empty(data.get('profit'), profit_cols)
    growth_sub = _select_or_empty(data.get('growth'), growth_cols)
    balance_sub = _select_or_empty(data.get('balance'), balance_cols)

    merged = profit_sub.merge(growth_sub, on='statDate', how='outer').merge(balance_sub, on='statDate', how='outer')
    merged = merged[merged['statDate'].notna() & (merged['statDate'] != '')]

    if merged.empty:
        raise BaostockError(f"baostock 财务数据无法解析: {symbol}", error_type="EmptyResult")

    merged = merged.sort_values('statDate').reset_index(drop=True)

    revenue_by_date = {row['statDate']: _safe_float(row['MBRevenue']) for _, row in merged.iterrows()}

    def _prev_year_date(stat_date: str) -> str | None:
        try:
            y, m, d = stat_date.split('-')
            return f"{int(y) - 1}-{m}-{d}"
        except (ValueError, AttributeError):
            return None

    all_periods = []
    for _, row in merged.iterrows():
        stat_date = row['statDate']
        revenue = _safe_float(row.get('MBRevenue'))
        prev_revenue = revenue_by_date.get(_prev_year_date(stat_date))
        revenue_yoy = (
            round((revenue - prev_revenue) / prev_revenue * 100, 4)
            if revenue is not None and prev_revenue not in (None, 0)
            else None
        )

        all_periods.append({
            "report_date": stat_date,
            "revenue": revenue,
            "revenue_yoy": revenue_yoy,
            "revenue_mom": None,
            "revenue_single_yoy": None,
            "net_profit": _safe_float(row.get('netProfit')),
            "net_profit_yoy": _pct(row.get('YOYPNI')),
            "net_profit_mom": None,
            "net_profit_single_yoy": None,
            "net_profit_deducted": None,
            "net_profit_deducted_yoy": None,
            "eps": _safe_float(row.get('epsTTM')),
            "eps_yoy": None,
            "bvps": None,
            "roe": _pct(row.get('roeAvg')),
            "roe_yoy": None,
            "roe_diluted": None,
            "roe_diluted_yoy": None,
            "gross_margin": _pct(row.get('gpMargin')),
            "gross_margin_yoy": None,
            "net_margin": _pct(row.get('npMargin')),
            "net_margin_yoy": None,
            "debt_ratio": _pct(row.get('liabilityToAsset')),
            "debt_ratio_yoy": None,
            "current_ratio": _safe_float(row.get('currentRatio')),
            "operating_cash_flow_per_share": None,
            "operating_cash_flow_per_share_yoy": None,
        })

    result_periods = list(reversed(all_periods))[:periods]

    if not result_periods:
        raise BaostockError(f"baostock 财务数据解析后为空: {symbol}", error_type="EmptyResult")

    return {"symbol": symbol, "periods": result_periods, "_source": "baostock"}


def _get_financials_from_ths(symbol: str, periods: int) -> dict:
    """
    同花顺财报摘要（主源）。相比 baostock 的优势：一季报/三季报的营收有值、
    资产负债率数量级一致、bvps/每股经营现金流/各项 yoy 齐全。
    """
    df = get_financial_abstract(symbol)

    if df is None or df.empty:
        raise ValueError(f"同花顺财报数据为空: {symbol}")

    # 列名来自 akshare_client.get_financial_abstract 归一化后的宽表
    # （stock_financial_abstract_new_ths 升级版，每个指标额外带 _yoy/_mom/_single_yoy 衍生列）
    column_map = {
        '报告期': 'report_date',
        '营业总收入': 'revenue',
        '营业总收入_yoy': 'revenue_yoy',
        '营业总收入_mom': 'revenue_mom',
        '营业总收入_single_yoy': 'revenue_single_yoy',
        '归属净利润': 'net_profit',
        '归属净利润_yoy': 'net_profit_yoy',
        '归属净利润_mom': 'net_profit_mom',
        '归属净利润_single_yoy': 'net_profit_single_yoy',
        '扣非净利润': 'net_profit_deducted',
        '扣非净利润_yoy': 'net_profit_deducted_yoy',
        '基本每股收益': 'eps',
        '基本每股收益_yoy': 'eps_yoy',
        '每股净资产': 'bvps',
        '净资产收益率': 'roe',
        '净资产收益率_yoy': 'roe_yoy',
        '净资产收益率-摊薄': 'roe_diluted',
        '净资产收益率-摊薄_yoy': 'roe_diluted_yoy',
        '销售毛利率': 'gross_margin',
        '销售毛利率_yoy': 'gross_margin_yoy',
        '销售净利率': 'net_margin',
        '销售净利率_yoy': 'net_margin_yoy',
        '资产负债率': 'debt_ratio',
        '资产负债率_yoy': 'debt_ratio_yoy',
        '每股经营现金流': 'operating_cash_flow_per_share',
        '每股经营现金流_yoy': 'operating_cash_flow_per_share_yoy',
    }

    # 取最近 N 期（数据按时间正序排列，tail 取最新，倒序使最新在前）
    df_recent = df.tail(periods).iloc[::-1]

    result_periods = []
    for _, row in df_recent.iterrows():
        period_data = {}
        for cn_name, en_name in column_map.items():
            if cn_name in df.columns:
                val = row.get(cn_name)
                if en_name == 'report_date':
                    period_data[en_name] = str(val) if val is not None else None
                else:
                    period_data[en_name] = _safe_float(val)

        result_periods.append(period_data)

    return {"symbol": symbol, "periods": result_periods, "_source": "ths"}


def get_financials(symbol: str, periods: int = 4) -> dict:
    """
    获取个股财报摘要数据。同花顺为主源，baostock 兜底。

    Args:
        symbol: 股票代码（如"600519"）
        periods: 返回的报告期数（默认4期）

    Returns:
        {
            "symbol": "600519",
            "periods": [
                {
                    "report_date": "2025-12-31",
                    "revenue": 150560000000,
                    "revenue_yoy": 15.2,
                    "revenue_mom": 3.4,
                    "net_profit": 74730000000,
                    "net_profit_yoy": 12.8,
                    "roe": 32.5,
                    "gross_margin": 91.8,
                    "debt_ratio": 25.3,
                    "eps": 59.53,
                    "bvps": 183.2,
                },
                ...
            ]
        }
    """
    _log(f"获取财报: {symbol}, 期数={periods}")

    try:
        result = _get_financials_from_ths(symbol, periods)
        if result["periods"]:
            return result
        _log("同花顺财报解析后为空，降级到 baostock")
    except Exception as e:
        _log(f"同花顺财报获取失败: {e}，降级到 baostock")

    try:
        return _get_financials_from_baostock(symbol, periods)
    except BaostockError as e:
        _log(f"baostock 财务数据获取失败({e.error_type}): {e}")
        return {
            "symbol": symbol,
            "periods": [],
            "error": f"同花顺与 baostock 均无法获取财报: {e}",
            "error_type": e.error_type,
        }


# 对比指标 → (快照列名, 展示标签, 是否只统计正值)
# 只统计正值：PE/PB 为负代表亏损或资不抵债，计入均值会污染行业估值水平
_COMPARE_METRICS = {
    "pe": ("peTTM", "PE(TTM)", True),
    "pb": ("pbMRQ", "PB(MRQ)", True),
    "turnover_rate": ("turn", "换手率(%)", False),
    "change_percent": ("pctChg", "涨跌幅(%)", False),
}

# baostock 快照无股本数据（snapshot._add_derived_fields 固定 NaN），市值类指标无法计算
_UNSUPPORTED_COMPARE_METRICS = {
    "market_cap": "baostock 快照无股本数据，总市值不可用",
    "float_market_cap": "baostock 快照无股本数据，流通市值不可用",
}


def _compare_one_metric(snap: pd.DataFrame, bs_code: str, metric: str) -> dict:
    """计算单个指标的行业统计。rank 为升序位次（1 = 行业内最低）。"""
    if metric in _UNSUPPORTED_COMPARE_METRICS:
        return {"error": _UNSUPPORTED_COMPARE_METRICS[metric]}

    mapping = _COMPARE_METRICS.get(metric)
    if not mapping:
        return {"error": f"不支持的指标 '{metric}'，可选: {'/'.join(_COMPARE_METRICS)}"}

    col, _label, positive_only = mapping
    if col not in snap.columns:
        return {"error": f"行业快照缺少 {col} 列"}

    series = pd.to_numeric(snap[col], errors="coerce")
    my_row = series[snap["code"] == bs_code]
    my_value = float(my_row.iloc[0]) if not my_row.empty and pd.notna(my_row.iloc[0]) else None

    valid = series.dropna()
    if positive_only:
        valid = valid[valid > 0]

    if valid.empty:
        return {
            "value": my_value,
            "industry_avg": None,
            "industry_median": None,
            "rank": 0,
            "total": 0,
            "error": "行业内无有效样本",
        }

    rank = 0
    if my_value is not None and (not positive_only or my_value > 0):
        rank = int((valid < my_value).sum()) + 1

    return {
        "value": round(my_value, 4) if my_value is not None else None,
        "industry_avg": round(float(valid.mean()), 4),
        "industry_median": round(float(valid.median()), 4),
        "rank": rank,
        "total": int(valid.size),
    }


def compare_industry(symbol: str, metrics: list[str] = None) -> dict:
    """
    将个股与同行业其他股票对比。

    数据源：baostock 行业快照（snapshot.get_industry_snapshot），与 ScreenStocks 同口径。
    原雪球接口（stock_individual_basic_info_xq / stock_individual_spot_xq）已失效，不再使用。

    Args:
        symbol: 股票代码
        metrics: 对比指标，默认 ["pe", "pb", "turnover_rate"]

    Returns:
        {
            "symbol": "600519",
            "name": "贵州茅台",
            "industry": "C15酒、饮料和精制茶制造业",
            "industry_count": 43,
            "metrics": {
                "pe": {"value": 28.5, "industry_avg": 35.2, "industry_median": 30.1,
                       "rank": 8, "total": 40},
                ...
            }
        }
    """
    if metrics is None:
        metrics = ["pe", "pb", "turnover_rate"]

    _log(f"行业对比: {symbol}, 指标={metrics}")

    try:
        bs_code = _symbol_to_bs_code(symbol)
    except BaostockError as e:
        return {"symbol": symbol, "error": str(e)}

    try:
        industry_map = get_industry_map()
    except Exception as e:
        _log(f"获取行业映射失败: {e}")
        return {"symbol": symbol, "error": f"获取行业映射失败: {e}"}

    row = industry_map[industry_map["code"] == bs_code]
    if row.empty:
        return {"symbol": symbol, "error": f"{symbol} 不在 baostock 行业映射表中"}

    stock_name = str(row.iloc[0].get("code_name") or symbol)
    industry = str(row.iloc[0].get("industry") or "").strip()
    if not industry:
        return {"symbol": symbol, "name": stock_name, "error": "该股票无行业分类信息"}

    try:
        snap = get_industry_snapshot(industry)
    except Exception as e:
        _log(f"获取行业快照失败: {e}")
        return {
            "symbol": symbol,
            "name": stock_name,
            "industry": industry,
            "error": f"获取行业快照失败: {e}",
        }

    return {
        "symbol": symbol,
        "name": stock_name,
        "industry": industry,
        "industry_count": int(len(snap)),
        "metrics": {m: _compare_one_metric(snap, bs_code, m) for m in metrics},
    }
