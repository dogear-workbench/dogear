"""
财报数据获取模块

通过 AKShare 获取个股财务数据，格式化后返回。
"""

import sys
import pandas as pd
from utils.akshare_client import (
    get_financial_abstract,
    get_stock_spot_xq,
    get_stock_basic_xq,
    get_industry_pe_cninfo,
)


def _log(msg: str):
    print(f"[financials] {msg}", file=sys.stderr, flush=True)


def _safe_float(val) -> float | None:
    """安全转换数值，支持中文单位（亿/万）和百分号"""
    if val is None or val is False:
        return None
    if isinstance(val, (int, float)):
        if pd.isna(val):
            return None
        return float(val)
    s = str(val).strip()
    if not s or s.lower() in ('none', 'false', '-', '--'):
        return None
    # 去除百分号
    if s.endswith('%'):
        try:
            return float(s[:-1])
        except ValueError:
            return None
    # 处理中文单位
    multiplier = 1.0
    if s.endswith('亿'):
        multiplier = 1e8
        s = s[:-1]
    elif s.endswith('万'):
        multiplier = 1e4
        s = s[:-1]
    try:
        return float(s) * multiplier
    except (ValueError, TypeError):
        return None


def get_financials(symbol: str, periods: int = 4) -> dict:
    """
    获取个股财报摘要数据。

    Args:
        symbol: 股票代码（如"600519"）
        periods: 返回的报告期数（默认4期）

    Returns:
        {
            "symbol": "600519",
            "periods": [
                {
                    "report_date": "2025-12-31",
                    "revenue": 150560000000,
                    "revenue_yoy": 15.2,
                    "revenue_mom": 3.4,
                    "net_profit": 74730000000,
                    "net_profit_yoy": 12.8,
                    "roe": 32.5,
                    "gross_margin": 91.8,
                    "debt_ratio": 25.3,
                    "eps": 59.53,
                    "bvps": 183.2,
                },
                ...
            ]
        }
    """
    _log(f"获取财报: {symbol}, 期数={periods}")

    try:
        df = get_financial_abstract(symbol)
    except Exception as e:
        _log(f"获取财报失败: {e}")
        return {"symbol": symbol, "periods": [], "error": str(e)}

    if df is None or df.empty:
        return {"symbol": symbol, "periods": []}

    # 列名来自 akshare_client.get_financial_abstract 归一化后的宽表
    # （stock_financial_abstract_new_ths 升级版，每个指标额外带 _yoy/_mom/_single_yoy 衍生列）
    column_map = {
        '报告期': 'report_date',
        '营业总收入': 'revenue',
        '营业总收入_yoy': 'revenue_yoy',
        '营业总收入_mom': 'revenue_mom',
        '营业总收入_single_yoy': 'revenue_single_yoy',
        '归属净利润': 'net_profit',
        '归属净利润_yoy': 'net_profit_yoy',
        '归属净利润_mom': 'net_profit_mom',
        '归属净利润_single_yoy': 'net_profit_single_yoy',
        '扣非净利润': 'net_profit_deducted',
        '扣非净利润_yoy': 'net_profit_deducted_yoy',
        '基本每股收益': 'eps',
        '基本每股收益_yoy': 'eps_yoy',
        '每股净资产': 'bvps',
        '净资产收益率': 'roe',
        '净资产收益率_yoy': 'roe_yoy',
        '净资产收益率-摊薄': 'roe_diluted',
        '净资产收益率-摊薄_yoy': 'roe_diluted_yoy',
        '销售毛利率': 'gross_margin',
        '销售毛利率_yoy': 'gross_margin_yoy',
        '销售净利率': 'net_margin',
        '销售净利率_yoy': 'net_margin_yoy',
        '资产负债率': 'debt_ratio',
        '资产负债率_yoy': 'debt_ratio_yoy',
        '每股经营现金流': 'operating_cash_flow_per_share',
        '每股经营现金流_yoy': 'operating_cash_flow_per_share_yoy',
    }

    # 取最近 N 期（数据按时间正序排列，tail 取最新，倒序使最新在前）
    df_recent = df.tail(periods).iloc[::-1]

    result_periods = []
    for _, row in df_recent.iterrows():
        period_data = {}
        for cn_name, en_name in column_map.items():
            if cn_name in df.columns:
                val = row.get(cn_name)
                if en_name == 'report_date':
                    period_data[en_name] = str(val) if val is not None else None
                else:
                    period_data[en_name] = _safe_float(val)

        result_periods.append(period_data)

    return {"symbol": symbol, "periods": result_periods}


def _parse_kv_df(df: pd.DataFrame) -> dict:
    """将 key-value 格式的 DataFrame（columns: item/value 或 项目/值）转为 dict"""
    result = {}
    if df is None or df.empty:
        return result
    cols = df.columns.tolist()
    key_col = cols[0]
    val_col = cols[1]
    for _, row in df.iterrows():
        k = str(row[key_col]).strip()
        result[k] = row[val_col]
    return result


def _symbol_to_xq(symbol: str) -> str:
    """股票代码转雪球前缀格式：6/9开头→SH，其余→SZ"""
    if symbol.startswith(('6', '9')):
        return f"SH{symbol}"
    return f"SZ{symbol}"


# 雪球行业名 → 证监会行业名的映射（覆盖常见无法自动匹配的行业）
_XQ_TO_CNINFO_INDUSTRY = {
    '光学光电子': '计算机、通信和其他电子设备制造业',
    '半导体': '计算机、通信和其他电子设备制造业',
    '消费电子': '计算机、通信和其他电子设备制造业',
    '元件': '计算机、通信和其他电子设备制造业',
    '电子化学品': '化学原料和化学制品制造业',
    '化学制品': '化学原料和化学制品制造业',
    '化学原料': '化学原料和化学制品制造业',
    '白酒': '酒、饮料和精制茶制造业',
    '啤酒': '酒、饮料和精制茶制造业',
    '饮料乳品': '酒、饮料和精制茶制造业',
    '食品加工': '农副食品加工业',
    '调味发酵品': '食品制造业',
    '中药': '医药制造业',
    '化学制药': '医药制造业',
    '生物制品': '医药制造业',
    '医疗器械': '专用设备制造业',
    '医药商业': '零售业',
    '汽车整车': '汽车制造业',
    '汽车零部件': '汽车制造业',
    '电力设备': '电气机械和器材制造业',
    '电池': '电气机械和器材制造业',
    '光伏设备': '电气机械和器材制造业',
    '银行': '货币金融服务',
    '证券': '资本市场服务',
    '保险': '保险业',
    '房地产开发': '房地产业',
    '煤炭开采': '煤炭开采和洗选业',
    '钢铁': '黑色金属冶炼和压延加工业',
    '贵金属': '有色金属冶炼和压延加工业',
    '铝': '有色金属冶炼和压延加工业',
    '铜': '有色金属冶炼和压延加工业',
    '工业金属': '有色金属冶炼和压延加工业',
    '水泥建材': '非金属矿物制品业',
    '装修建材': '非金属矿物制品业',
    '通信设备': '计算机、通信和其他电子设备制造业',
    '计算机设备': '计算机、通信和其他电子设备制造业',
    '软件开发': '软件和信息技术服务业',
    'IT服务': '软件和信息技术服务业',
    '游戏': '互联网和相关服务',
    '互联网电商': '互联网和相关服务',
    '航空装备': '铁路、船舶、航空航天和其他运输设备制造业',
    '船舶制造': '铁路、船舶、航空航天和其他运输设备制造业',
    '航空运输': '航空运输业',
    '航运港口': '水上运输业',
    '电力': '电力、热力生产和供应业',
    '燃气': '燃气生产和供应业',
    '环保': '生态保护和环境治理业',
    '专用设备': '专用设备制造业',
    '通用设备': '通用设备制造业',
    '仪器仪表': '仪器仪表制造业',
    '纺织制造': '纺织业',
    '服装家纺': '纺织服装、服饰业',
    '家用轻工': '造纸和纸制品业',
    '橡胶': '橡胶和塑料制品业',
    '塑料': '橡胶和塑料制品业',
}


def _match_industry_code(industry_name: str, pe_df: pd.DataFrame) -> pd.Series | None:
    """
    在巨潮行业PE数据中匹配行业。

    匹配策略（按优先级）：
    1. 硬编码映射表（雪球行业名 → 证监会行业名）
    2. 精确匹配
    3. 模糊匹配（互相包含）
    4. 关键词匹配（拆分行业名中的关键词搜索）
    """
    name_col = '行业名称' if '行业名称' in pe_df.columns else pe_df.columns[4]
    # 只取层级2（二级行业），更精确
    level_col = '行业层级' if '行业层级' in pe_df.columns else None
    if level_col:
        pe_l2 = pe_df[pe_df[level_col] == 2.0]
    else:
        pe_l2 = pe_df

    # 1. 硬编码映射
    mapped_name = _XQ_TO_CNINFO_INDUSTRY.get(industry_name)
    if mapped_name:
        exact = pe_l2[pe_l2[name_col] == mapped_name]
        if not exact.empty:
            return exact.iloc[0]

    # 2. 精确匹配
    exact = pe_l2[pe_l2[name_col] == industry_name]
    if not exact.empty:
        return exact.iloc[0]

    # 3. 模糊匹配：巨潮行业名包含雪球行业名
    candidates = pe_l2[pe_l2[name_col].astype(str).str.contains(industry_name, na=False)]
    if not candidates.empty:
        lengths = candidates[name_col].astype(str).str.len()
        return candidates.loc[lengths.idxmin()]

    # 4. 反向模糊：雪球行业名包含巨潮行业名
    for idx, row in pe_l2.iterrows():
        if str(row[name_col]) in industry_name:
            return row

    # 5. 关键词匹配：拆分雪球行业名的每个字/词去搜
    for keyword in [industry_name[:2], industry_name[-2:]]:
        if len(keyword) >= 2:
            kw_match = pe_l2[pe_l2[name_col].astype(str).str.contains(keyword, na=False)]
            if not kw_match.empty:
                lengths = kw_match[name_col].astype(str).str.len()
                return kw_match.loc[lengths.idxmin()]

    return None


def compare_industry(symbol: str, metrics: list[str] = None) -> dict:
    """
    将个股与同行业其他股票对比。

    数据源：
    - 个股基本信息：雪球（stock_individual_basic_info_xq）
    - 个股实时行情：雪球（stock_individual_spot_xq）
    - 行业PE统计：巨潮资讯（stock_industry_pe_ratio_cninfo）

    Args:
        symbol: 股票代码
        metrics: 对比指标，默认 ["pe", "pb", "market_cap"]

    Returns:
        {
            "symbol": "600519",
            "name": "贵州茅台",
            "industry": "白酒",
            "industry_count": 18,
            "metrics": {
                "pe": {"value": 28.5, "industry_avg": 35.2, "industry_median": 30.1, "rank": 0, "total": 18},
                ...
            }
        }
    """
    if metrics is None:
        metrics = ["pe", "pb", "market_cap"]

    _log(f"行业对比: {symbol}, 指标={metrics}")

    # ---- 1. 获取个股基本信息（雪球：行业名称、公司名） ----
    xq_symbol = _symbol_to_xq(symbol)
    try:
        basic_df = get_stock_basic_xq(xq_symbol)
        basic = _parse_kv_df(basic_df)
    except Exception as e:
        _log(f"获取雪球基本信息失败: {e}")
        return {"symbol": symbol, "error": f"获取个股信息失败: {e}"}

    stock_name = basic.get("org_short_name_cn", symbol)
    # 行业信息在 affiliate_industry 字段（dict: {ind_code, ind_name}）
    affiliate = basic.get("affiliate_industry")
    if isinstance(affiliate, dict):
        industry = affiliate.get("ind_name", "")
    elif isinstance(affiliate, str):
        industry = affiliate
    else:
        industry = ""

    if not industry:
        return {"symbol": symbol, "name": stock_name, "error": "该股票无行业分类信息"}

    # ---- 2. 获取个股实时行情（雪球：PE/PB/换手率等） ----
    try:
        spot_df = get_stock_spot_xq(xq_symbol)
        spot = _parse_kv_df(spot_df)
    except Exception as e:
        _log(f"获取雪球行情失败: {e}")
        spot = {}

    # 雪球字段映射 → 标准指标名
    xq_metric_map = {
        'pe': {
            'keys': ['市盈率(TTM)', '市盈率(动)', '市盈率(静)'],
            'label': 'PE(TTM)',
        },
        'pb': {
            'keys': ['市净率'],
            'label': 'PB',
        },
        'market_cap': {
            'keys': ['资产净值/总市值'],
            'label': '总市值(亿)',
            'transform': lambda v: round(v / 1e8, 2) if v else None,
        },
        'float_market_cap': {
            'keys': ['流通值'],
            'label': '流通市值(亿)',
            'transform': lambda v: round(v / 1e8, 2) if v else None,
        },
        'turnover_rate': {
            'keys': ['换手率'],
            'label': '换手率',
        },
    }

    def _get_xq_value(metric_name: str) -> float | None:
        """从雪球数据中提取指标值"""
        mapping = xq_metric_map.get(metric_name)
        if not mapping:
            return None
        for key in mapping['keys']:
            val = spot.get(key)
            if val is not None:
                fval = _safe_float(val)
                if fval is not None:
                    transform = mapping.get('transform')
                    return transform(fval) if transform else fval
        return None

    # ---- 3. 获取行业PE数据（巨潮，自动回退最近交易日） ----
    industry_count = 0
    industry_pe_row = None
    try:
        from datetime import date, timedelta
        pe_df = None
        for offset in range(5):  # 最多回退 5 天（跳过周末/假日）
            try_date = (date.today() - timedelta(days=offset)).strftime('%Y%m%d')
            try:
                pe_df = get_industry_pe_cninfo(try_date)
                if pe_df is not None and not pe_df.empty:
                    _log(f"使用行业PE数据日期: {try_date}")
                    break
            except Exception:
                continue
        if pe_df is not None and not pe_df.empty:
            industry_pe_row = _match_industry_code(industry, pe_df)
            if industry_pe_row is not None:
                count_val = industry_pe_row.get('公司数量')
                industry_count = int(count_val) if count_val is not None and not pd.isna(count_val) else 0
    except Exception as e:
        _log(f"获取行业PE数据失败: {e}")

    # ---- 4. 构建对比结果 ----
    result_metrics = {}
    for metric in metrics:
        my_value = _get_xq_value(metric)

        if metric == 'pe' and industry_pe_row is not None:
            # 巨潮数据有行业PE统计
            pe_weighted = _safe_float(industry_pe_row.get('静态市盈率-加权平均'))
            pe_median = _safe_float(industry_pe_row.get('静态市盈率-中位数'))
            pe_avg = _safe_float(industry_pe_row.get('静态市盈率-算术平均'))
            profit_count = industry_pe_row.get('盈利公司数量')
            total = int(profit_count) if profit_count is not None and not pd.isna(profit_count) else industry_count

            result_metrics[metric] = {
                "value": my_value,
                "industry_avg": pe_avg,
                "industry_median": pe_median,
                "industry_weighted_avg": pe_weighted,
                "rank": 0,
                "total": total,
            }
        elif metric == 'market_cap' and industry_pe_row is not None:
            # 巨潮数据有行业总市值
            ind_total_mv = _safe_float(industry_pe_row.get('总市值-静态'))
            ind_avg_mv = round(ind_total_mv / industry_count, 2) if ind_total_mv and industry_count > 0 else None

            result_metrics[metric] = {
                "value": my_value,
                "industry_avg": ind_avg_mv,
                "industry_median": None,
                "rank": 0,
                "total": industry_count,
            }
        else:
            # 其他指标只有个股值，无行业统计
            result_metrics[metric] = {
                "value": my_value,
                "industry_avg": None,
                "industry_median": None,
                "rank": 0,
                "total": industry_count,
            }

    return {
        "symbol": symbol,
        "name": stock_name,
        "industry": industry,
        "industry_count": industry_count,
        "metrics": result_metrics,
    }
