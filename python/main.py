"""
Dogear Python 计算层 — JSON-RPC 守护进程

通过 stdin/stdout 与 Electron 主进程通信。
启动后等待请求，直到收到 shutdown 命令或 stdin 关闭。

支持的 methods:
  - ping              → {"result": "pong"}
  - calc_indicators   → 技术指标批量计算
  - shutdown          → 优雅退出
"""

import sys
import json
import traceback


# 将 stderr 用于日志（不干扰 stdout 的 JSON 通信）
def log(msg: str):
    print(f"[dogear-python] {msg}", file=sys.stderr, flush=True)


log("Python 计算层启动中...")

# 让用户平台脚本能用 `from article_parser_sdk import ...`
from article_parser import sdk as _article_parser_sdk
sys.modules['article_parser_sdk'] = _article_parser_sdk

from core.protocol import read_request, send_response, send_error
from core.indicators import calculate
from core.financials import get_financials, compare_industry
from core.screener import screen_stocks
from core.signals import detect_signals
from core.formula_engine import parse_and_eval, validate_formula, FormulaContext
from core.backtest import simple_backtest
from announcements.parser import parse_pdf
from announcements.markdown import to_markdown

log("模块加载完成，等待请求...")


# ============================================================
# Method 路由
# ============================================================

def handle_ping(request_id: str, params: dict):
    send_response(request_id, "pong")


def handle_calc_indicators(request_id: str, params: dict):
    """计算技术指标"""
    kline = params.get("kline")
    indicators = params.get("indicators")
    indicator_params = params.get("params", {})

    if not kline or not indicators:
        send_error(request_id, -1, "缺少必要参数: kline 和 indicators")
        return

    result = calculate(kline, indicators, indicator_params)
    send_response(request_id, result)


def handle_get_financials(request_id: str, params: dict):
    """获取财报数据"""
    symbol = params.get("symbol")
    periods = params.get("periods", 4)

    if not symbol:
        send_error(request_id, -1, "缺少 symbol 参数")
        return

    result = get_financials(symbol, periods)
    send_response(request_id, result)


def handle_compare_industry(request_id: str, params: dict):
    """行业对比"""
    symbol = params.get("symbol")
    metrics = params.get("metrics")

    if not symbol:
        send_error(request_id, -1, "缺少 symbol 参数")
        return

    result = compare_industry(symbol, metrics)
    send_response(request_id, result)


def handle_screen_stocks(request_id: str, params: dict):
    """全市场筛选"""
    conditions = params.get("conditions", {})
    limit = params.get("limit", 20)

    result = screen_stocks(conditions, request_id=request_id, limit=limit)
    send_response(request_id, result)


def handle_detect_signals(request_id: str, params: dict):
    """检测技术信号"""
    kline = params.get("kline")
    signals = params.get("signals")  # None = 检测全部
    lookback = params.get("lookback", 5)

    if not kline:
        send_error(request_id, -1, "缺少 kline 参数")
        return

    result = detect_signals(kline, signals=signals, lookback=lookback)
    send_response(request_id, result)


def handle_eval_formula(request_id: str, params: dict):
    """执行公式表达式"""
    expression = params.get("expression")
    kline = params.get("kline", [])
    stock_data = params.get("stock_data", {})
    industry_data = params.get("industry_data", {})

    if not expression:
        send_error(request_id, -1, "缺少 expression 参数")
        return

    try:
        ctx = FormulaContext(kline=kline, stock_data=stock_data, industry_data=industry_data)
        result = parse_and_eval(expression, ctx)
        send_response(request_id, {"result": result})
    except Exception as e:
        send_response(request_id, {"result": None, "error": str(e)})


def handle_validate_formula(request_id: str, params: dict):
    """验证公式语法"""
    expression = params.get("expression")

    if not expression:
        send_error(request_id, -1, "缺少 expression 参数")
        return

    result = validate_formula(expression)
    send_response(request_id, result)


def handle_run_article_script(request_id: str, params: dict):
    """
    执行平台脚本。

    params:
      script_path: str | None — 脚本文件路径（二选一）
      script_content: str | None — 直接传入的脚本源码（二选一）
      url: str
      html: str
      timeout_ms: int (default 5000，范围 [100, 30000])
    """
    from article_parser.runner import run_script

    script_path = params.get("script_path")
    script_content = params.get("script_content")
    url = params.get("url", "")
    html = params.get("html", "")
    timeout_ms = int(params.get("timeout_ms", 5000))

    if not script_path and not script_content:
        send_error(request_id, -1, "必须提供 script_path 或 script_content")
        return
    if not html:
        send_error(request_id, -1, "缺少 html 参数")
        return

    # clamp 到合理范围
    timeout_ms = max(100, min(timeout_ms, 30_000))

    result = run_script(
        script_path=script_path,
        script_content=script_content,
        url=url,
        html=html,
        timeout_ms=timeout_ms,
    )
    send_response(request_id, result.to_dict())


def handle_simple_backtest(request_id: str, params: dict):
    """简单策略回测"""
    kline = params.get("kline")
    buy_formula = params.get("buy_formula")
    sell_formula = params.get("sell_formula")
    initial_capital = params.get("initial_capital", 100_000.0)
    commission = params.get("commission", 0.001)

    if not kline:
        send_error(request_id, -1, "缺少 kline 参数")
        return
    if not buy_formula:
        send_error(request_id, -1, "缺少 buy_formula 参数")
        return
    if not sell_formula:
        send_error(request_id, -1, "缺少 sell_formula 参数")
        return

    result = simple_backtest(
        kline=kline,
        buy_formula=buy_formula,
        sell_formula=sell_formula,
        initial_capital=initial_capital,
        commission=commission,
    )
    send_response(request_id, result)


def handle_parse_announcement_pdf(request_id: str, params: dict):
    """解析公告 PDF 为 markdown"""
    pdf_path = params.get("path")

    if not pdf_path:
        send_error(request_id, -1, "缺少 path 参数")
        return

    parsed = parse_pdf(pdf_path)
    markdown = to_markdown(parsed)
    send_response(request_id, {"markdown": markdown})


METHOD_HANDLERS = {
    "ping": handle_ping,
    "calc_indicators": handle_calc_indicators,
    "get_financials": handle_get_financials,
    "compare_industry": handle_compare_industry,
    "screen_stocks": handle_screen_stocks,
    "detect_signals": handle_detect_signals,
    "eval_formula": handle_eval_formula,
    "validate_formula": handle_validate_formula,
    "simple_backtest": handle_simple_backtest,
    "run_article_script": handle_run_article_script,
    "parse_announcement_pdf": handle_parse_announcement_pdf,
}


# ============================================================
# 主循环
# ============================================================

def main():
    while True:
        try:
            request = read_request()
            if request is None:
                log("stdin 已关闭，退出")
                break

            request_id = request.get("id", "unknown")
            method = request.get("method")
            params = request.get("params", {})

            if method == "shutdown":
                log("收到 shutdown 命令，退出")
                send_response(request_id, "ok")
                break

            handler = METHOD_HANDLERS.get(method)
            if handler is None:
                send_error(request_id, -2, f"未知方法: {method}")
                continue

            handler(request_id, params)

        except json.JSONDecodeError as e:
            log(f"JSON 解析失败: {e}")
        except Exception as e:
            log(f"处理请求异常: {traceback.format_exc()}")
            try:
                send_error(request_id, -3, str(e))
            except Exception:
                pass


if __name__ == "__main__":
    main()
