"""
北向资金数据处理模块

从 AKShare 客户端拉取个股北向持股 / 沪深港通资金流向历史，转成 JSON 友好结构。
列名归一化已在 akshare_client 层完成，这里只做取数量裁剪和 NaN → None 转换。
"""

import sys
import datetime
import pandas as pd
from utils.akshare_client import get_hsgt_individual, get_hsgt_hist


def _log(msg: str):
    print(f"[hsgt] {msg}", file=sys.stderr, flush=True)


def _safe_num(val):
    """NaN/None 安全转 float，日期对象转 ISO 字符串（北向接口的日期列返回 datetime.date
    而非字符串，与 fund_flow.py 依赖的接口不同，需在此单独处理避免 JSON 序列化失败），
    其余保留原值"""
    if val is None:
        return None
    if isinstance(val, (datetime.date, datetime.datetime, pd.Timestamp)):
        return val.isoformat()[:10]
    if isinstance(val, (int, float)) and pd.isna(val):
        return None
    return val


def _row_to_dict(row: pd.Series, columns: list[str]) -> dict:
    return {col: _safe_num(row.get(col)) for col in columns if col in row.index}


def get_hsgt_individual_series(symbol: str, days: int = 250) -> dict:
    """
    获取个股北向持股近 N 日序列。

    Args:
        symbol: 股票代码，如"002008"
        days: 返回最近几个交易日（默认250）

    Returns:
        {"symbol": "002008", "count": 250, "data": [
            {"date": "2026-07-01", "close": 20.12, "change_percent": -0.35,
             "hold_shares": 16545828, "hold_market_cap": 332902100.0,
             "hold_pct_a_share": 1.57, "net_shares_change": -835600.0,
             "net_cap_change": -16856640.0},
            ...
        ]}
        失败时返回 {"symbol": ..., "count": 0, "data": [], "error": "..."}
    """
    _log(f"获取个股北向持股: {symbol}, days={days}")

    try:
        df = get_hsgt_individual(symbol)
    except Exception as e:
        _log(f"获取个股北向持股失败: {e}")
        return {"symbol": symbol, "count": 0, "data": [], "error": str(e)}

    if df is None or df.empty:
        return {"symbol": symbol, "count": 0, "data": []}

    columns = [
        "date", "close", "change_percent",
        "hold_shares", "hold_market_cap", "hold_pct_a_share",
        "net_shares_change", "net_cap_change",
    ]
    df_recent = df.tail(days)
    data = [_row_to_dict(row, columns) for _, row in df_recent.iterrows()]

    return {"symbol": symbol, "count": len(data), "data": data}


def get_hsgt_hist_data(fund_type: str, days: int = 250) -> dict:
    """
    获取沪深港通资金流向历史近 N 日序列。

    Args:
        fund_type: 资金类型枚举 "北向资金"|"沪股通"|"深股通"|"南向资金"|"港股通沪"|"港股通深"
        days: 返回最近几个交易日（默认250）

    Returns:
        {"fund_type": "北向资金", "count": 250, "data": [
            {"date": "2026-07-01", "net_buy_amount": null, "buy_amount": null,
             "sell_amount": null, "cumulative_net_buy_amount": null,
             "daily_fund_inflow": null, "daily_balance": null,
             "hold_market_cap": 2.64e12, "leading_stock": "哈药股份",
             "leading_stock_change_percent": 10.05, "leading_stock_code": "600664.SH",
             "hs300": 3955.58, "hs300_change_percent": -0.29},
            ...
        ]}
        注意：交易所自 2024-08-19 起不再披露每日资金流明细，此后 net_buy_amount 等字段
        恒为 null，属预期行为而非数据错误。
        失败时返回 {"fund_type": ..., "count": 0, "data": [], "error": "..."}
    """
    _log(f"获取沪深港通资金流向历史: fund_type={fund_type}, days={days}")

    try:
        df = get_hsgt_hist(fund_type)
    except Exception as e:
        _log(f"获取沪深港通资金流向历史失败: {e}")
        return {"fund_type": fund_type, "count": 0, "data": [], "error": str(e)}

    if df is None or df.empty:
        return {"fund_type": fund_type, "count": 0, "data": []}

    columns = [
        "date", "net_buy_amount", "buy_amount", "sell_amount",
        "cumulative_net_buy_amount", "daily_fund_inflow", "daily_balance",
        "hold_market_cap", "leading_stock", "leading_stock_change_percent",
        "leading_stock_code", "hs300", "hs300_change_percent",
    ]
    df_recent = df.tail(days)
    data = [_row_to_dict(row, columns) for _, row in df_recent.iterrows()]

    return {"fund_type": fund_type, "count": len(data), "data": data}
