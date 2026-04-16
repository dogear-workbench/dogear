# Phase 2 实施文档：AKShare 数据扩展 + 选股筛选

> 前置依赖：Phase 1（Python Bridge + 技术指标计算）已完成
> 设计文档：`2026-04-15-stock-analysis-system-design.md`

## 目标

通过 AKShare 接入全市场数据，让 AI 能够获取财报、行业分类，并执行全市场条件筛选。完成后 AI 可以执行：
```
"帮我找 PE 低于 20 的消费股" → ScreenStocks 工具 → 筛选结果
"贵州茅台的财报怎么样" → GetFinancials 工具 → 财报数据
"茅台在白酒行业里排名如何" → CompareIndustry 工具 → 行业对比
```

## 交付物

| 文件 | 类型 | 说明 |
|------|------|------|
| `python/utils/akshare_client.py` | 新建 | AKShare 封装（限流+缓存+错误处理） |
| `python/core/financials.py` | 新建 | 财报数据获取 |
| `python/core/screener.py` | 新建 | 选股筛选引擎 |
| `python/main.py` | 修改 | 注册新方法路由 |
| `python/requirements.txt` | 修改 | 添加 akshare 依赖 |
| `electron/main/agents/tools/stock-analysis-tools.ts` | 修改 | 新增 3 个工具 |
| `electron/main/tipc/stock.ts` | 修改 | 新增 IPC 路由 |

---

## 步骤 1：安装 AKShare 依赖

### 1.1 更新 `python/requirements.txt`

```
pandas>=2.0
numpy>=1.24
akshare>=1.14
```

### 1.2 安装

```bash
pip install akshare
```

---

## 步骤 2：AKShare 客户端封装

### 2.1 `python/utils/akshare_client.py`

职责：封装 AKShare 调用，提供限流、缓存和错误处理。

```python
"""
AKShare 客户端封装

提供限流、TTL 缓存、错误重试，防止因频繁调用被数据源封禁。
AKShare 底层数据源（东方财富、同花顺）有不同的频率限制：
  - 批量接口（stock_zh_a_spot_em）：5s 冷却
  - 单股接口（stock_financial_abstract_ths）：0.5s 间隔
"""

import time
import traceback
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
```

---

## 步骤 3：财报数据获取

### 3.1 `python/core/financials.py`

```python
"""
财报数据获取模块

通过 AKShare 获取个股财务数据，格式化后返回。
"""

import sys
import pandas as pd
from ..utils.akshare_client import get_financial_abstract, get_financial_indicators

def _log(msg: str):
    print(f"[financials] {msg}", file=sys.stderr, flush=True)

def _safe_float(val) -> float | None:
    """安全转换数值"""
    if val is None or pd.isna(val):
        return None
    try:
        return float(val)
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
                    "net_profit": 74730000000,
                    "net_profit_yoy": 12.8,
                    "roe": 32.5,
                    "gross_margin": 91.8,
                    "debt_ratio": 25.3,
                    "eps": 59.53,
                    "bvps": 183.2,
                    "operating_cash_flow": 68200000000,
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
    
    # AKShare 返回的列名可能因版本不同而变化
    # 尝试常见的列名映射
    column_map = {
        '报告期': 'report_date',
        '营业总收入': 'revenue',
        '营业收入': 'revenue',
        '净利润': 'net_profit',
        '归属净利润': 'net_profit',
        '每股收益': 'eps',
        '每股净资产': 'bvps',
        '净资产收益率': 'roe',
        '销售毛利率': 'gross_margin',
        '毛利率': 'gross_margin',
        '资产负债率': 'debt_ratio',
        '营业总收入同比增长': 'revenue_yoy',
        '营收同比': 'revenue_yoy',
        '净利润同比增长': 'net_profit_yoy',
        '净利润同比': 'net_profit_yoy',
        '经营现金流': 'operating_cash_flow',
    }
    
    # 取最近 N 期
    df_recent = df.head(periods)
    
    result_periods = []
    for _, row in df_recent.iterrows():
        period_data = {}
        for cn_name, en_name in column_map.items():
            if cn_name in df.columns:
                period_data[en_name] = _safe_float(row.get(cn_name))
        
        # 确保 report_date 是字符串
        if 'report_date' in period_data and period_data['report_date'] is not None:
            period_data['report_date'] = str(row.get('报告期', ''))
        
        result_periods.append(period_data)
    
    return {"symbol": symbol, "periods": result_periods}


def compare_industry(symbol: str, metrics: list[str] = None) -> dict:
    """
    将个股与同行业其他股票对比。
    
    Args:
        symbol: 股票代码
        metrics: 对比指标，默认 ["pe", "pb", "roe", "revenue_growth", "market_cap"]
    
    Returns:
        {
            "symbol": "600519",
            "name": "贵州茅台",
            "industry": "白酒",
            "industry_count": 18,
            "metrics": {
                "pe": {"value": 28.5, "industry_avg": 35.2, "industry_median": 30.1, "rank": 5, "total": 18},
                "market_cap": {"value": 19200, "industry_avg": 3850, "industry_median": 1200, "rank": 1, "total": 18},
                ...
            }
        }
    """
    if metrics is None:
        metrics = ["pe", "pb", "market_cap"]
    
    _log(f"行业对比: {symbol}, 指标={metrics}")
    
    from ..utils.akshare_client import get_all_a_stocks
    
    # 获取全市场数据
    df = get_all_a_stocks()
    
    if df is None or df.empty:
        return {"symbol": symbol, "error": "无法获取市场数据"}
    
    # AKShare stock_zh_a_spot_em 的列名映射
    # 常见列名：代码、名称、最新价、涨跌幅、市盈率-动态、市净率、总市值、流通市值、所属行业
    code_col = '代码' if '代码' in df.columns else 'code'
    name_col = '名称' if '名称' in df.columns else 'name'
    industry_col = None
    for col_name in ['所属行业', '行业', 'industry']:
        if col_name in df.columns:
            industry_col = col_name
            break
    
    # 查找目标股票
    target = df[df[code_col].astype(str).str.strip() == symbol]
    if target.empty:
        return {"symbol": symbol, "error": f"未找到股票 {symbol}"}
    
    target_row = target.iloc[0]
    stock_name = str(target_row.get(name_col, symbol))
    
    # 如果没有行业字段，无法做行业对比
    if industry_col is None:
        return {"symbol": symbol, "name": stock_name, "error": "数据中无行业字段，无法进行行业对比"}
    
    industry = str(target_row.get(industry_col, ''))
    if not industry:
        return {"symbol": symbol, "name": stock_name, "error": "该股票无行业分类信息"}
    
    # 获取同行业股票
    peers = df[df[industry_col] == industry].copy()
    industry_count = len(peers)
    
    # 指标名到列名的映射
    metric_col_map = {
        'pe': ['市盈率-动态', '市盈率', 'pe'],
        'pb': ['市净率', 'pb'],
        'market_cap': ['总市值', 'total_market_cap'],
        'float_market_cap': ['流通市值', 'float_market_cap'],
        'turnover_rate': ['换手率', 'turnover_rate'],
        'change_percent': ['涨跌幅', 'change_percent'],
    }
    
    result_metrics = {}
    for metric in metrics:
        col_candidates = metric_col_map.get(metric, [metric])
        col = None
        for c in col_candidates:
            if c in peers.columns:
                col = c
                break
        
        if col is None:
            result_metrics[metric] = {"error": f"未找到列: {metric}"}
            continue
        
        # 转为数值，排除无效值
        series = pd.to_numeric(peers[col], errors='coerce')
        valid = series.dropna()
        
        if valid.empty:
            result_metrics[metric] = {"error": "无有效数据"}
            continue
        
        my_value = _safe_float(target_row.get(col))
        
        result_metrics[metric] = {
            "value": my_value,
            "industry_avg": round(float(valid.mean()), 2),
            "industry_median": round(float(valid.median()), 2),
            "industry_min": round(float(valid.min()), 2),
            "industry_max": round(float(valid.max()), 2),
            "rank": int((valid.rank(ascending=False).get(target.index[0], 0))),
            "total": len(valid),
        }
    
    return {
        "symbol": symbol,
        "name": stock_name,
        "industry": industry,
        "industry_count": industry_count,
        "metrics": result_metrics,
    }
```

---

## 步骤 4：选股筛选引擎

### 4.1 `python/core/screener.py`

```python
"""
选股筛选引擎

从全 A 股市场中按条件筛选股票。
支持基本面条件（PE/PB/市值/行业）和技术指标条件（RSI/MACD 等）。
"""

import sys
import pandas as pd
from ..utils.akshare_client import get_all_a_stocks, get_stock_hist
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
            "stocks": [
                {"code": "000858", "name": "五粮液", "market": 0, "price": 148.5, 
                 "pe": 18.2, "pb": 4.5, "market_cap": 5762.0, "change_percent": 1.2,
                 "industry": "白酒", "turnover_rate": 0.85,
                 "technical_data": {"RSI": 27.5, ...}  # 如果有技术条件
                },
                ...
            ]
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
    
    # 反向映射：找到实际存在的列名
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
                # 确定市场代码
                market = 1 if code.startswith('6') or code.startswith('688') else 0
                
                # 获取K线（使用 AKShare 备用源，避免东方财富限流）
                hist_df = get_stock_hist(code, period="daily")
                
                if hist_df is None or len(hist_df) < 30:
                    continue
                
                # 转为指标计算格式
                kline = []
                for _, krow in hist_df.iterrows():
                    kline.append({
                        'date': str(krow.get('日期', krow.get('date', ''))),
                        'open': float(krow.get('开盘', krow.get('open', 0))),
                        'close': float(krow.get('收盘', krow.get('close', 0))),
                        'high': float(krow.get('最高', krow.get('high', 0))),
                        'low': float(krow.get('最低', krow.get('low', 0))),
                        'volume': float(krow.get('成交量', krow.get('volume', 0))),
                        'turnover': float(krow.get('成交额', krow.get('turnover', 0))),
                    })
                
                # 计算需要的指标
                needed_indicators = list(set(tc['indicator'].upper() for tc in technical_conditions))
                indicators = calc_indicators(kline, needed_indicators)
                
                # 检查所有技术条件
                all_pass = True
                stock_tech_data = {}
                
                for tc in technical_conditions:
                    ind_name = tc['indicator'].upper()
                    condition = tc['condition']  # "above", "below", "cross_above", "cross_below"
                    value = tc.get('value')
                    
                    ind_data = indicators.get(ind_name, {})
                    
                    # 获取主要值（第一个 key 的最后一个值）
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
                    except:
                        stock[key] = None
                else:
                    try:
                        stock[key] = round(float(val), 2) if val is not None and not pd.isna(val) else None
                    except:
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
    }
```

---

## 步骤 5：更新 Python 主进程

### 5.1 修改 `python/main.py`

在 `METHOD_HANDLERS` 中新增三个方法：

```python
# 在文件顶部添加导入
from core.financials import get_financials, compare_industry
from core.screener import screen_stocks

# 新增 handler 函数
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

# 更新路由表
METHOD_HANDLERS = {
    "ping": handle_ping,
    "calc_indicators": handle_calc_indicators,
    "get_financials": handle_get_financials,          # 新增
    "compare_industry": handle_compare_industry,      # 新增
    "screen_stocks": handle_screen_stocks,            # 新增
}
```

---

## 步骤 6：TypeScript 层 — 新增 Agent 工具

### 6.1 修改 `electron/main/agents/tools/stock-analysis-tools.ts`

在 `registerTools` 数组中追加 3 个工具元数据：

```typescript
registerTools([
  { name: 'CalcIndicators', description: '计算股票技术指标...', server: 'dogear-stock-analysis', category: 'stock' },
  // Phase 2 新增:
  { name: 'ScreenStocks', description: '全市场条件筛选股票', server: 'dogear-stock-analysis', category: 'stock' },
  { name: 'GetFinancials', description: '获取个股财报数据', server: 'dogear-stock-analysis', category: 'stock' },
  { name: 'CompareIndustry', description: '个股行业对比分析', server: 'dogear-stock-analysis', category: 'stock' },
]);
```

在 `createStockAnalysisTools` 函数的 `tools` 数组中追加 3 个工具：

```typescript
// ========================================
// 工具: 全市场筛选
// ========================================
tool(
  'ScreenStocks',
  '全市场 A 股条件筛选。\n' +
  '支持基本面条件（行业、PE、PB、市值、价格）和技术指标条件（RSI、MACD 等）。\n' +
  '先用基本面条件缩小范围，再用技术条件精选，性能更优。\n' +
  '使用场景: 用户要求按特定条件选股，如"找PE低于20的消费股"。\n' +
  '注意: 技术指标筛选需要逐股获取K线数据，候选超过100只时会自动截断。',
  {
    conditions: z.object({
      industry: z.string().optional().describe('行业名称（如"食品饮料"、"银行"）'),
      price_min: z.number().optional().describe('最低价格'),
      price_max: z.number().optional().describe('最高价格'),
      pe_min: z.number().optional().describe('最低市盈率'),
      pe_max: z.number().optional().describe('最高市盈率'),
      pb_min: z.number().optional().describe('最低市净率'),
      pb_max: z.number().optional().describe('最高市净率'),
      market_cap_min: z.number().optional().describe('最低总市值（亿元）'),
      market_cap_max: z.number().optional().describe('最高总市值（亿元）'),
      change_percent_min: z.number().optional().describe('最低涨跌幅（%）'),
      change_percent_max: z.number().optional().describe('最高涨跌幅（%）'),
      turnover_rate_min: z.number().optional().describe('最低换手率（%）'),
      turnover_rate_max: z.number().optional().describe('最高换手率（%）'),
      exclude_negative_pe: z.boolean().optional().default(true).describe('是否排除亏损股（PE<0）'),
      technical: z.array(z.object({
        indicator: z.string().describe('指标名（RSI/MACD/KDJ/BOLL等）'),
        condition: z.enum(['above', 'below']).describe('条件（above=大于/below=小于）'),
        value: z.number().optional().describe('阈值'),
      })).optional().describe('技术指标条件'),
    }),
    limit: z.number().min(1).max(50).default(20).describe('最大返回条数'),
  },
  async (args) => {
    try {
      const result = await pythonBridge.call<{
        total_scanned: number;
        total_matched: number;
        returned: number;
        stocks: Array<{
          code: string; name: string; market: number;
          price?: number; pe?: number; pb?: number;
          market_cap?: number; change_percent?: number;
          industry?: string; turnover_rate?: number;
          technical_data?: Record<string, number>;
        }>;
      }>('screen_stocks', {
        conditions: args.conditions,
        limit: args.limit,
      }, 120_000);  // 筛选超时 120s

      if (result.stocks.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `筛选完成：扫描 ${result.total_scanned} 只股票，无匹配结果。\n请尝试放宽条件。`,
          }],
        };
      }

      // 格式化表格
      const header = '代码 | 名称 | 价格 | 涨跌幅 | PE | PB | 市值(亿) | 行业';
      const separator = '---|---|---|---|---|---|---|---';
      const rows = result.stocks.map((s) =>
        `${s.code} | ${s.name} | ${safe(s.price)} | ${safe(s.change_percent)}% | ${safe(s.pe)} | ${safe(s.pb)} | ${safe(s.market_cap)} | ${s.industry || '-'}`
      );

      let output = `筛选结果（扫描 ${result.total_scanned} 只，匹配 ${result.total_matched} 只，返回 ${result.returned} 只）：\n`;
      output += `${header}\n${separator}\n${rows.join('\n')}`;

      // 如果有技术指标数据，附加说明
      const withTech = result.stocks.filter(s => s.technical_data);
      if (withTech.length > 0) {
        const techLines = withTech.map(s => {
          const parts = Object.entries(s.technical_data!).map(([k, v]) => `${k}=${safe(v)}`);
          return `  ${s.name}: ${parts.join(', ')}`;
        });
        output += `\n\n技术指标数据：\n${techLines.join('\n')}`;
      }

      return {
        content: [{ type: 'text' as const, text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `筛选失败: ${error}` }],
        isError: true,
      };
    }
  }
),

// ========================================
// 工具: 获取财报数据
// ========================================
tool(
  'GetFinancials',
  '获取个股财报数据（营收、净利润、ROE、毛利率等）。\n' +
  '数据来源: 同花顺财报摘要，通过 AKShare 获取。\n' +
  '使用场景: 用户想了解某只股票的基本面数据、财务健康状况。',
  {
    market: z.number().describe('市场代码（1=沪市 0=深市）'),
    code: z.string().describe('股票代码（如"600519"）'),
    periods: z.number().min(1).max(8).default(4).describe('返回最近几期报告（默认4期）'),
  },
  async (args) => {
    try {
      const result = await pythonBridge.call<{
        symbol: string;
        periods: Array<Record<string, number | string | null>>;
        error?: string;
      }>('get_financials', {
        symbol: args.code,
        periods: args.periods,
      }, 30_000);

      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `获取财报失败: ${result.error}` }],
          isError: true,
        };
      }

      if (result.periods.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `未找到 ${args.code} 的财报数据。` }],
        };
      }

      // 格式化表格
      const fields = [
        { key: 'report_date', label: '报告期' },
        { key: 'revenue', label: '营收', format: (v: number) => v > 1e8 ? `${(v/1e8).toFixed(1)}亿` : `${(v/1e4).toFixed(0)}万` },
        { key: 'revenue_yoy', label: '营收同比', format: (v: number) => `${v.toFixed(1)}%` },
        { key: 'net_profit', label: '净利润', format: (v: number) => v > 1e8 ? `${(v/1e8).toFixed(1)}亿` : `${(v/1e4).toFixed(0)}万` },
        { key: 'net_profit_yoy', label: '净利润同比', format: (v: number) => `${v.toFixed(1)}%` },
        { key: 'roe', label: 'ROE', format: (v: number) => `${v.toFixed(1)}%` },
        { key: 'gross_margin', label: '毛利率', format: (v: number) => `${v.toFixed(1)}%` },
        { key: 'debt_ratio', label: '资产负债率', format: (v: number) => `${v.toFixed(1)}%` },
        { key: 'eps', label: '每股收益', format: (v: number) => v.toFixed(2) },
      ];

      let output = `=== ${args.code} 财务数据 ===\n`;
      
      for (const field of fields) {
        const values = result.periods.map(p => {
          const v = p[field.key];
          if (v === null || v === undefined) return '-';
          if (field.format && typeof v === 'number') return field.format(v);
          return String(v);
        });
        output += `${field.label}: ${values.join(' | ')}\n`;
      }

      return {
        content: [{ type: 'text' as const, text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `获取财报失败: ${error}` }],
        isError: true,
      };
    }
  }
),

// ========================================
// 工具: 行业对比
// ========================================
tool(
  'CompareIndustry',
  '将个股与同行业其他股票对比，显示排名、行业均值/中位数。\n' +
  '使用场景: 用户想知道某只股票在行业中的估值水平。',
  {
    market: z.number().describe('市场代码（1=沪市 0=深市）'),
    code: z.string().describe('股票代码'),
    metrics: z.array(z.string()).optional().default(['pe', 'pb', 'market_cap'])
      .describe('对比指标，可选: pe/pb/market_cap/float_market_cap/turnover_rate/change_percent'),
  },
  async (args) => {
    try {
      const result = await pythonBridge.call<{
        symbol: string;
        name: string;
        industry: string;
        industry_count: number;
        metrics: Record<string, {
          value: number | null;
          industry_avg: number;
          industry_median: number;
          rank: number;
          total: number;
          error?: string;
        }>;
        error?: string;
      }>('compare_industry', {
        symbol: args.code,
        metrics: args.metrics,
      }, 30_000);

      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `行业对比失败: ${result.error}` }],
          isError: true,
        };
      }

      let output = `=== ${result.name}(${result.symbol}) vs ${result.industry}行业（共 ${result.industry_count} 只） ===\n\n`;
      output += `指标 | 本股 | 行业均值 | 行业中位数 | 排名\n`;
      output += `---|---|---|---|---\n`;

      const metricLabels: Record<string, string> = {
        pe: '市盈率', pb: '市净率', market_cap: '总市值(亿)',
        float_market_cap: '流通市值(亿)', turnover_rate: '换手率(%)',
        change_percent: '涨跌幅(%)',
      };

      for (const [key, data] of Object.entries(result.metrics)) {
        if (data.error) {
          output += `${metricLabels[key] || key} | - | - | - | ${data.error}\n`;
          continue;
        }
        output += `${metricLabels[key] || key} | ${safe(data.value)} | ${safe(data.industry_avg)} | ${safe(data.industry_median)} | ${data.rank}/${data.total}\n`;
      }

      return {
        content: [{ type: 'text' as const, text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `行业对比失败: ${error}` }],
        isError: true,
      };
    }
  }
),
```

---

## 步骤 7：验证

### 7.1 安装 AKShare

```bash
pip install akshare
```

### 7.2 编译 + 测试

```bash
bun run build:electron
bun run dev
```

测试场景：
1. "帮我找 PE 低于 20 的食品饮料行业股票" → ScreenStocks
2. "贵州茅台的财报怎么样" → GetFinancials
3. "茅台在行业里排名如何" → CompareIndustry

### 7.3 错误场景
- AKShare 未安装 → 报错并提示安装
- 网络异常 → 重试 3 次后报错
- 筛选无结果 → 提示放宽条件

---

## 文件修改清单

| 序号 | 操作 | 文件 |
|------|------|------|
| 1 | 修改 | `python/requirements.txt`（添加 akshare） |
| 2 | 新建 | `python/utils/akshare_client.py` |
| 3 | 新建 | `python/core/financials.py` |
| 4 | 新建 | `python/core/screener.py` |
| 5 | 修改 | `python/main.py`（新增 3 个方法路由） |
| 6 | 修改 | `electron/main/agents/tools/stock-analysis-tools.ts`（新增 3 个工具） |
| 7 | 修改 | `electron/main/tipc/stock.ts`（可选，新增前端直接调用的 IPC 路由） |
