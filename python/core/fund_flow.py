"""
资金流向数据处理模块

从 AKShare 客户端拉取个股/大盘/板块资金流向数据，转成 JSON 友好结构。
列名归一化已在 akshare_client 层完成，这里只做取数量裁剪和 NaN → None 转换。
"""

import sys
import pandas as pd
from utils.akshare_client import (
    get_individual_fund_flow,
    get_market_fund_flow,
    get_sector_fund_flow_rank,
)


def _log(msg: str):
    print(f"[fund_flow] {msg}", file=sys.stderr, flush=True)


def _safe_num(val):
    """NaN/None 安全转 float，其余保留原值"""
    if val is None:
        return None
    if isinstance(val, (int, float)) and pd.isna(val):
        return None
    return val


def _row_to_dict(row: pd.Series, columns: list[str]) -> dict:
    return {col: _safe_num(row.get(col)) for col in columns if col in row.index}


def get_individual_fund_flow_series(stock: str, market: str, days: int = 100) -> dict:
    """
    获取个股资金流向近 N 日序列。

    Args:
        stock: 股票代码，如"600519"
        market: 市场枚举 "sh"|"sz"|"bj"
        days: 返回最近几个交易日（默认100）

    Returns:
        {"stock": "600519", "market": "sh", "count": 100, "data": [
            {"date": "2026-07-01", "close": 1680.0, "change_percent": 1.2,
             "main_net_inflow": 12345678.0, "main_net_pct": 3.1,
             "super_large_net_inflow": ..., "super_large_net_pct": ...,
             "large_net_inflow": ..., "large_net_pct": ...,
             "medium_net_inflow": ..., "medium_net_pct": ...,
             "small_net_inflow": ..., "small_net_pct": ...},
            ...
        ]}
        失败时返回 {"stock": ..., "market": ..., "count": 0, "data": [], "error": "..."}
    """
    _log(f"获取个股资金流向: {market}{stock}, days={days}")

    try:
        df = get_individual_fund_flow(stock, market)
    except Exception as e:
        _log(f"获取个股资金流向失败: {e}")
        return {"stock": stock, "market": market, "count": 0, "data": [], "error": str(e)}

    if df is None or df.empty:
        return {"stock": stock, "market": market, "count": 0, "data": []}

    columns = [
        "date", "close", "change_percent",
        "main_net_inflow", "main_net_pct",
        "super_large_net_inflow", "super_large_net_pct",
        "large_net_inflow", "large_net_pct",
        "medium_net_inflow", "medium_net_pct",
        "small_net_inflow", "small_net_pct",
    ]
    df_recent = df.tail(days)
    data = [_row_to_dict(row, columns) for _, row in df_recent.iterrows()]

    return {"stock": stock, "market": market, "count": len(data), "data": data}


def get_market_fund_flow_series(days: int = 100) -> dict:
    """
    获取大盘（沪深两市）资金流向近 N 日序列。

    Args:
        days: 返回最近几个交易日（默认100）

    Returns:
        {"count": 100, "data": [
            {"date": "2026-07-01", "sh_close": ..., "sh_change_percent": ...,
             "sz_close": ..., "sz_change_percent": ...,
             "main_net_inflow": ..., "main_net_pct": ..., ...},
            ...
        ]}
        失败时返回 {"count": 0, "data": [], "error": "..."}
    """
    _log(f"获取大盘资金流向: days={days}")

    try:
        df = get_market_fund_flow()
    except Exception as e:
        _log(f"获取大盘资金流向失败: {e}")
        return {"count": 0, "data": [], "error": str(e)}

    if df is None or df.empty:
        return {"count": 0, "data": []}

    columns = [
        "date", "sh_close", "sh_change_percent", "sz_close", "sz_change_percent",
        "main_net_inflow", "main_net_pct",
        "super_large_net_inflow", "super_large_net_pct",
        "large_net_inflow", "large_net_pct",
        "medium_net_inflow", "medium_net_pct",
        "small_net_inflow", "small_net_pct",
    ]
    df_recent = df.tail(days)
    data = [_row_to_dict(row, columns) for _, row in df_recent.iterrows()]

    return {"count": len(data), "data": data}


def get_sector_fund_flow_rank_data(indicator: str, sector_type: str, limit: int = 50) -> dict:
    """
    获取板块资金流向排名。

    Args:
        indicator: 统计口径，枚举 "今日"|"5日"|"10日"
        sector_type: 板块类型，枚举 "行业资金流"|"概念资金流"|"地域资金流"
        limit: 返回条数上限（默认50）

    Returns:
        {"indicator": "今日", "sector_type": "行业资金流", "total": 90, "returned": 50, "data": [
            {"rank": 1, "name": "半导体", "change_percent": 2.3,
             "main_net_inflow": ..., "main_net_pct": ..., ...,
             "main_net_inflow_top_stock": "某某股份"},
            ...
        ]}
        失败时返回 {"indicator": ..., "sector_type": ..., "total": 0, "returned": 0, "data": [], "error": "..."}
    """
    _log(f"获取板块资金流排名: indicator={indicator}, sector_type={sector_type}, limit={limit}")

    try:
        df = get_sector_fund_flow_rank(indicator, sector_type)
    except Exception as e:
        _log(f"获取板块资金流排名失败: {e}")
        return {
            "indicator": indicator, "sector_type": sector_type,
            "total": 0, "returned": 0, "data": [], "error": str(e),
        }

    if df is None or df.empty:
        return {"indicator": indicator, "sector_type": sector_type, "total": 0, "returned": 0, "data": []}

    columns = [
        "rank", "name", "change_percent",
        "main_net_inflow", "main_net_pct",
        "super_large_net_inflow", "super_large_net_pct",
        "large_net_inflow", "large_net_pct",
        "medium_net_inflow", "medium_net_pct",
        "small_net_inflow", "small_net_pct",
        "main_net_inflow_top_stock",
    ]
    total = len(df)
    df_top = df.head(limit)
    data = [_row_to_dict(row, columns) for _, row in df_top.iterrows()]

    return {
        "indicator": indicator, "sector_type": sector_type,
        "total": total, "returned": len(data), "data": data,
    }
