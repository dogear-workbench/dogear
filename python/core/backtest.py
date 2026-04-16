"""
简单回测引擎

基于公式表达式（类通达信语法）对历史 K 线数据进行买卖信号回测。

回测逻辑：
  - 满足 buy_formula  且无持仓 → 以当日收盘价买入（全仓）
  - 满足 sell_formula 且有持仓 → 以当日收盘价卖出（全仓）
  - 每次交易扣除手续费（买卖各 commission）

输出指标：
  - 总收益率、年化收益率、最大回撤、夏普比率
  - 交易次数、胜率
  - 资金曲线（每日账户价值）
"""

import sys
from .formula_engine import parse_and_eval, FormulaContext
from .indicators import calculate as calc_indicators


def _log(msg: str):
    print(f"[backtest] {msg}", file=sys.stderr, flush=True)


def simple_backtest(
    kline: list[dict],
    buy_formula: str,
    sell_formula: str,
    initial_capital: float = 100_000.0,
    commission: float = 0.001,
    params: dict = None,
) -> dict:
    """
    基于公式的简单回测。

    Args:
        kline: 历史 K 线列表（dict，含 date/close/open/high/low/volume）
        buy_formula: 买入公式（布尔表达式），如 "CROSS(MACD.DIF, MACD.DEA)"
        sell_formula: 卖出公式（布尔表达式），如 "RSI(14) > 70"
        initial_capital: 初始资金（默认 10 万元）
        commission: 单边手续费率（默认 0.001 = 0.1%）
        params: 额外参数（保留）

    Returns:
        {
            "total_return": 0.35,          # 总收益率
            "annual_return": 0.18,          # 年化收益率
            "max_drawdown": -0.12,          # 最大回撤
            "sharpe_ratio": 1.25,           # 夏普比率
            "trade_count": 12,              # 交易次数（买卖各一次算一次）
            "win_rate": 0.67,               # 胜率
            "final_capital": 135000.0,      # 最终资金
            "initial_capital": 100000.0,    # 初始资金
            "equity_curve": [               # 资金曲线
                {"date": "2024-01-02", "value": 100000.0},
                ...
            ],
            "trades": [                     # 交易记录
                {"date": "2024-03-01", "action": "buy",  "price": 10.5, "shares": 9523, "capital": 100000.0},
                {"date": "2024-05-10", "action": "sell", "price": 12.0, "shares": 9523, "profit": 0.134},
                ...
            ],
            "buy_hold_return": 0.25,        # 同期买入持有收益率（基准）
            "error": null
        }
    """
    if not kline or len(kline) < 10:
        return {"error": "K 线数据不足（至少需要 10 条）"}

    n = len(kline)
    dates = [k["date"] for k in kline]
    closes = [k["close"] for k in kline]

    # 资金曲线和状态
    cash = initial_capital
    shares = 0
    in_position = False
    buy_price = 0.0
    buy_date = ""

    equity_curve = []
    trades = []
    profits = []  # 每笔收益率

    # 逐日扫描
    for i in range(1, n):  # 从第2天开始（第1天作为前值）
        # 构建截至 i 的上下文（滑动窗口）
        kline_slice = kline[:i + 1]
        ctx = FormulaContext(kline=kline_slice)

        # 计算当前账户价值
        current_price = closes[i]
        account_value = cash + shares * current_price
        equity_curve.append({"date": dates[i], "value": round(account_value, 2)})

        # 判断信号（try/except 兼容公式计算失败）
        try:
            buy_signal = bool(parse_and_eval(buy_formula, ctx)) if not in_position else False
        except Exception:
            buy_signal = False

        try:
            sell_signal = bool(parse_and_eval(sell_formula, ctx)) if in_position else False
        except Exception:
            sell_signal = False

        # 执行买入
        if buy_signal and not in_position:
            cost = current_price * (1 + commission)
            shares = int(cash / cost / 100) * 100  # 取整百股
            if shares > 0:
                cash -= shares * cost
                buy_price = current_price
                buy_date = dates[i]
                in_position = True
                trades.append({
                    "date": dates[i],
                    "action": "buy",
                    "price": round(current_price, 3),
                    "shares": shares,
                    "capital": round(cash, 2),
                })

        # 执行卖出
        elif sell_signal and in_position:
            proceeds = current_price * (1 - commission)
            cash += shares * proceeds
            profit_rate = (proceeds - buy_price) / buy_price
            profits.append(profit_rate)
            trades.append({
                "date": dates[i],
                "action": "sell",
                "price": round(current_price, 3),
                "shares": shares,
                "profit": round(profit_rate, 4),
                "capital": round(cash, 2),
            })
            shares = 0
            in_position = False
            buy_price = 0.0

    # 末日强制平仓（如仍持仓）
    if in_position and shares > 0:
        last_price = closes[-1]
        proceeds = last_price * (1 - commission)
        cash += shares * proceeds
        profit_rate = (proceeds - buy_price) / buy_price
        profits.append(profit_rate)
        trades.append({
            "date": dates[-1],
            "action": "sell(final)",
            "price": round(last_price, 3),
            "shares": shares,
            "profit": round(profit_rate, 4),
            "capital": round(cash, 2),
        })

    # ---- 计算绩效指标 ----
    final_capital = cash
    total_return = (final_capital - initial_capital) / initial_capital

    # 年化收益率（按实际交易天数估算，约 252 交易日/年）
    trading_days = n
    annual_return = (1 + total_return) ** (252 / max(trading_days, 1)) - 1

    # 最大回撤
    peak = initial_capital
    max_drawdown = 0.0
    for pt in equity_curve:
        peak = max(peak, pt["value"])
        dd = (pt["value"] - peak) / peak
        max_drawdown = min(max_drawdown, dd)

    # 夏普比率（简化，无风险利率 2%）
    daily_returns = []
    prev_val = initial_capital
    for pt in equity_curve:
        r = (pt["value"] - prev_val) / prev_val if prev_val > 0 else 0
        daily_returns.append(r)
        prev_val = pt["value"]

    if len(daily_returns) > 1:
        import statistics
        mean_r = statistics.mean(daily_returns)
        std_r = statistics.stdev(daily_returns)
        risk_free_daily = 0.02 / 252
        sharpe = (mean_r - risk_free_daily) / std_r * (252 ** 0.5) if std_r > 0 else 0.0
    else:
        sharpe = 0.0

    # 胜率
    trade_count = len(profits)
    win_count = sum(1 for p in profits if p > 0)
    win_rate = win_count / trade_count if trade_count > 0 else 0.0

    # 买入持有基准
    buy_hold_return = (closes[-1] - closes[0]) / closes[0] if closes[0] > 0 else 0.0

    return {
        "total_return": round(total_return, 4),
        "annual_return": round(annual_return, 4),
        "max_drawdown": round(max_drawdown, 4),
        "sharpe_ratio": round(sharpe, 3),
        "trade_count": trade_count,
        "win_rate": round(win_rate, 4),
        "final_capital": round(final_capital, 2),
        "initial_capital": initial_capital,
        "equity_curve": equity_curve,
        "trades": trades,
        "buy_hold_return": round(buy_hold_return, 4),
        "error": None,
    }
