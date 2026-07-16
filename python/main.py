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
import pandas as pd


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
from utils.akshare_client import get_industry_list, DataSourceExhausted
from core.formula_engine import parse_and_eval, validate_formula, FormulaContext
from core.backtest import simple_backtest
from core.fund_flow import (
    get_individual_fund_flow_series,
    get_market_fund_flow_series,
    get_sector_fund_flow_rank_data,
)
from core.hsgt import get_hsgt_individual_series, get_hsgt_hist_data
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


def handle_list_industries(request_id: str, params: dict):
    """
    列出东方财富行业板块（可选按关键词子串过滤）。

    params:
      keyword: str | None — 板块名称子串过滤（大小写不敏感）
      limit: int (default 200) — 返回条数上限，防止一次塞太多进上下文
    """
    keyword = (params.get("keyword") or "").strip()
    limit = int(params.get("limit", 200))

    df = get_industry_list()

    # 字段容错读取（东财返回列名稳定，但版本升级时防漂移）
    name_col = next((c for c in df.columns if c in ('板块名称', '名称')), None)
    if name_col is None:
        send_error(request_id, -1, f"行业列表返回缺少板块名称列，实际列: {list(df.columns)}")
        return

    industries = []
    for _, row in df.iterrows():
        name = str(row[name_col])
        if keyword and keyword.lower() not in name.lower():
            continue

        def _num(col):
            if col not in df.columns:
                return None
            try:
                v = row[col]
                return None if pd.isna(v) else float(v)
            except Exception:
                return None

        industries.append({
            "name": name,
            "change_percent": _num('涨跌幅'),
            "market_cap": _num('总市值'),
            "turnover_rate": _num('换手率'),
            "up_count": int(_num('上涨家数') or 0) or None,
            "down_count": int(_num('下跌家数') or 0) or None,
        })

    total = len(industries)
    truncated = total > limit
    if truncated:
        industries = industries[:limit]

    send_response(request_id, {
        "total": total,
        "returned": len(industries),
        "truncated": truncated,
        "industries": industries,
    })


def handle_get_individual_fund_flow(request_id: str, params: dict):
    """获取个股资金流向序列"""
    stock = params.get("stock")
    market = params.get("market")
    days = params.get("days", 100)

    if not stock:
        send_error(request_id, -1, "缺少 stock 参数")
        return
    if market not in ("sh", "sz", "bj"):
        send_error(request_id, -1, f"market 参数非法: {market}，需为 sh/sz/bj")
        return

    result = get_individual_fund_flow_series(stock, market, days)
    send_response(request_id, result)


def handle_get_market_fund_flow(request_id: str, params: dict):
    """获取大盘资金流向序列"""
    days = params.get("days", 100)
    result = get_market_fund_flow_series(days)
    send_response(request_id, result)


def handle_get_sector_fund_flow_rank(request_id: str, params: dict):
    """获取板块资金流向排名"""
    indicator = params.get("indicator")
    sector_type = params.get("sector_type")
    limit = params.get("limit", 50)

    if indicator not in ("今日", "5日", "10日"):
        send_error(request_id, -1, f"indicator 参数非法: {indicator}，需为 今日/5日/10日")
        return
    if sector_type not in ("行业资金流", "概念资金流", "地域资金流"):
        send_error(request_id, -1, f"sector_type 参数非法: {sector_type}，需为 行业资金流/概念资金流/地域资金流")
        return

    result = get_sector_fund_flow_rank_data(indicator, sector_type, limit)
    send_response(request_id, result)


def handle_get_hsgt_individual(request_id: str, params: dict):
    """获取个股北向持股序列"""
    symbol = params.get("symbol")
    days = params.get("days", 250)

    if not symbol:
        send_error(request_id, -1, "缺少 symbol 参数")
        return

    result = get_hsgt_individual_series(symbol, days)
    send_response(request_id, result)


def handle_get_hsgt_hist(request_id: str, params: dict):
    """获取沪深港通资金流向历史"""
    fund_type = params.get("fund_type")
    days = params.get("days", 250)

    if fund_type not in ("北向资金", "沪股通", "深股通", "南向资金", "港股通沪", "港股通深"):
        send_error(request_id, -1, f"fund_type 参数非法: {fund_type}，需为 北向资金/沪股通/深股通/南向资金/港股通沪/港股通深")
        return

    result = get_hsgt_hist_data(fund_type, days)
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


def send_data_source_exhausted_error(request_id: str, exc: DataSourceExhausted):
    """
    数据源双源全挂的结构化 error 响应，比 send_error 多一个 data.attempts 字段。
    protocol.py 的 send_error 不支持 data 参数，这里直接组装 JSON。
    """
    msg = json.dumps({
        "id": request_id,
        "error": {
            "code": "DATA_SOURCE_EXHAUSTED",
            "message": str(exc),
            "data": {"attempts": exc.errors},
        },
    }, ensure_ascii=False)
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


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
    "list_industries": handle_list_industries,
    "run_article_script": handle_run_article_script,
    "parse_announcement_pdf": handle_parse_announcement_pdf,
    "get_individual_fund_flow": handle_get_individual_fund_flow,
    "get_market_fund_flow": handle_get_market_fund_flow,
    "get_sector_fund_flow_rank": handle_get_sector_fund_flow_rank,
    "get_hsgt_individual": handle_get_hsgt_individual,
    "get_hsgt_hist": handle_get_hsgt_hist,
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
        except DataSourceExhausted as e:
            log(f"数据源全部降级失败: {e}")
            try:
                send_data_source_exhausted_error(request_id, e)
            except Exception:
                pass
        except Exception as e:
            log(f"处理请求异常: {traceback.format_exc()}")
            try:
                send_error(request_id, -3, str(e))
            except Exception:
                pass


if __name__ == "__main__":
    main()
