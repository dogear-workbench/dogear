"""
baostock 客户端封装

选股 SOP（ScreenStocks / ListIndustries / GetFinancials）的唯一数据源。
东财 push2 系列接口被服务端反爬封禁，baostock 走独立 socket 长连接协议不受影响。

与 akshare_client.py 的分工：
  - akshare_client：雪球基本信息、巨潮行业 PE 等仍稳定的接口保留，不动
  - baostock_client：全 A 快照 / 行业分类 / 财务数据（选股 SOP 专用）

字段命名保留 baostock 原始名（peTTM / pbMRQ / turn / pctChg 等），不做中文化，
供 screener/financials 直接引用。
"""

import atexit
import contextlib
import io
import sys
import threading
import time
from datetime import datetime

import baostock as bs
import baostock.common.context as _bs_context
import pandas as pd

from .cache import TTLCache

_cache = TTLCache()


def _log(msg: str):
    print(f"[baostock_client] {msg}", file=sys.stderr, flush=True)


# ============================================================
# 异常
# ============================================================

class BaostockError(Exception):
    """
    baostock 相关错误统一异常。

    error_type 取值：
      - LoginFailed：登录失败（网络不通 / 账号异常）
      - EmptyResult：查询成功但无数据（如股票已退市、日期无交易记录）
      - ApiError：baostock 返回非 0 错误码（参数错误等业务错误）
    """

    def __init__(self, message: str, error_type: str = "ApiError"):
        super().__init__(message)
        self.error_type = error_type


# ============================================================
# session 管理：进程级单例，避免每次调用都 login
#
# baostock 官方约束：不能并发连接访问，超限会进黑名单。SocketUtil 每次 login 都
# 新建 socket 并覆盖 context.default_socket，旧 socket 不主动关闭——反复 login
# 会累积泄漏 TCP 连接，撞上并发限制后服务端接受连接即断开，recv 到空 → 报
# 10002007 "网络接收错误"，形成连续失败雪球。
#
# 对策：
#   1. _session_active + 锁保证成功后不再重复 login
#   2. 首次失败自动重试 3 次（1s → 2s 退避），自愈瞬时抖动
#   3. 每次 login 前清理 default_socket，避免累积泄漏
# ============================================================

_session_active = False
_session_lock = threading.Lock()


def _cleanup_stale_socket():
    """关闭 baostock 内部可能残留的 socket，避免累积触发并发连接限制。"""
    sock = getattr(_bs_context, "default_socket", None)
    if sock is None:
        return
    try:
        sock.close()
    except Exception:
        pass
    try:
        delattr(_bs_context, "default_socket")
    except Exception:
        pass


def _ensure_login():
    global _session_active
    if _session_active:
        return
    with _session_lock:
        if _session_active:
            return
        last_err = None
        for attempt in range(3):
            _cleanup_stale_socket()
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                lg = bs.login()
            if lg.error_code == "0":
                _session_active = True
                _log("baostock 登录成功")
                return
            last_err = f"{lg.error_code} {lg.error_msg}"
            _log(f"login 尝试 {attempt + 1}/3 失败: {last_err}")
            if attempt < 2:
                time.sleep(2 ** attempt)
        _cleanup_stale_socket()
        raise BaostockError(
            f"baostock 登录失败（重试 3 次）: {last_err}",
            error_type="LoginFailed",
        )


def _logout_at_exit():
    global _session_active
    if not _session_active:
        return
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        bs.logout()
    _session_active = False


atexit.register(_logout_at_exit)


# ============================================================
# 重试（只重试连接类异常，业务错误 BaostockError 不重试）
# ============================================================

def _retry(fn, max_retries=3, base_delay=1.0):
    last_error = None
    for attempt in range(max_retries):
        try:
            return fn()
        except BaostockError:
            raise
        except Exception as e:
            last_error = e
            _log(f"重试 {attempt + 1}/{max_retries}: {e}")
            if attempt < max_retries - 1:
                time.sleep(base_delay * (2 ** attempt))
    raise BaostockError(f"baostock 连接失败: {last_error}", error_type="ApiError")


def _rs_to_df(rs, context: str, allow_empty: bool = False) -> pd.DataFrame:
    """把 baostock ResultData 转成 DataFrame，非法/空结果统一转 BaostockError。"""
    if rs.error_code != "0":
        raise BaostockError(f"{context} 查询失败: {rs.error_msg}", error_type="ApiError")
    rows = []
    while rs.error_code == "0" and rs.next():
        rows.append(rs.get_row_data())
    if not rows and not allow_empty:
        raise BaostockError(f"{context} 无数据", error_type="EmptyResult")
    return pd.DataFrame(rows, columns=rs.fields)


# ============================================================
# 公开 API
# ============================================================

def get_industry_map() -> pd.DataFrame:
    """
    获取全市场股票→行业映射（baostock query_stock_industry）。

    返回列：updateDate / code / code_name / industry / industryClassification
    缓存 7 天（行业分类变化极慢）。
    """
    cached = _cache.get("industry_map")
    if cached is not None:
        return cached

    _ensure_login()
    _log("正在获取行业分类映射...")

    rs = _retry(lambda: bs.query_stock_industry())
    df = _rs_to_df(rs, "行业分类映射")

    _cache.set("industry_map", df, 7 * 86400)
    _log(f"行业分类映射获取完成: {len(df)} 条")
    return df


def get_industry_codes(industry: str) -> list[str]:
    """
    从缓存的 industry_map 里 filter 出指定行业的所有 baostock code 列表（带 sh./sz./bj. 前缀）。

    命中 industry_map 缓存后是纯内存 filter，秒回。
    industry 名需完整匹配（如 "C39计算机、通信和其他电子设备制造业"），大小写敏感。
    """
    industry_df = get_industry_map()
    matched = industry_df[industry_df['industry'] == industry]
    return matched['code'].tolist()


def get_all_stock_codes(date: str = "") -> pd.DataFrame:
    """
    获取指定日期全部证券代码（baostock query_all_stock）。

    Args:
        date: "YYYY-MM-DD"，为空取最新交易日

    返回列：code / tradeStatus / code_name。非交易日返回空 DataFrame（不抛异常，
    可据此判断该日是否交易日）。
    缓存 1 天（按 date 分 key）。
    """
    cache_key = f"all_stock_codes:{date}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _ensure_login()
    _log(f"正在获取全部证券代码: date={date or '(最新)'}")

    rs = _retry(lambda: bs.query_all_stock(day=date))
    df = _rs_to_df(rs, "全部证券代码", allow_empty=True)

    _cache.set(cache_key, df, 86400)
    _log(f"全部证券代码获取完成: {len(df)} 条")
    return df


def get_stock_basic() -> pd.DataFrame:
    """
    获取全市场股票基本信息（baostock query_stock_basic，不传 code 返回全市场）。

    返回列：code / code_name / ipoDate / outDate / type / status。
    注意：不含总股本字段——总股本需从 get_financial_series 的 profit 数据里的
    totalShare 字段拼装（design 文档假设 stock_basic 含总股本，实测没有，见交付说明）。
    缓存 7 天。
    """
    cached = _cache.get("stock_basic")
    if cached is not None:
        return cached

    _ensure_login()
    _log("正在获取全市场股票基本信息...")

    rs = _retry(lambda: bs.query_stock_basic())
    df = _rs_to_df(rs, "股票基本信息")

    _cache.set("stock_basic", df, 7 * 86400)
    _log(f"股票基本信息获取完成: {len(df)} 条")
    return df


_K_DATA_FIELDS = (
    "date,code,open,high,low,close,preclose,volume,amount,adjustflag,"
    "turn,tradestatus,pctChg,peTTM,pbMRQ,psTTM,pcfNcfTTM,isST"
)


def get_stock_k_data(code: str, start_date: str, end_date: str, frequency: str = "d") -> pd.DataFrame:
    """
    获取指定股票的历史 K 线（baostock query_history_k_data_plus）。

    Args:
        code: baostock 格式代码，如 "sh.600519"
        start_date / end_date: "YYYY-MM-DD"
        frequency: "d"(日) / "w"(周) / "m"(月)

    返回列固定为 date,code,open,high,low,close,preclose,volume,amount,adjustflag,
    turn,tradestatus,pctChg,peTTM,pbMRQ,psTTM,pcfNcfTTM,isST（原样保留不重命名）。
    无数据时抛 BaostockError(error_type="EmptyResult")，调用方（如批量快照拉取）
    应捕获后跳过该股票，不中断整批。

    不缓存：调用方通常是批量拉不同股票不同日期区间，缓存收益低。
    """
    _ensure_login()

    rs = _retry(lambda: bs.query_history_k_data_plus(
        code, _K_DATA_FIELDS,
        start_date=start_date, end_date=end_date,
        frequency=frequency, adjustflag="3",
    ))
    return _rs_to_df(rs, f"K线数据({code})")


def is_trade_date(date_str: str) -> bool:
    """
    判断指定日期是否为交易日（baostock query_trade_dates）。

    Args:
        date_str: "YYYY-MM-DD"
    """
    _ensure_login()

    rs = _retry(lambda: bs.query_trade_dates(start_date=date_str, end_date=date_str))
    df = _rs_to_df(rs, f"交易日历({date_str})")
    return df.iloc[0]["is_trading_day"] == "1"


_FINANCIAL_APIS = {
    "profit": bs.query_profit_data,
    "growth": bs.query_growth_data,
    "operation": bs.query_operation_data,
    "balance": bs.query_balance_data,
    "cash_flow": bs.query_cash_flow_data,
}


def get_financial_series(code: str, year_range: int = 2) -> dict:
    """
    获取指定股票近 year_range 年的季度财务数据序列（baostock 5 个财务接口）。

    组合调用 query_profit_data / query_growth_data / query_operation_data /
    query_balance_data / query_cash_flow_data，按年 x 季度逐个拉取后拼接。

    Args:
        code: baostock 格式代码，如 "sh.600519"
        year_range: 往前拉几年（含当年），默认 2

    Returns:
        {"profit": df, "growth": df, "operation": df, "balance": df, "cash_flow": df}
        某季度尚未披露时该行缺失（不视为错误）；股票无对应历史数据时该项为空 DataFrame。

    缓存 1 小时。
    """
    cache_key = f"financial_series:{code}:{year_range}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _ensure_login()
    _log(f"正在获取财务数据序列: {code}, year_range={year_range}")

    current_year = datetime.now().year
    years = range(current_year - year_range + 1, current_year + 1)

    result = {}
    for name, api_fn in _FINANCIAL_APIS.items():
        frames = []
        for year in years:
            for quarter in (1, 2, 3, 4):
                rs = _retry(lambda: api_fn(code=code, year=year, quarter=quarter))
                if rs.error_code != "0":
                    _log(f"{name} {code} {year}Q{quarter} 查询失败: {rs.error_msg}")
                    continue
                rows = []
                while rs.error_code == "0" and rs.next():
                    rows.append(rs.get_row_data())
                if rows:
                    frames.append(pd.DataFrame(rows, columns=rs.fields))
        result[name] = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    _cache.set(cache_key, result, 3600)
    return result


# ============================================================
# 手工验证
# ============================================================

if __name__ == "__main__":
    print("=== baostock_client 手工验证 ===")

    print("\n[1] get_industry_map()")
    print(get_industry_map().head(3))

    print("\n[2] get_all_stock_codes()（当天非交易日应返回空，用于验证判断逻辑）")
    print(get_all_stock_codes())

    print("\n[2b] get_all_stock_codes(date='2026-07-17')（最近交易日，供耗时测试取样）")
    all_codes = get_all_stock_codes(date="2026-07-17")
    print(all_codes.head(3))

    print("\n[3] get_stock_basic()")
    print(get_stock_basic().head(3))

    print("\n[4] get_stock_k_data('sh.600519', '2026-06-01', '2026-07-19')")
    print(get_stock_k_data("sh.600519", "2026-06-01", "2026-07-19").head(3))

    print("\n[5] is_trade_date('2026-07-19')")
    print(is_trade_date("2026-07-19"))

    print("\n[6] get_financial_series('sh.600519', year_range=1)")
    financials = get_financial_series("sh.600519", year_range=1)
    for k, v in financials.items():
        print(f"  {k}: {len(v)} 行")

    print("\n=== K 线拉取耗时测试（单只 vs 10 只 vs 100 只）===")
    real_codes = [c for c in all_codes["code"] if c.startswith(("sh.6", "sz.0", "sz.3"))]

    for n in (1, 10, 100):
        sample = real_codes[:n]
        start = time.time()
        ok, skipped = 0, 0
        for code in sample:
            try:
                get_stock_k_data(code, "2026-07-01", "2026-07-19")
                ok += 1
            except BaostockError as e:
                skipped += 1
                _log(f"跳过 {code}: {e.error_type} {e}")
        elapsed = time.time() - start
        print(f"{n} 只: 耗时 {elapsed:.2f}s (平均 {elapsed / n:.3f}s/只, 成功 {ok}, 跳过 {skipped})")
