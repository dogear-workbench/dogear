"""
选股筛选引擎

从全 A 股市场中按条件筛选股票。
支持基本面条件（PE/PB/市值/行业）和技术指标条件（RSI/MACD 等）。

数据源：core.snapshot.get_snapshot()（baostock 全 A 日快照 + 本地缓存），
字段沿用 baostock 原始命名（peTTM/pbMRQ/turn/pctChg 等），行业分类另从
utils.baostock_client.get_industry_map() join 补齐（snapshot 本身不含行业列）。

MVP 限制：snapshot 的 total_market_cap/float_market_cap 为 NaN 占位（无可靠
股本数据源），传入 market_cap_min/max 条件时会被忽略并在返回结果里附带
warnings 提示，不会误伤成 0 结果。
"""

import sys
import pandas as pd
from core.snapshot import get_snapshot
from utils.akshare_client import get_stock_hist
from utils.baostock_client import get_industry_map
from .indicators import calculate as calc_indicators
from .protocol import send_progress


def _log(msg: str):
    print(f"[screener] {msg}", file=sys.stderr, flush=True)


def screen_stocks(conditions: dict, request_id: str = "", limit: int = 20) -> dict:
    """
    全市场条件筛选。

    Args:
        conditions: 筛选条件，支持以下字段:
            - industry: str          行业名称（如"银行"）
            - price_min/price_max: float  价格区间
            - pe_min/pe_max: float   市盈率区间
            - pb_min/pb_max: float   市净率区间
            - market_cap_min/market_cap_max: float  总市值区间（亿元）；
              MVP 阶段快照无股本数据，该条件会被忽略并附带 warnings 提示
            - change_percent_min/max: float  涨跌幅区间
            - turnover_rate_min/max: float  换手率区间
            - technical: list[dict]  技术指标条件，如:
                [{"indicator": "RSI", "condition": "below", "value": 30}]
        request_id: 请求ID（用于发送进度）
        limit: 最大返回条数

    Returns:
        {
            "total_scanned": 5000,
            "total_matched": 25,
            "returned": 5,
            "stocks": [...],
            "warnings": [...],
            "_source": None,
        }
    """
    _log(f"开始筛选, 条件: {conditions}, limit={limit}")

    warnings = []

    # 1. 获取全 A 日快照 + 行业映射 join
    df = get_snapshot(request_id=request_id)
    total_scanned = len(df)

    if request_id:
        send_progress(request_id, 1, 5, f"已获取 {total_scanned} 只 A 股快照数据")

    industry_df = get_industry_map()[['code', 'code_name', 'industry']]
    df = pd.merge(df, industry_df, on='code', how='left')

    # 列名映射（snapshot 用 baostock 原始字段名）
    col_map = {
        'code': 'code',
        'name': 'code_name',
        'price': 'close',
        'change_percent': 'pctChg',
        'pe': 'peTTM',
        'pb': 'pbMRQ',
        'market_cap': 'total_market_cap',
        'float_market_cap': 'float_market_cap',
        'turnover_rate': 'turn',
        'turnover': 'amount',
        'volume': 'volume',
        'industry': 'industry',
    }

    # 找到实际存在的列名
    actual_cols = {}
    for key, col_name in col_map.items():
        if col_name in df.columns:
            actual_cols[key] = col_name

    # 2. 基本面过滤
    filtered = df.copy()

    # 行业过滤
    if 'industry' in conditions and 'industry' in actual_cols:
        industry = conditions['industry']
        filtered = filtered[filtered[actual_cols['industry']] == industry]
        _log(f"行业过滤后: {len(filtered)} 只")

    # 价格过滤
    if 'price' in actual_cols:
        price_col = actual_cols['price']
        filtered[price_col] = pd.to_numeric(filtered[price_col], errors='coerce')
        if 'price_min' in conditions:
            filtered = filtered[filtered[price_col] >= conditions['price_min']]
        if 'price_max' in conditions:
            filtered = filtered[filtered[price_col] <= conditions['price_max']]

    # PE 过滤
    if 'pe' in actual_cols:
        pe_col = actual_cols['pe']
        filtered[pe_col] = pd.to_numeric(filtered[pe_col], errors='coerce')
        if 'pe_min' in conditions:
            filtered = filtered[filtered[pe_col] >= conditions['pe_min']]
        if 'pe_max' in conditions:
            filtered = filtered[filtered[pe_col] <= conditions['pe_max']]
        # 排除负 PE（亏损）
        if conditions.get('exclude_negative_pe', True):
            filtered = filtered[filtered[pe_col] > 0]

    # PB 过滤
    if 'pb' in actual_cols:
        pb_col = actual_cols['pb']
        filtered[pb_col] = pd.to_numeric(filtered[pb_col], errors='coerce')
        if 'pb_min' in conditions:
            filtered = filtered[filtered[pb_col] >= conditions['pb_min']]
        if 'pb_max' in conditions:
            filtered = filtered[filtered[pb_col] <= conditions['pb_max']]

    # 市值过滤（MVP 阶段快照无股本数据，total_market_cap 为 NaN 占位，条件跳过不 raise）
    if 'market_cap' in actual_cols:
        mc_col = actual_cols['market_cap']
        filtered[mc_col] = pd.to_numeric(filtered[mc_col], errors='coerce')
        if 'market_cap_min' in conditions or 'market_cap_max' in conditions:
            _log("MVP 阶段快照无股本数据（total_market_cap 为 NaN 占位），市值筛选条件已跳过")
            warnings.append("market_cap 条件已忽略（MVP 阶段快照无股本数据）")

    # 涨跌幅过滤
    if 'change_percent' in actual_cols:
        cp_col = actual_cols['change_percent']
        filtered[cp_col] = pd.to_numeric(filtered[cp_col], errors='coerce')
        if 'change_percent_min' in conditions:
            filtered = filtered[filtered[cp_col] >= conditions['change_percent_min']]
        if 'change_percent_max' in conditions:
            filtered = filtered[filtered[cp_col] <= conditions['change_percent_max']]

    # 换手率过滤
    if 'turnover_rate' in actual_cols:
        tr_col = actual_cols['turnover_rate']
        filtered[tr_col] = pd.to_numeric(filtered[tr_col], errors='coerce')
        if 'turnover_rate_min' in conditions:
            filtered = filtered[filtered[tr_col] >= conditions['turnover_rate_min']]
        if 'turnover_rate_max' in conditions:
            filtered = filtered[filtered[tr_col] <= conditions['turnover_rate_max']]

    _log(f"基本面过滤后: {len(filtered)} 只")

    if request_id:
        send_progress(request_id, 2, 5, f"基本面过滤完成，剩余 {len(filtered)} 只")

    # 3. 技术指标过滤（如果有）
    # snapshot 的 code 带 sh./sz. 前缀，get_stock_hist（akshare）只吃裸码，调用前需 strip
    technical_conditions = conditions.get('technical', [])
    tech_results = {}

    if technical_conditions and len(filtered) > 0:
        # 限制技术筛选的候选数量，避免过多 API 调用
        max_tech_candidates = min(len(filtered), 100)
        candidates = filtered.head(max_tech_candidates)
        tech_passed_codes = []

        _log(f"开始技术指标筛选: {len(candidates)} 只候选")

        for idx, (_, row) in enumerate(candidates.iterrows()):
            code_full = str(row.get(actual_cols.get('code', 'code'), ''))
            code_bare = code_full.split('.')[-1] if '.' in code_full else code_full
            name = str(row.get(actual_cols.get('name', 'code_name'), ''))

            if request_id and idx % 10 == 0:
                send_progress(request_id, 3, 5,
                    f"技术指标筛选中... {idx}/{len(candidates)} ({name})")

            try:
                # 获取K线（K线仍走 AKShare，接口稳定）
                hist_df = get_stock_hist(code_bare, period="daily")

                if hist_df is None or len(hist_df) < 30:
                    continue

                # 转为指标计算格式
                kline = []
                for _, krow in hist_df.iterrows():
                    kline.append({
                        'date': str(krow.get('日期', krow.get('date', ''))),
                        'open': float(krow.get('开盘', krow.get('open', 0)) or 0),
                        'close': float(krow.get('收盘', krow.get('close', 0)) or 0),
                        'high': float(krow.get('最高', krow.get('high', 0)) or 0),
                        'low': float(krow.get('最低', krow.get('low', 0)) or 0),
                        'volume': float(krow.get('成交量', krow.get('volume', 0)) or 0),
                        'turnover': float(krow.get('成交额', krow.get('turnover', 0)) or 0),
                    })

                # 计算需要的指标
                needed_indicators = list(set(tc['indicator'].upper() for tc in technical_conditions))
                indicators = calc_indicators(kline, needed_indicators)

                # 检查所有技术条件
                all_pass = True
                stock_tech_data = {}

                for tc in technical_conditions:
                    ind_name = tc['indicator'].upper()
                    condition = tc['condition']  # "above", "below"
                    value = tc.get('value')

                    ind_data = indicators.get(ind_name, {})

                    main_key = list(ind_data.keys())[0] if ind_data else None
                    if main_key is None:
                        all_pass = False
                        break

                    arr = ind_data[main_key]
                    last_val = None
                    for v in reversed(arr):
                        if v is not None:
                            last_val = v
                            break

                    if last_val is None:
                        all_pass = False
                        break

                    stock_tech_data[ind_name] = last_val

                    if condition == 'below' and value is not None:
                        if last_val >= value:
                            all_pass = False
                            break
                    elif condition == 'above' and value is not None:
                        if last_val <= value:
                            all_pass = False
                            break

                if all_pass:
                    tech_passed_codes.append(code_full)
                    tech_results[code_full] = stock_tech_data

            except Exception as e:
                _log(f"技术筛选跳过 {code_full}: {e}")
                continue

        # 用技术筛选结果过滤
        if actual_cols.get('code'):
            filtered = filtered[filtered[actual_cols['code']].isin(tech_passed_codes)]

        _log(f"技术指标过滤后: {len(filtered)} 只")

    if request_id:
        send_progress(request_id, 4, 5, f"筛选完成，共 {len(filtered)} 只匹配")

    # 4. 构建返回结果
    total_matched = len(filtered)
    result_df = filtered.head(limit)

    stocks = []
    for _, row in result_df.iterrows():
        code_full = str(row.get(actual_cols.get('code', ''), ''))
        code_bare = code_full.split('.')[-1] if '.' in code_full else code_full

        if code_full.startswith('sh.'):
            market = 1
        elif code_full.startswith('sz.'):
            market = 0
        elif code_full.startswith('bj.'):
            market = 2
        else:
            market = 0

        stock = {
            'code': code_bare,
            'name': str(row.get(actual_cols.get('name', ''), '')),
            'market': market,
        }

        # 添加可用的字段
        for key in ['price', 'change_percent', 'pe', 'pb', 'market_cap',
                     'turnover_rate', 'industry']:
            if key in actual_cols:
                val = row.get(actual_cols[key])
                if key == 'market_cap' and val is not None:
                    try:
                        fval = float(val)
                        stock[key] = None if pd.isna(fval) else round(fval / 1e8, 2)  # 转为亿
                    except Exception:
                        stock[key] = None
                else:
                    try:
                        fval = float(val)
                        stock[key] = round(fval, 2) if val is not None and not pd.isna(fval) else None
                    except Exception:
                        stock[key] = str(val) if val is not None else None

        # 添加技术指标数据
        if code_full in tech_results:
            stock['technical_data'] = tech_results[code_full]

        stocks.append(stock)

    if request_id:
        send_progress(request_id, 5, 5, "筛选结果已准备好")

    return {
        "total_scanned": total_scanned,
        "total_matched": total_matched,
        "returned": len(stocks),
        "stocks": stocks,
        "warnings": warnings,
        "_source": None,
    }
