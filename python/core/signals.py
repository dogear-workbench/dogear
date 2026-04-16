"""
技术信号检测模块

在 K 线数据上检测预定义的技术形态和信号。
所有信号检测都基于已计算的技术指标数据。
"""

from .indicators import calculate as calc_indicators

# ============================================================
# 信号定义
# ============================================================

SIGNAL_DEFINITIONS = {
    "macd_golden_cross": {
        "name": "MACD金叉",
        "description": "DIF 上穿 DEA（看多信号）",
        "requires": ["MACD"],
    },
    "macd_death_cross": {
        "name": "MACD死叉",
        "description": "DIF 下穿 DEA（看空信号）",
        "requires": ["MACD"],
    },
    "kdj_golden_cross": {
        "name": "KDJ金叉",
        "description": "K 线上穿 D 线（看多信号）",
        "requires": ["KDJ"],
    },
    "kdj_oversold": {
        "name": "KDJ超卖",
        "description": "K 值低于 20（超卖区域，可能反弹）",
        "requires": ["KDJ"],
    },
    "kdj_overbought": {
        "name": "KDJ超买",
        "description": "K 值高于 80（超买区域，可能回调）",
        "requires": ["KDJ"],
    },
    "rsi_oversold": {
        "name": "RSI超卖",
        "description": "RSI 低于 30（超卖区域）",
        "requires": ["RSI"],
    },
    "rsi_overbought": {
        "name": "RSI超买",
        "description": "RSI 高于 70（超买区域）",
        "requires": ["RSI"],
    },
    "boll_upper_break": {
        "name": "突破布林上轨",
        "description": "价格突破布林带上轨（强势突破或超买）",
        "requires": ["BOLL"],
    },
    "boll_lower_break": {
        "name": "跌破布林下轨",
        "description": "价格跌破布林带下轨（弱势或超卖）",
        "requires": ["BOLL"],
    },
    "volume_breakout": {
        "name": "成交量突破",
        "description": "成交量超过 20 日均量的 1.5 倍",
        "requires": [],
    },
    "ma_bullish_arrangement": {
        "name": "均线多头排列",
        "description": "MA5 > MA10 > MA20 > MA60（多头趋势确认）",
        "requires": ["MA"],
    },
}


def _cross_above(a: list, b: list, index: int) -> bool:
    """检测 a 在 index 处上穿 b"""
    if index < 1:
        return False
    prev_a, prev_b = a[index - 1], b[index - 1]
    curr_a, curr_b = a[index], b[index]
    if any(v is None for v in [prev_a, prev_b, curr_a, curr_b]):
        return False
    return prev_a <= prev_b and curr_a > curr_b


def _cross_below(a: list, b: list, index: int) -> bool:
    """检测 a 在 index 处下穿 b"""
    if index < 1:
        return False
    prev_a, prev_b = a[index - 1], b[index - 1]
    curr_a, curr_b = a[index], b[index]
    if any(v is None for v in [prev_a, prev_b, curr_a, curr_b]):
        return False
    return prev_a >= prev_b and curr_a < curr_b


def detect_signals(
    kline: list[dict],
    signals: list[str] | None = None,
    lookback: int = 5,
) -> dict:
    """
    检测技术信号。

    Args:
        kline: K 线数据
        signals: 要检测的信号列表（None=检测全部）
        lookback: 回看天数（默认5天）

    Returns:
        {
            "detected": [
                {
                    "signal_id": "macd_golden_cross",
                    "name": "MACD金叉",
                    "description": "...",
                    "date": "2026-04-14",
                    "details": "DIF=2.15, DEA=1.98"
                },
                ...
            ],
            "summary": "近5日检测到 2 个信号"
        }
    """
    if signals is None:
        signals = list(SIGNAL_DEFINITIONS.keys())

    # 收集需要的指标
    needed_indicators = set()
    for sig_id in signals:
        sig_def = SIGNAL_DEFINITIONS.get(sig_id)
        if sig_def:
            needed_indicators.update(sig_def["requires"])

    # 计算指标
    indicator_params = {"MA": {"periods": [5, 10, 20, 60]}}
    indicators = calc_indicators(kline, list(needed_indicators), indicator_params) if needed_indicators else {}

    dates = [k["date"] for k in kline]
    closes = [k["close"] for k in kline]
    volumes = [k["volume"] for k in kline]
    n = len(kline)

    detected = []
    start_idx = max(0, n - lookback)

    for i in range(start_idx, n):
        date = dates[i]

        for sig_id in signals:
            sig_def = SIGNAL_DEFINITIONS.get(sig_id)
            if not sig_def:
                continue

            triggered = False
            details = ""

            # ---- MACD 信号 ----
            if sig_id == "macd_golden_cross":
                macd = indicators.get("MACD", {})
                dif = macd.get("DIF", [])
                dea = macd.get("DEA", [])
                if _cross_above(dif, dea, i):
                    triggered = True
                    details = f"DIF={dif[i]:.4f}, DEA={dea[i]:.4f}"

            elif sig_id == "macd_death_cross":
                macd = indicators.get("MACD", {})
                dif = macd.get("DIF", [])
                dea = macd.get("DEA", [])
                if _cross_below(dif, dea, i):
                    triggered = True
                    details = f"DIF={dif[i]:.4f}, DEA={dea[i]:.4f}"

            # ---- KDJ 信号 ----
            elif sig_id == "kdj_golden_cross":
                kdj = indicators.get("KDJ", {})
                k = kdj.get("K", [])
                d = kdj.get("D", [])
                if _cross_above(k, d, i):
                    triggered = True
                    details = f"K={k[i]:.1f}, D={d[i]:.1f}"

            elif sig_id == "kdj_oversold":
                kdj = indicators.get("KDJ", {})
                k = kdj.get("K", [])
                if i < len(k) and k[i] is not None and k[i] < 20:
                    triggered = True
                    details = f"K={k[i]:.1f}"

            elif sig_id == "kdj_overbought":
                kdj = indicators.get("KDJ", {})
                k = kdj.get("K", [])
                if i < len(k) and k[i] is not None and k[i] > 80:
                    triggered = True
                    details = f"K={k[i]:.1f}"

            # ---- RSI 信号 ----
            elif sig_id == "rsi_oversold":
                rsi = indicators.get("RSI", {}).get("RSI", [])
                if i < len(rsi) and rsi[i] is not None and rsi[i] < 30:
                    triggered = True
                    details = f"RSI={rsi[i]:.1f}"

            elif sig_id == "rsi_overbought":
                rsi = indicators.get("RSI", {}).get("RSI", [])
                if i < len(rsi) and rsi[i] is not None and rsi[i] > 70:
                    triggered = True
                    details = f"RSI={rsi[i]:.1f}"

            # ---- BOLL 信号 ----
            elif sig_id == "boll_upper_break":
                boll = indicators.get("BOLL", {})
                upper = boll.get("UPPER", [])
                if i < len(upper) and upper[i] is not None and closes[i] > upper[i]:
                    triggered = True
                    details = f"收盘={closes[i]:.2f}, 上轨={upper[i]:.2f}"

            elif sig_id == "boll_lower_break":
                boll = indicators.get("BOLL", {})
                lower = boll.get("LOWER", [])
                if i < len(lower) and lower[i] is not None and closes[i] < lower[i]:
                    triggered = True
                    details = f"收盘={closes[i]:.2f}, 下轨={lower[i]:.2f}"

            # ---- 成交量信号 ----
            elif sig_id == "volume_breakout":
                if i >= 20:
                    avg_vol = sum(volumes[i-19:i+1]) / 20
                    if avg_vol > 0 and volumes[i] > avg_vol * 1.5:
                        triggered = True
                        details = f"成交量={volumes[i]:.0f}, 20日均量={avg_vol:.0f}, 倍数={volumes[i]/avg_vol:.1f}x"

            # ---- 均线多头排列 ----
            elif sig_id == "ma_bullish_arrangement":
                ma_data = indicators.get("MA", {})
                ma5 = ma_data.get("MA5", [])
                ma10 = ma_data.get("MA10", [])
                ma20 = ma_data.get("MA20", [])
                ma60 = ma_data.get("MA60", [])
                if (i < len(ma5) and i < len(ma10) and i < len(ma20) and i < len(ma60)
                    and all(v is not None for v in [ma5[i], ma10[i], ma20[i], ma60[i]])
                    and ma5[i] > ma10[i] > ma20[i] > ma60[i]):
                    triggered = True
                    details = f"MA5={ma5[i]:.2f} > MA10={ma10[i]:.2f} > MA20={ma20[i]:.2f} > MA60={ma60[i]:.2f}"

            if triggered:
                detected.append({
                    "signal_id": sig_id,
                    "name": sig_def["name"],
                    "description": sig_def["description"],
                    "date": date,
                    "details": details,
                })

    return {
        "detected": detected,
        "lookback_days": lookback,
        "signals_checked": len(signals),
        "summary": f"近{lookback}日检测到 {len(detected)} 个信号",
    }
