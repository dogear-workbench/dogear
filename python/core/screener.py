"""
选股筛选引擎

从全 A 股市场中按条件筛选股票。
支持基本面条件（PE/PB/市值/行业）和技术指标条件（RSI/MACD 等）。
"""

import sys
import pandas as pd
from utils.akshare_client import get_all_a_stocks, get_stock_hist
from .indicators import calculate as calc_indicators
from .protocol import send_progress


def _log(msg: str):
    print(f"[screener] {msg}", file=sys.stderr, flush=True)


def screen_stocks(conditions: dict, request_id: str = "", limit: int = 20) -> dict:
    """
    全市场条件筛选。

    Args:
        conditions: 筛选条件，支持以下字段:
            - industry: str          行业名称（如"食品饮料"）
            - price_min/price_max: float  价格区间
            - pe_min/pe_max: float   市盈率区间
            - pb_min/pb_max: float   市净率区间
            - market_cap_min/market_cap_max: float  总市值区间（亿元）
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
            "stocks": [...]
        }
    """
    _log(f"开始筛选, 条件: {conditions}, limit={limit}")

    # 1. 获取全 A 股快照
    df = get_all_a_stocks()
    total_scanned = len(df)

    if request_id:
        send_progress(request_id, 1, 5, f"已获取 {total_scanned} 只 A 股数据")

    # 列名映射（AKShare stock_zh_a_spot_em 的中文列名）
    col_map = {
        'code': '代码',
        'name': '名称',
        'price': '最新价',
        'change_percent': '涨跌幅',
        'pe': '市盈率-动态',
        'pb': '市净率',
        'market_cap': '总市值',
        'float_market_cap': '流通市值',
        'turnover_rate': '换手率',
        'turnover': '成交额',
        'volume': '成交量',
        'industry': '所属行业',
        'high_52w': '52周最高',
        'low_52w': '52周最低',
    }

    # 找到实际存在的列名
    actual_cols = {}
    for key, cn_name in col_map.items():
        if cn_name in df.columns:
            actual_cols[key] = cn_name

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

    # 市值过滤（数据单位是元，条件单位是亿元）
    if 'market_cap' in actual_cols:
        mc_col = actual_cols['market_cap']
        filtered[mc_col] = pd.to_numeric(filtered[mc_col], errors='coerce')
        if 'market_cap_min' in conditions:
            filtered = filtered[filtered[mc_col] >= conditions['market_cap_min'] * 1e8]
        if 'market_cap_max' in conditions:
            filtered = filtered[filtered[mc_col] <= conditions['market_cap_max'] * 1e8]

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
    technical_conditions = conditions.get('technical', [])
    tech_results = {}

    if technical_conditions and len(filtered) > 0:
        # 限制技术筛选的候选数量，避免过多 API 调用
        max_tech_candidates = min(len(filtered), 100)
        candidates = filtered.head(max_tech_candidates)
        tech_passed_codes = []

        _log(f"开始技术指标筛选: {len(candidates)} 只候选")

        for idx, (_, row) in enumerate(candidates.iterrows()):
            code = str(row.get(actual_cols.get('code', '代码'), ''))
            name = str(row.get(actual_cols.get('name', '名称'), ''))

            if request_id and idx % 10 == 0:
                send_progress(request_id, 3, 5,
                    f"技术指标筛选中... {idx}/{len(candidates)} ({name})")

            try:
                # 获取K线（使用 AKShare 备用源）
                hist_df = get_stock_hist(code, period="daily")

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
                    tech_passed_codes.append(code)
                    tech_results[code] = stock_tech_data

            except Exception as e:
                _log(f"技术筛选跳过 {code}: {e}")
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
        code = str(row.get(actual_cols.get('code', ''), ''))
        market = 1 if code.startswith('6') or code.startswith('688') else 0

        stock = {
            'code': code,
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
                        stock[key] = round(float(val) / 1e8, 2)  # 转为亿
                    except Exception:
                        stock[key] = None
                else:
                    try:
                        fval = float(val)
                        stock[key] = round(fval, 2) if val is not None and not pd.isna(fval) else None
                    except Exception:
                        stock[key] = str(val) if val is not None else None

        # 添加技术指标数据
        if code in tech_results:
            stock['technical_data'] = tech_results[code]

        stocks.append(stock)

    if request_id:
        send_progress(request_id, 5, 5, "筛选结果已准备好")

    return {
        "total_scanned": total_scanned,
        "total_matched": total_matched,
        "returned": len(stocks),
        "stocks": stocks,
        "_source": df.attrs.get("_source"),
    }
