"""
AKShare 客户端封装

提供限流、TTL 缓存、错误重试，防止因频繁调用被数据源封禁。
AKShare 底层数据源（东方财富、同花顺）有不同的频率限制：
  - 批量接口（stock_zh_a_spot_em）：5s 冷却
  - 单股接口（stock_financial_abstract_new_ths）：0.5s 间隔
"""

import time
import sys

# 强制 requests 忽略系统/环境代理：数据源均在国内，用户本机代理挂了不该影响行情
# 必须在 import akshare 前完成，覆盖 akshare 内部所有 Session 实例
import requests as _requests
_orig_session_init = _requests.Session.__init__
def _no_trust_env_init(self, *args, **kwargs):
    _orig_session_init(self, *args, **kwargs)
    self.trust_env = False
_requests.Session.__init__ = _no_trust_env_init

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
# 双源降级
# ============================================================

class DataSourceExhausted(Exception):
    """一级接口的所有候选数据源均调用失败。"""

    def __init__(self, errors: list[tuple[str, str]]):
        self.errors = errors
        summary = "; ".join(f"{name}: {msg}" for name, msg in errors)
        super().__init__(f"数据源全部失败（{len(errors)} 个）: {summary}")

    def __str__(self):
        return self.args[0]


def _try_sources(*sources: tuple[str, "callable[[], pd.DataFrame]"]) -> pd.DataFrame:
    """
    按序尝试多个数据源，成功即返回 df 并标记 df.attrs['_source'] = name。
    全部失败则抛 DataSourceExhausted，不重试等待（fallback 本身就是唯一的容错手段）。

    Args:
        sources: [(name, fn), ...]，fn 无参、返回 pd.DataFrame
    """
    errors: list[tuple[str, str]] = []
    for name, fn in sources:
        try:
            df = fn()
            df.attrs["_source"] = name
            return df
        except Exception as e:
            msg = str(e)[:100]
            errors.append((name, msg))
            _log(f"数据源 {name} 失败，尝试下一个候选源: {msg}")
    raise DataSourceExhausted(errors)


# 新浪 stock_zh_a_spot 与东财 stock_zh_a_spot_em 的同名列映射（值相同，显式列出便于核对）
_SINA_TO_EM_COLUMNS = [
    "代码", "名称", "最新价", "涨跌额", "涨跌幅",
    "昨收", "今开", "最高", "最低", "成交量", "成交额",
]

# 东财独有、新浪无对应字段的列，统一补 NaN 占位（保持 df.columns 形状一致）
_EM_ONLY_COLUMNS = [
    "序号", "振幅", "量比", "换手率", "市盈率-动态", "市净率",
    "总市值", "流通市值", "涨速", "5分钟涨跌", "60日涨跌幅", "年初至今涨跌幅",
]


def _normalize_from_sina(df: pd.DataFrame) -> pd.DataFrame:
    """把新浪 stock_zh_a_spot 归一化为东财 stock_zh_a_spot_em 的列结构。"""
    out = df[[c for c in _SINA_TO_EM_COLUMNS if c in df.columns]].copy()
    out["代码"] = out["代码"].str.replace(r"^(sh|sz|bj)", "", regex=True)
    for col in _EM_ONLY_COLUMNS:
        out[col] = pd.NA
    return out


# 同花顺 stock_board_industry_summary_ths 与东财 stock_board_industry_name_em 的列名映射
_THS_TO_EM_INDUSTRY_COLUMNS = {
    "序号": "排名",
    "板块": "板块名称",
    "涨跌幅": "涨跌幅",
    "上涨家数": "上涨家数",
    "下跌家数": "下跌家数",
    "领涨股": "领涨股票",
    "领涨股-涨跌幅": "领涨股票-涨跌幅",
}

# 东财独有、同花顺无对应字段的列，统一补 NaN 占位
_EM_ONLY_INDUSTRY_COLUMNS = ["板块代码", "最新价", "涨跌额", "总市值", "换手率"]


def _normalize_from_ths_industry(df: pd.DataFrame) -> pd.DataFrame:
    """把同花顺 stock_board_industry_summary_ths 归一化为东财行业板块列表的列结构。"""
    cols = {cn: em for cn, em in _THS_TO_EM_INDUSTRY_COLUMNS.items() if cn in df.columns}
    out = df[list(cols.keys())].rename(columns=cols).copy()
    for col in _EM_ONLY_INDUSTRY_COLUMNS:
        out[col] = pd.NA
    return out


# 同花顺新版财报摘要 stock_financial_abstract_new_ths 的 metric_name 归一化
# （原始返回是长表：一行 = 一个报告期 x 一个指标；3 个 xxx_yoy_growth_ratio 指标是其余
#  指标 yoy 列的百分比重复表达，丢弃不影响信息完整性）
_THS_ABSTRACT_METRIC_MAP = {
    "operating_income_total": "营业总收入",
    "parent_holder_net_profit": "归属净利润",
    "index_deduct_holder_net_profit": "扣非净利润",
    "basic_eps": "基本每股收益",
    "calc_per_net_assets": "每股净资产",
    "index_weighted_avg_roe": "净资产收益率",
    "index_full_diluted_roe": "净资产收益率-摊薄",
    "sale_gross_margin": "销售毛利率",
    "sale_net_interest_ratio": "销售净利率",
    "assets_debt_ratio": "资产负债率",
    "index_per_operating_cash_flow_net": "每股经营现金流",
    "per_undistributed_profits": "每股未分配利润",
    "per_capital_reserve": "每股资本公积金",
    "current_ratio": "流动比率",
    "quick_ratio": "速动比率",
    "conservative_quick_ratio": "保守速动比率",
    "equity_ratio": "产权比率",
    "inventory_turnover_ratio": "存货周转率",
    "inventory_turnover_days": "存货周转天数",
    "receive_accounts_turnover_days": "应收账款周转天数",
    "business_cycle": "营业周期",
}
_THS_ABSTRACT_DROP_METRICS = {
    "deduct_net_profit_yoy_growth_ratio",
    "calculate_operating_income_total_yoy_growth_ratio",
    "calculate_parent_holder_net_profit_yoy_growth_ratio",
}


def _pivot_ths_financial_abstract(df: pd.DataFrame) -> pd.DataFrame:
    """
    把 stock_financial_abstract_new_ths 的长表转成宽表：一行一个报告期。
    每个指标产出 4 列：{中文名}（累计值）、{中文名}_yoy、{中文名}_mom、{中文名}_single_yoy
    （yoy/mom/single_yoy 原始是小数，这里 *100 转百分比，与旧版字段量纲保持一致）。
    """
    df = df[~df["metric_name"].isin(_THS_ABSTRACT_DROP_METRICS)].copy()
    df["metric_cn"] = df["metric_name"].map(_THS_ABSTRACT_METRIC_MAP).fillna(df["metric_name"])

    pivot = df.pivot_table(
        index="report_date", columns="metric_cn",
        values=["value", "yoy", "mom", "single_yoy"], aggfunc="first",
    )

    out = pd.DataFrame(index=pivot.index)
    for metric_cn in df["metric_cn"].unique():
        if ("value", metric_cn) in pivot.columns:
            out[metric_cn] = pivot[("value", metric_cn)]
        for suffix in ("yoy", "mom", "single_yoy"):
            if (suffix, metric_cn) in pivot.columns:
                out[f"{metric_cn}_{suffix}"] = pd.to_numeric(
                    pivot[(suffix, metric_cn)], errors="coerce"
                ) * 100

    out = out.reset_index().rename(columns={"report_date": "报告期"})
    return out.sort_values("报告期").reset_index(drop=True)


def _symbol_to_secucode(symbol: str) -> str:
    """裸代码转东财 SECUCODE 格式（沪 6 开头→.SH，深 0/3 开头→.SZ，北 8/4 开头→.BJ）。"""
    if symbol.startswith("6"):
        suffix = "SH"
    elif symbol.startswith(("8", "4")):
        suffix = "BJ"
    else:
        suffix = "SZ"
    return f"{symbol}.{suffix}"


# ============================================================
# 公开 API
# ============================================================

def get_all_a_stocks() -> pd.DataFrame:
    """
    获取全 A 股实时行情快照。

    返回 DataFrame 包含：代码、名称、现价、涨跌幅、PE、PB、总市值、流通市值、
    换手率、成交额、行业等字段。主源东方财富挂时降级到新浪（PE/PB/市值等字段为 NaN）。
    双源全挂抛 DataSourceExhausted。

    缓存 60s（市场全局数据不需要每次实时）。
    """
    cached = _cache.get("all_a_stocks")
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log("正在获取全 A 股快照...")

    df = _try_sources(
        ("eastmoney", lambda: ak.stock_zh_a_spot_em()),
        ("sina", lambda: _normalize_from_sina(ak.stock_zh_a_spot())),
    )

    _cache.set("all_a_stocks", df, 60)
    _log(f"全 A 股快照获取完成: {len(df)} 只股票 (源: {df.attrs.get('_source')})")
    return df


def get_industry_list() -> pd.DataFrame:
    """
    获取行业板块列表（东方财富行业分类）。主源挂时降级到同花顺（部分字段为 NaN）。
    双源全挂抛 DataSourceExhausted。

    缓存 24h。
    """
    cached = _cache.get("industry_list")
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log("正在获取行业板块列表...")

    df = _try_sources(
        ("eastmoney", lambda: ak.stock_board_industry_name_em()),
        ("ths", lambda: _normalize_from_ths_industry(ak.stock_board_industry_summary_ths())),
    )

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


def get_financial_abstract(symbol: str, indicator: str = "按报告期") -> pd.DataFrame:
    """
    获取个股财报摘要（同花顺新版数据源，含 yoy/mom/single_yoy）。

    Args:
        symbol: 股票代码，如"600519"
        indicator: 报告期口径，默认"按报告期"，可选"一季度"/"二季度"/"三季度"/"四季度"/"按年度"

    返回：宽表 DataFrame，一行一个报告期。列含营业总收入/归属净利润/净资产收益率/销售毛利率等
    基础值，以及每个指标对应的 {指标}_yoy（同比%）、{指标}_mom（环比%）、{指标}_single_yoy（单季同比%）。
    缓存 1h。
    """
    cache_key = f"financial:{symbol}:{indicator}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取财报数据: {symbol}")

    raw = _retry(lambda: ak.stock_financial_abstract_new_ths(symbol=symbol, indicator=indicator))
    df = _pivot_ths_financial_abstract(raw)

    _cache.set(cache_key, df, 3600)
    return df


def get_financial_indicators(symbol: str, indicator: str = "按报告期") -> pd.DataFrame:
    """
    获取个股财务分析指标（东方财富主要指标，按报告期/单季度时间序列）。

    Args:
        symbol: 股票代码裸码，如"600519"（内部自动转东财 SECUCODE 格式，如"600519.SH"）
        indicator: "按报告期"（默认，累计值）或"按单季度"

    返回 AKShare 原始列名（141+ 字段，含 EPSJB/TOTALOPERATEREVE/ROEJQ 等东财指标代码），
    暂未做中文归一化——该接口当前无消费方，留待后续 step 按需裁剪/映射字段。
    缓存 1h。
    """
    secucode = _symbol_to_secucode(symbol)
    cache_key = f"fin_indicators:{secucode}:{indicator}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取财务指标: {secucode}")

    df = _retry(lambda: ak.stock_financial_analysis_indicator_em(symbol=secucode, indicator=indicator))

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


# ============================================================
# 资金流向
# ============================================================

# 主力/超大单/大单/中单/小单净流入-净额、净流入-净占比 的中文后缀 → 英文字段名
# （个股/大盘接口无前缀；板块排名接口按 indicator 加前缀"今日"/"5日"/"10日"，调用方先剥离前缀再套用本映射）
_FUND_FLOW_SUFFIX_MAP = {
    "主力净流入-净额": "main_net_inflow",
    "主力净流入-净占比": "main_net_pct",
    "超大单净流入-净额": "super_large_net_inflow",
    "超大单净流入-净占比": "super_large_net_pct",
    "大单净流入-净额": "large_net_inflow",
    "大单净流入-净占比": "large_net_pct",
    "中单净流入-净额": "medium_net_inflow",
    "中单净流入-净占比": "medium_net_pct",
    "小单净流入-净额": "small_net_inflow",
    "小单净流入-净占比": "small_net_pct",
    "主力净流入最大股": "main_net_inflow_top_stock",
}

_INDIVIDUAL_FUND_FLOW_COLUMNS = {
    "日期": "date",
    "收盘价": "close",
    "涨跌幅": "change_percent",
    **_FUND_FLOW_SUFFIX_MAP,
}

_MARKET_FUND_FLOW_COLUMNS = {
    "日期": "date",
    "上证-收盘价": "sh_close",
    "上证-涨跌幅": "sh_change_percent",
    "深证-收盘价": "sz_close",
    "深证-涨跌幅": "sz_change_percent",
    **_FUND_FLOW_SUFFIX_MAP,
}


def _normalize_sector_fund_flow_rank(df: pd.DataFrame, indicator: str) -> pd.DataFrame:
    """把板块资金流排名的前缀列名（如"今日主力净流入-净额"）剥离前缀后套用统一映射。"""
    rename = {}
    for col in df.columns:
        if col in ("序号", "名称"):
            rename[col] = {"序号": "rank", "名称": "name"}[col]
            continue
        suffix = col[len(indicator):] if col.startswith(indicator) else col
        if suffix == "涨跌幅":
            rename[col] = "change_percent"
        elif suffix in _FUND_FLOW_SUFFIX_MAP:
            rename[col] = _FUND_FLOW_SUFFIX_MAP[suffix]
    return df.rename(columns=rename)


def get_individual_fund_flow(stock: str, market: str) -> pd.DataFrame:
    """
    获取个股资金流向历史（东方财富，近 100 个交易日）。

    Args:
        stock: 股票代码，如"600519"
        market: 市场枚举 "sh"|"sz"|"bj"

    返回归一化列名：date/close/change_percent/main_net_inflow/main_net_pct/
    super_large_net_inflow/super_large_net_pct/large_net_inflow/large_net_pct/
    medium_net_inflow/medium_net_pct/small_net_inflow/small_net_pct
    （净额单位：元；净占比单位：%）

    缓存 60s。
    """
    cache_key = f"individual_fund_flow:{market}:{stock}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取个股资金流向: {market}{stock}")

    df = _retry(lambda: ak.stock_individual_fund_flow(stock=stock, market=market))
    df = df.rename(columns=_INDIVIDUAL_FUND_FLOW_COLUMNS)

    _cache.set(cache_key, df, 60)
    return df


def get_market_fund_flow() -> pd.DataFrame:
    """
    获取大盘资金流向历史（沪深两市整体，东方财富）。

    返回归一化列名：date/sh_close/sh_change_percent/sz_close/sz_change_percent/
    main_net_inflow/main_net_pct/super_large_net_inflow/.../small_net_pct
    （净额单位：元；净占比单位：%）

    缓存 300s。
    """
    cached = _cache.get("market_fund_flow")
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log("正在获取大盘资金流向...")

    df = _retry(lambda: ak.stock_market_fund_flow())
    df = df.rename(columns=_MARKET_FUND_FLOW_COLUMNS)

    _cache.set("market_fund_flow", df, 300)
    return df


def get_sector_fund_flow_rank(indicator: str, sector_type: str) -> pd.DataFrame:
    """
    获取板块资金流向排名（东方财富）。

    Args:
        indicator: 统计口径，枚举 "今日"|"5日"|"10日"
        sector_type: 板块类型，枚举 "行业资金流"|"概念资金流"|"地域资金流"

    返回归一化列名：rank/name/change_percent/main_net_inflow/main_net_pct/
    super_large_net_inflow/.../small_net_pct/main_net_inflow_top_stock
    （净额单位：元；净占比单位：%）

    缓存 300s。
    """
    cache_key = f"sector_fund_flow_rank:{indicator}:{sector_type}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log(f"正在获取板块资金流排名: indicator={indicator}, sector_type={sector_type}")

    df = _retry(lambda: ak.stock_sector_fund_flow_rank(indicator=indicator, sector_type=sector_type))
    df = _normalize_sector_fund_flow_rank(df, indicator)

    _cache.set(cache_key, df, 300)
    return df


# ============================================================
# 北向资金（沪深港通）
# ============================================================

_HSGT_INDIVIDUAL_COLUMNS = {
    "持股日期": "date",
    "当日收盘价": "close",
    "当日涨跌幅": "change_percent",
    "持股数量": "hold_shares",
    "持股市值": "hold_market_cap",
    "持股数量占A股百分比": "hold_pct_a_share",
    "今日增持股数": "net_shares_change",
    "今日增持资金": "net_cap_change",
    "今日持股市值变化": "hold_market_cap_change",
}

_HSGT_HIST_COLUMNS = {
    "日期": "date",
    "当日成交净买额": "net_buy_amount",
    "买入成交额": "buy_amount",
    "卖出成交额": "sell_amount",
    "历史累计净买额": "cumulative_net_buy_amount",
    "当日资金流入": "daily_fund_inflow",
    "当日余额": "daily_balance",
    "持股市值": "hold_market_cap",
    "领涨股": "leading_stock",
    "领涨股-涨跌幅": "leading_stock_change_percent",
    "领涨股-代码": "leading_stock_code",
    "沪深300": "hs300",
    "沪深300-涨跌幅": "hs300_change_percent",
}


def get_hsgt_individual(symbol: str) -> pd.DataFrame:
    """
    获取个股北向持股历史（东方财富，沪深港通持股统计）。

    Args:
        symbol: 股票代码裸码，如"002008"

    返回归一化列名：date/close/change_percent/hold_shares/hold_market_cap/
    hold_pct_a_share/net_shares_change/net_cap_change/hold_market_cap_change
    （持股数量单位：股；持股市值/今日增持资金单位：元；涨跌幅/占比单位：%）

    缓存 3600s（北向数据日频更新）。
    """
    cache_key = f"hsgt_individual:{symbol}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _single_limiter.wait()
    _log(f"正在获取北向个股持股: {symbol}")

    df = _retry(lambda: ak.stock_hsgt_individual_em(symbol=symbol))
    df = df.rename(columns=_HSGT_INDIVIDUAL_COLUMNS)

    _cache.set(cache_key, df, 3600)
    return df


def get_hsgt_hist(fund_type: str) -> pd.DataFrame:
    """
    获取沪深港通资金流向历史（东方财富）。

    Args:
        fund_type: 资金类型枚举 "北向资金"|"沪股通"|"深股通"|"南向资金"|"港股通沪"|"港股通深"

    返回归一化列名：date/net_buy_amount/buy_amount/sell_amount/cumulative_net_buy_amount/
    daily_fund_inflow/daily_balance/hold_market_cap/leading_stock/leading_stock_change_percent/
    leading_stock_code/hs300/hs300_change_percent
    （net_buy_amount/buy_amount/sell_amount/daily_fund_inflow/daily_balance 单位：亿元；
    cumulative_net_buy_amount 单位：万亿元；hold_market_cap 单位：元）

    注意：交易所自 2024-08-19 起不再披露沪深港通每日资金流明细，此后
    net_buy_amount/buy_amount/sell_amount/daily_fund_inflow/daily_balance 均为 null，
    仅 hold_market_cap（持股市值）等季度持仓数据仍有更新。

    缓存 3600s。
    """
    cache_key = f"hsgt_hist:{fund_type}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _bulk_limiter.wait()
    _log(f"正在获取沪深港通资金流向历史: {fund_type}")

    df = _retry(lambda: ak.stock_hsgt_hist_em(symbol=fund_type))
    df = df.rename(columns=_HSGT_HIST_COLUMNS)

    _cache.set(cache_key, df, 3600)
    return df
