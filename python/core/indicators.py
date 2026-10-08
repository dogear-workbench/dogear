"""
技术指标计算引擎

所有函数接收 K 线数据（list of dict，每个 dict 包含 date/open/close/high/low/volume/turnover），
返回计算结果 dict。

使用 pandas DataFrame 进行向量化计算，性能优于逐行遍历。
"""

import pandas as pd
import numpy as np


def _to_df(kline: list[dict]) -> pd.DataFrame:
    """将 K 线数据列表转为 DataFrame，确保数值类型正确。"""
    df = pd.DataFrame(kline)
    for col in ['open', 'close', 'high', 'low', 'volume', 'turnover']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df


def calc_ma(kline: list[dict], periods: list[int] = None) -> dict:
    """
    简单移动均线 (SMA)

    params:
        periods: 均线周期列表，默认 [5, 10, 20, 60]

    returns:
        {"MA5": [...], "MA10": [...], ...}
        每个数组长度与 kline 相同，前 N-1 个值为 None
    """
    if periods is None:
        periods = [5, 10, 20, 60]
    df = _to_df(kline)
    result = {}
    for p in periods:
        ma = df['close'].rolling(window=p).mean()
        result[f"MA{p}"] = [None if pd.isna(v) else round(v, 4) for v in ma]
    return result


def calc_ema(kline: list[dict], periods: list[int] = None) -> dict:
    """
    指数移动均线 (EMA)

    params:
        periods: 均线周期列表，默认 [12, 26]

    returns:
        {"EMA12": [...], "EMA26": [...]}
    """
    if periods is None:
        periods = [12, 26]
    df = _to_df(kline)
    result = {}
    for p in periods:
        ema = df['close'].ewm(span=p, adjust=False).mean()
        result[f"EMA{p}"] = [None if pd.isna(v) else round(v, 4) for v in ema]
    return result


def calc_macd(kline: list[dict], fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """
    MACD (Moving Average Convergence Divergence)

    returns:
        {
            "DIF": [...],   # 快线 - 慢线
            "DEA": [...],   # DIF 的 EMA
            "MACD": [...]   # (DIF - DEA) * 2，即柱状图
        }
    """
    df = _to_df(kline)
    ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
    ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal, adjust=False).mean()
    macd_hist = (dif - dea) * 2

    def to_list(s):
        return [None if pd.isna(v) else round(v, 4) for v in s]

    return {
        "DIF": to_list(dif),
        "DEA": to_list(dea),
        "MACD": to_list(macd_hist),
    }


def calc_kdj(kline: list[dict], n: int = 9, m1: int = 3, m2: int = 3) -> dict:
    """
    KDJ 随机指标

    returns:
        {"K": [...], "D": [...], "J": [...]}
    """
    df = _to_df(kline)
    low_n = df['low'].rolling(window=n).min()
    high_n = df['high'].rolling(window=n).max()

    rsv = (df['close'] - low_n) / (high_n - low_n) * 100
    rsv = rsv.fillna(50)

    k = pd.Series(index=df.index, dtype=float)
    d = pd.Series(index=df.index, dtype=float)
    k.iloc[0] = 50
    d.iloc[0] = 50

    for i in range(1, len(df)):
        k.iloc[i] = (2 / m1) * rsv.iloc[i] + (1 - 2 / m1) * k.iloc[i - 1]
        d.iloc[i] = (2 / m2) * k.iloc[i] + (1 - 2 / m2) * d.iloc[i - 1]

    j = 3 * k - 2 * d

    def to_list(s):
        return [None if pd.isna(v) else round(v, 2) for v in s]

    return {"K": to_list(k), "D": to_list(d), "J": to_list(j)}


def calc_rsi(kline: list[dict], period: int = 14) -> dict:
    """
    RSI (Relative Strength Index)

    returns:
        {"RSI": [...]}
    """
    df = _to_df(kline)
    delta = df['close'].diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)

    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return {"RSI": [None if pd.isna(v) else round(v, 2) for v in rsi]}


def calc_boll(kline: list[dict], period: int = 20, width: float = 2.0) -> dict:
    """
    布林带 (Bollinger Bands)

    returns:
        {"UPPER": [...], "MID": [...], "LOWER": [...]}
    """
    df = _to_df(kline)
    mid = df['close'].rolling(window=period).mean()
    std = df['close'].rolling(window=period).std()
    upper = mid + width * std
    lower = mid - width * std

    def to_list(s):
        return [None if pd.isna(v) else round(v, 4) for v in s]

    return {"UPPER": to_list(upper), "MID": to_list(mid), "LOWER": to_list(lower)}


def calc_wr(kline: list[dict], period: int = 14) -> dict:
    """
    威廉指标 (Williams %R)

    returns:
        {"WR": [...]}  # 值域 -100 ~ 0
    """
    df = _to_df(kline)
    high_n = df['high'].rolling(window=period).max()
    low_n = df['low'].rolling(window=period).min()
    wr = (high_n - df['close']) / (high_n - low_n) * (-100)

    return {"WR": [None if pd.isna(v) else round(v, 2) for v in wr]}


def calc_obv(kline: list[dict]) -> dict:
    """
    能量潮 (On-Balance Volume)

    returns:
        {"OBV": [...]}
    """
    df = _to_df(kline)
    direction = np.sign(df['close'].diff())
    direction.iloc[0] = 0
    obv = (direction * df['volume']).cumsum()

    return {"OBV": [round(v, 0) for v in obv]}


def calc_atr(kline: list[dict], period: int = 14) -> dict:
    """
    真实波幅 (Average True Range)

    returns:
        {"ATR": [...]}
    """
    df = _to_df(kline)
    high_low = df['high'] - df['low']
    high_close_prev = (df['high'] - df['close'].shift(1)).abs()
    low_close_prev = (df['low'] - df['close'].shift(1)).abs()

    tr = pd.concat([high_low, high_close_prev, low_close_prev], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

    return {"ATR": [None if pd.isna(v) else round(v, 4) for v in atr]}


def calc_vwap(kline: list[dict]) -> dict:
    """
    成交量加权平均价 (VWAP)

    注意：标准 VWAP 是盘中指标，这里对日K线做累计 VWAP 近似。

    returns:
        {"VWAP": [...]}
    """
    df = _to_df(kline)
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    cum_vol = df['volume'].cumsum()
    cum_tp_vol = (typical_price * df['volume']).cumsum()
    vwap = cum_tp_vol / cum_vol

    return {"VWAP": [None if pd.isna(v) else round(v, 4) for v in vwap]}


# ============================================================
# 指标注册表
# ============================================================

INDICATOR_REGISTRY = {
    "MA": calc_ma,
    "EMA": calc_ema,
    "MACD": calc_macd,
    "KDJ": calc_kdj,
    "RSI": calc_rsi,
    "BOLL": calc_boll,
    "WR": calc_wr,
    "OBV": calc_obv,
    "ATR": calc_atr,
    "VWAP": calc_vwap,
}


def calculate(kline: list[dict], indicators: list[str], params: dict = None) -> dict:
    """
    批量计算指标。

    Args:
        kline: K 线数据列表
        indicators: 要计算的指标名称列表，如 ["MACD", "RSI", "BOLL"]
        params: 各指标的可选参数，如 {"RSI": {"period": 6}, "BOLL": {"width": 3}}

    Returns:
        {
            "MACD": {"DIF": [...], "DEA": [...], "MACD": [...]},
            "RSI": {"RSI": [...]},
            ...
        }

    Raises:
        ValueError: 未知的指标名称
    """
    if params is None:
        params = {}

    # 各指标的参数别名映射：外部键 → 函数关键字参数
    _PARAM_ALIASES: dict[str, dict[str, str]] = {
        "MA":   {"N": "periods", "periods": "periods"},
        "EMA":  {"N": "periods", "periods": "periods"},
        "MACD": {"fast": "fast", "slow": "slow", "signal": "signal"},
        "KDJ":  {"n": "n", "m1": "m1", "m2": "m2"},
        "RSI":  {"period": "period", "N": "period"},
        "BOLL": {"N": "period", "period": "period", "k": "width", "width": "width"},
        "WR":   {"period": "period", "N": "period"},
        "ATR":  {"period": "period", "N": "period"},
    }

    results = {}
    for name in indicators:
        upper_name = name.upper()
        if upper_name not in INDICATOR_REGISTRY:
            raise ValueError(f"未知指标: {name}，可用指标: {', '.join(INDICATOR_REGISTRY.keys())}")

        raw_params = params.get(name, params.get(upper_name, {}))

        # 将外部参数名（如 "N"）映射到函数实际关键字参数名
        alias_map = _PARAM_ALIASES.get(upper_name, {})
        normalized: dict = {}
        for k, v in raw_params.items():
            mapped_key = alias_map.get(k, k)
            normalized[mapped_key] = v

        results[upper_name] = INDICATOR_REGISTRY[upper_name](kline, **normalized)

    return results
