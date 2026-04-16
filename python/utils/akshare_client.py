"""
AKShare 客户端封装

提供限流、TTL 缓存、错误重试，防止因频繁调用被数据源封禁。
AKShare 底层数据源（东方财富、同花顺）有不同的频率限制：
  - 批量接口（stock_zh_a_spot_em）：5s 冷却
  - 单股接口（stock_financial_abstract_ths）：0.5s 间隔
"""

import time
import sys
import akshare as ak
import pandas as pd
from .cache import TTLCache

# ============================================================
# 限流器
# ============================================================

class SimpleRateLimiter:
    """简单的最小间隔限流器"""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self.last_call = 0.0

    def wait(self):
        now = time.time()
        elapsed = now - self.last_call
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self.last_call = time.time()


# 两类限流器
_bulk_limiter = SimpleRateLimiter(5.0)     # 批量接口：5秒间隔
_single_limiter = SimpleRateLimiter(0.5)   # 单股接口：0.5秒间隔

# 全局缓存
_cache = TTLCache()


def _log(msg: str):
    print(f"[akshare_client] {msg}", file=sys.stderr, flush=True)


# ============================================================
# 重试装饰器
# ============================================================

def _retry(fn, max_retries=3, base_delay=1.0):
    """带指数退避的重试"""
    last_error = None
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            last_error = e
            _log(f"重试 {attempt+1}/{max_retries}: {e}")
            if attempt < max_retries - 1:
                time.sleep(base_delay * (2 ** attempt))
    raise last_error


# ============================================================
# 公开 API
# ============================================================

def get_all_a_stocks() -> pd.DataFrame:
    """
    获取全 A 股实时行情快照。

    返回 DataFrame 包含：代码、名称、现价、涨跌幅、PE、PB、总市值、流通市值、
    换手率、成交额、行业等字段。

    缓存 60s（市场全局数据不需要每次实时）。
    """
    cached = _cache.get("all_a_stocks")
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log("正在获取全 A 股快照...")

    df = _retry(lambda: ak.stock_zh_a_spot_em())

    _cache.set("all_a_stocks", df, 60)
    _log(f"全 A 股快照获取完成: {len(df)} 只股票")
    return df


def get_industry_list() -> pd.DataFrame:
    """
    获取行业板块列表（东方财富行业分类）。

    缓存 24h。
    """
    cached = _cache.get("industry_list")
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log("正在获取行业板块列表...")

    df = _retry(lambda: ak.stock_board_industry_name_em())

    _cache.set("industry_list", df, 86400)
    return df


def get_industry_stocks(industry: str) -> pd.DataFrame:
    """
    获取指定行业的成分股列表。

    Args:
        industry: 行业名称，如"食品饮料"、"银行"

    缓存 24h。
    """
    cache_key = f"industry_stocks:{industry}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log(f"正在获取行业成分股: {industry}")

    df = _retry(lambda: ak.stock_board_industry_cons_em(symbol=industry))

    _cache.set(cache_key, df, 86400)
    return df


def get_financial_abstract(symbol: str) -> pd.DataFrame:
    """
    获取个股财报摘要（同花顺数据源）。

    Args:
        symbol: 股票代码，如"600519"

    返回：最近若干期的营收、净利润、ROE、毛利率等。
    缓存 1h。
    """
    cache_key = f"financial:{symbol}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取财报数据: {symbol}")

    df = _retry(lambda: ak.stock_financial_abstract_ths(symbol=symbol))

    _cache.set(cache_key, df, 3600)
    return df


def get_financial_indicators(symbol: str) -> pd.DataFrame:
    """
    获取个股财务分析指标（ROE、毛利率、净利率等时间序列）。

    Args:
        symbol: 股票代码

    缓存 1h。
    """
    cache_key = f"fin_indicators:{symbol}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取财务指标: {symbol}")

    df = _retry(lambda: ak.stock_financial_analysis_indicator(symbol=symbol))

    _cache.set(cache_key, df, 3600)
    return df


def get_stock_basic_xq(symbol: str) -> pd.DataFrame:
    """
    获取个股基本信息（雪球数据源）。

    返回 key-value DataFrame（columns: item, value），包含：
    公司名称、行业分类、主营业务、注册资本、上市日期、实际控制人 等。

    Args:
        symbol: 带市场前缀的代码，如 "SZ002222"、"SH600519"

    缓存 86400s（基本面信息变化极慢）。
    """
    cache_key = f"stock_basic_xq:{symbol}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取雪球基本信息: {symbol}")

    df = _retry(lambda: ak.stock_individual_basic_info_xq(symbol=symbol))

    _cache.set(cache_key, df, 86400)
    return df


def get_stock_spot_xq(symbol: str) -> pd.DataFrame:
    """
    获取个股实时行情（雪球数据源）。

    返回 key-value DataFrame（columns: item, value），包含：
    市盈率(静/动/TTM)、市净率、换手率、52周高低、成交量/额 等。

    Args:
        symbol: 带市场前缀的代码，如 "SZ002222"、"SH600519"

    缓存 60s。
    """
    cache_key = f"stock_spot_xq:{symbol}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取雪球行情: {symbol}")

    df = _retry(lambda: ak.stock_individual_spot_xq(symbol=symbol))

    _cache.set(cache_key, df, 60)
    return df


def get_industry_pe_cninfo(date: str = "") -> pd.DataFrame:
    """
    获取行业市盈率数据（巨潮资讯数据源）。

    返回 DataFrame，包含：行业分类、行业代码、行业名称、公司数量、
    盈利公司数量、总市值、净利润、静态PE(加权/中位数/算术平均) 等。

    Args:
        date: 查询日期 "20260415"，为空则取最新

    缓存 3600s（行业PE数据变化缓慢）。
    """
    cache_key = f"industry_pe_cninfo:{date}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取行业PE数据: date={date}")

    df = _retry(lambda: ak.stock_industry_pe_ratio_cninfo(
        symbol="证监会行业分类", date=date
    ))

    _cache.set(cache_key, df, 3600)
    _log(f"行业PE数据获取完成: {len(df)} 条")
    return df


def get_stock_hist(symbol: str, period: str = "daily",
                   start_date: str = "", end_date: str = "",
                   adjust: str = "qfq") -> pd.DataFrame:
    """
    获取个股历史 K 线（AKShare，作为东方财富 API 的备用源）。

    Args:
        symbol: 股票代码
        period: "daily"/"weekly"/"monthly"
        start_date: 起始日期 "20260101"
        end_date: 结束日期 "20260415"
        adjust: "qfq"(前复权)/"hfq"(后复权)/""(不复权)

    缓存 60s。
    """
    cache_key = f"hist:{symbol}:{period}:{start_date}:{end_date}:{adjust}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()

    df = _retry(lambda: ak.stock_zh_a_hist(
        symbol=symbol, period=period,
        start_date=start_date, end_date=end_date,
        adjust=adjust
    ))

    _cache.set(cache_key, df, 60)
    return df
