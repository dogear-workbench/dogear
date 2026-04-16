# Phase 3 实施文档：公式引擎 + 信号检测

> 前置依赖：Phase 1（Python Bridge）+ Phase 2（AKShare + 指标计算）已完成
> 设计文档：`2026-04-15-stock-analysis-system-design.md`

## 目标

实现用户自定义公式引擎和技术信号自动检测。完成后 AI 可以执行：
```
"帮我检测茅台最近有没有什么技术信号" → DetectSignals 工具
"MACD金叉 + 成交量放大 1.5 倍，帮我存成一个公式" → 公式管理
"用我的'低估值消费'公式筛一下" → EvalFormula 工具
```

## 交付物

| 文件 | 类型 | 说明 |
|------|------|------|
| `python/core/formula_engine.py` | 新建 | 公式解析器 + 安全执行器（lark） |
| `python/core/signals.py` | 新建 | 内置技术信号检测 |
| `python/main.py` | 修改 | 注册新方法路由 |
| `python/requirements.txt` | 修改 | 添加 lark 依赖 |
| `electron/main/services/stock/formula-service.ts` | 新建 | 公式 CRUD 存储 |
| `electron/main/services/stock/index.ts` | 修改 | 导出 formulaService |
| `electron/main/agents/tools/stock-analysis-tools.ts` | 修改 | 新增 2 个工具 |
| `electron/main/tipc/stock.ts` | 修改 | 新增公式管理 + 信号检测 IPC 路由 |

---

## 步骤 1：更新 Python 依赖

### 1.1 `python/requirements.txt`

```
pandas>=2.0
numpy>=1.24
akshare>=1.14
lark>=1.1
```

---

## 步骤 2：技术信号检测

### 2.1 `python/core/signals.py`

职责：检测预定义的技术信号（金叉、死叉、超买超卖等），返回近期触发的信号列表。

```python
"""
技术信号检测模块

在 K 线数据上检测预定义的技术形态和信号。
所有信号检测都基于已计算的技术指标数据。
"""

import pandas as pd
from .indicators import calculate as calc_indicators

# ============================================================
# 信号定义
# ============================================================

SIGNAL_DEFINITIONS = {
    "macd_golden_cross": {
        "name": "MACD金叉",
        "description": "DIF 上穿 DEA（看多信号）",
        "requires": ["MACD"],
    },
    "macd_death_cross": {
        "name": "MACD死叉",
        "description": "DIF 下穿 DEA（看空信号）",
        "requires": ["MACD"],
    },
    "kdj_golden_cross": {
        "name": "KDJ金叉",
        "description": "K 线上穿 D 线（看多信号）",
        "requires": ["KDJ"],
    },
    "kdj_oversold": {
        "name": "KDJ超卖",
        "description": "K 值低于 20（超卖区域，可能反弹）",
        "requires": ["KDJ"],
    },
    "kdj_overbought": {
        "name": "KDJ超买",
        "description": "K 值高于 80（超买区域，可能回调）",
        "requires": ["KDJ"],
    },
    "rsi_oversold": {
        "name": "RSI超卖",
        "description": "RSI 低于 30（超卖区域）",
        "requires": ["RSI"],
    },
    "rsi_overbought": {
        "name": "RSI超买",
        "description": "RSI 高于 70（超买区域）",
        "requires": ["RSI"],
    },
    "boll_upper_break": {
        "name": "突破布林上轨",
        "description": "价格突破布林带上轨（强势突破或超买）",
        "requires": ["BOLL"],
    },
    "boll_lower_break": {
        "name": "跌破布林下轨",
        "description": "价格跌破布林带下轨（弱势或超卖）",
        "requires": ["BOLL"],
    },
    "volume_breakout": {
        "name": "成交量突破",
        "description": "成交量超过 20 日均量的 1.5 倍",
        "requires": ["MA"],
    },
    "ma_bullish_arrangement": {
        "name": "均线多头排列",
        "description": "MA5 > MA10 > MA20 > MA60（多头趋势确认）",
        "requires": ["MA"],
    },
}


def _cross_above(a: list, b: list, index: int) -> bool:
    """检测 a 在 index 处上穿 b"""
    if index < 1:
        return False
    prev_a, prev_b = a[index - 1], b[index - 1]
    curr_a, curr_b = a[index], b[index]
    if any(v is None for v in [prev_a, prev_b, curr_a, curr_b]):
        return False
    return prev_a <= prev_b and curr_a > curr_b


def _cross_below(a: list, b: list, index: int) -> bool:
    """检测 a 在 index 处下穿 b"""
    if index < 1:
        return False
    prev_a, prev_b = a[index - 1], b[index - 1]
    curr_a, curr_b = a[index], b[index]
    if any(v is None for v in [prev_a, prev_b, curr_a, curr_b]):
        return False
    return prev_a >= prev_b and curr_a < curr_b


def detect_signals(
    kline: list[dict],
    signals: list[str] | None = None,
    lookback: int = 5,
) -> dict:
    """
    检测技术信号。
    
    Args:
        kline: K 线数据
        signals: 要检测的信号列表（None=检测全部）
        lookback: 回看天数（默认5天）
    
    Returns:
        {
            "detected": [
                {
                    "signal_id": "macd_golden_cross",
                    "name": "MACD金叉",
                    "description": "DIF 上穿 DEA（看多信号）",
                    "date": "2026-04-14",
                    "details": "DIF=2.15, DEA=1.98"
                },
                ...
            ],
            "summary": "近5日检测到 2 个信号"
        }
    """
    if signals is None:
        signals = list(SIGNAL_DEFINITIONS.keys())
    
    # 收集需要的指标
    needed_indicators = set()
    for sig_id in signals:
        sig_def = SIGNAL_DEFINITIONS.get(sig_id)
        if sig_def:
            needed_indicators.update(sig_def["requires"])
    
    # 计算指标
    indicator_params = {"MA": {"periods": [5, 10, 20, 60]}}
    indicators = calc_indicators(kline, list(needed_indicators), indicator_params)
    
    dates = [k["date"] for k in kline]
    closes = [k["close"] for k in kline]
    volumes = [k["volume"] for k in kline]
    n = len(kline)
    
    detected = []
    start_idx = max(0, n - lookback)
    
    for i in range(start_idx, n):
        date = dates[i]
        
        for sig_id in signals:
            sig_def = SIGNAL_DEFINITIONS.get(sig_id)
            if not sig_def:
                continue
            
            triggered = False
            details = ""
            
            # ---- MACD 信号 ----
            if sig_id == "macd_golden_cross":
                macd = indicators.get("MACD", {})
                dif = macd.get("DIF", [])
                dea = macd.get("DEA", [])
                if _cross_above(dif, dea, i):
                    triggered = True
                    details = f"DIF={dif[i]:.4f}, DEA={dea[i]:.4f}"
            
            elif sig_id == "macd_death_cross":
                macd = indicators.get("MACD", {})
                dif = macd.get("DIF", [])
                dea = macd.get("DEA", [])
                if _cross_below(dif, dea, i):
                    triggered = True
                    details = f"DIF={dif[i]:.4f}, DEA={dea[i]:.4f}"
            
            # ---- KDJ 信号 ----
            elif sig_id == "kdj_golden_cross":
                kdj = indicators.get("KDJ", {})
                k = kdj.get("K", [])
                d = kdj.get("D", [])
                if _cross_above(k, d, i):
                    triggered = True
                    details = f"K={k[i]:.1f}, D={d[i]:.1f}"
            
            elif sig_id == "kdj_oversold":
                kdj = indicators.get("KDJ", {})
                k = kdj.get("K", [])
                if i < len(k) and k[i] is not None and k[i] < 20:
                    triggered = True
                    details = f"K={k[i]:.1f}"
            
            elif sig_id == "kdj_overbought":
                kdj = indicators.get("KDJ", {})
                k = kdj.get("K", [])
                if i < len(k) and k[i] is not None and k[i] > 80:
                    triggered = True
                    details = f"K={k[i]:.1f}"
            
            # ---- RSI 信号 ----
            elif sig_id == "rsi_oversold":
                rsi = indicators.get("RSI", {}).get("RSI", [])
                if i < len(rsi) and rsi[i] is not None and rsi[i] < 30:
                    triggered = True
                    details = f"RSI={rsi[i]:.1f}"
            
            elif sig_id == "rsi_overbought":
                rsi = indicators.get("RSI", {}).get("RSI", [])
                if i < len(rsi) and rsi[i] is not None and rsi[i] > 70:
                    triggered = True
                    details = f"RSI={rsi[i]:.1f}"
            
            # ---- BOLL 信号 ----
            elif sig_id == "boll_upper_break":
                boll = indicators.get("BOLL", {})
                upper = boll.get("UPPER", [])
                if i < len(upper) and upper[i] is not None and closes[i] > upper[i]:
                    triggered = True
                    details = f"收盘={closes[i]:.2f}, 上轨={upper[i]:.2f}"
            
            elif sig_id == "boll_lower_break":
                boll = indicators.get("BOLL", {})
                lower = boll.get("LOWER", [])
                if i < len(lower) and lower[i] is not None and closes[i] < lower[i]:
                    triggered = True
                    details = f"收盘={closes[i]:.2f}, 下轨={lower[i]:.2f}"
            
            # ---- 成交量信号 ----
            elif sig_id == "volume_breakout":
                ma_data = indicators.get("MA", {})
                # 计算 20 日均量
                if i >= 20:
                    avg_vol = sum(volumes[i-19:i+1]) / 20
                    if volumes[i] > avg_vol * 1.5:
                        triggered = True
                        details = f"成交量={volumes[i]:.0f}, 20日均量={avg_vol:.0f}, 倍数={volumes[i]/avg_vol:.1f}x"
            
            # ---- 均线多头排列 ----
            elif sig_id == "ma_bullish_arrangement":
                ma_data = indicators.get("MA", {})
                ma5 = ma_data.get("MA5", [])
                ma10 = ma_data.get("MA10", [])
                ma20 = ma_data.get("MA20", [])
                ma60 = ma_data.get("MA60", [])
                if (i < len(ma5) and i < len(ma10) and i < len(ma20) and i < len(ma60)
                    and all(v is not None for v in [ma5[i], ma10[i], ma20[i], ma60[i]])
                    and ma5[i] > ma10[i] > ma20[i] > ma60[i]):
                    triggered = True
                    details = f"MA5={ma5[i]:.2f} > MA10={ma10[i]:.2f} > MA20={ma20[i]:.2f} > MA60={ma60[i]:.2f}"
            
            if triggered:
                detected.append({
                    "signal_id": sig_id,
                    "name": sig_def["name"],
                    "description": sig_def["description"],
                    "date": date,
                    "details": details,
                })
    
    return {
        "detected": detected,
        "lookback_days": lookback,
        "signals_checked": len(signals),
        "summary": f"近{lookback}日检测到 {len(detected)} 个信号",
    }
```

---

## 步骤 3：公式引擎

### 3.1 `python/core/formula_engine.py`

```python
"""
公式引擎 — 表达式语言解析与执行

使用 lark 库定义正式语法，支持类通达信（TDX）风格的表达式。

三种公式类型:
  - screener: 筛选条件，布尔表达式
  - signal: 信号判断，布尔表达式
  - score: 评分公式，数值表达式

安全: 不允许 import/exec/eval，只有白名单函数可调用。
"""

import sys
from lark import Lark, Transformer, v_args
from .indicators import calculate as calc_indicators

def _log(msg: str):
    print(f"[formula_engine] {msg}", file=sys.stderr, flush=True)

# ============================================================
# 语法定义
# ============================================================

GRAMMAR = r"""
    ?start: expr

    ?expr: or_expr

    ?or_expr: and_expr ("OR"i and_expr)*

    ?and_expr: not_expr ("AND"i not_expr)*

    ?not_expr: "NOT"i not_expr -> not_expr
             | comparison

    ?comparison: arith (COMP_OP arith)?

    ?arith: term (("+" | "-") term)*

    ?term: factor (("*" | "/") factor)*

    ?factor: func_call
           | atom
           | "(" expr ")"

    func_call: NAME "(" [args] ")"
    args: expr ("," expr)*

    ?atom: dotted_name
         | NUMBER
         | STRING

    dotted_name: NAME ("." NAME)*

    COMP_OP: ">=" | "<=" | "!=" | ">" | "<" | "=="
    NAME: /[A-Za-z_][A-Za-z0-9_]*/
    STRING: "'" /[^']*/ "'"
    NUMBER: /\d+(\.\d+)?/

    %import common.WS
    %ignore WS
"""

parser = Lark(GRAMMAR, parser='lalr')

# ============================================================
# 执行上下文
# ============================================================

class FormulaContext:
    """
    公式执行上下文，提供变量和函数绑定。
    
    Attributes:
        kline: K 线数据（单只股票时可用）
        indicators: 已计算的指标缓存 {name: result}
        stock_data: 当前股票的基础数据 {price, pe, pb, market_cap, industry, ...}
        industry_data: 行业数据（用于 INDUSTRY_AVG 等函数）
    """
    
    def __init__(self, kline=None, stock_data=None, industry_data=None):
        self.kline = kline or []
        self.stock_data = stock_data or {}
        self.industry_data = industry_data or {}
        self._indicator_cache = {}
    
    def get_indicator(self, name: str, params: dict = None) -> dict:
        """获取指标数据（带缓存）"""
        cache_key = f"{name}:{params}"
        if cache_key not in self._indicator_cache:
            if not self.kline:
                raise ValueError(f"无 K 线数据，无法计算指标 {name}")
            result = calc_indicators(self.kline, [name], params or {})
            self._indicator_cache[cache_key] = result.get(name, {})
        return self._indicator_cache[cache_key]
    
    def get_variable(self, name: str) -> float | str | None:
        """获取变量值"""
        # 大写名称 → 行情变量
        upper = name.upper()
        var_map = {
            'CLOSE': lambda: self.kline[-1]['close'] if self.kline else None,
            'OPEN': lambda: self.kline[-1]['open'] if self.kline else None,
            'HIGH': lambda: self.kline[-1]['high'] if self.kline else None,
            'LOW': lambda: self.kline[-1]['low'] if self.kline else None,
            'VOL': lambda: self.kline[-1]['volume'] if self.kline else None,
            'VOLUME': lambda: self.kline[-1]['volume'] if self.kline else None,
            'TURNOVER': lambda: self.kline[-1]['turnover'] if self.kline else None,
            'PE': lambda: self.stock_data.get('pe'),
            'PB': lambda: self.stock_data.get('pb'),
            'MARKET_CAP': lambda: self.stock_data.get('market_cap'),
            'INDUSTRY': lambda: self.stock_data.get('industry'),
        }
        
        getter = var_map.get(upper)
        if getter:
            return getter()
        
        # 也检查 stock_data
        return self.stock_data.get(name, self.stock_data.get(upper))


# ============================================================
# AST 求值 Transformer
# ============================================================

@v_args(inline=True)
class FormulaEvaluator(Transformer):
    """将 AST 转换为求值结果"""
    
    def __init__(self, context: FormulaContext):
        super().__init__()
        self.context = context
    
    def NUMBER(self, token):
        return float(token)
    
    def STRING(self, token):
        # 去掉引号
        return str(token)[1:-1]
    
    def NAME(self, token):
        return str(token)
    
    def dotted_name(self, *names):
        """处理 MACD.DIF 这样的点号访问"""
        if len(names) == 1:
            # 单个名称 → 变量
            return self.context.get_variable(names[0])
        
        # 多级名称 → 指标属性
        indicator_name = names[0].upper()
        attr = names[1].upper()
        data = self.context.get_indicator(indicator_name)
        arr = data.get(attr, [])
        # 返回最后一个有效值
        for v in reversed(arr):
            if v is not None:
                return v
        return None
    
    def func_call(self, name, args=None):
        """函数调用"""
        func_name = name.upper()
        arg_list = args if args else []
        
        return self._call_function(func_name, arg_list)
    
    def args(self, *values):
        return list(values)
    
    def _call_function(self, name: str, args: list):
        """执行函数调用（白名单）"""
        
        # MA(series_name, period) → 返回最新值
        if name == 'MA':
            period = int(args[1]) if len(args) > 1 else 20
            data = self.context.get_indicator('MA', {'periods': [period]})
            arr = data.get(f'MA{period}', [])
            return self._last_valid(arr)
        
        if name == 'EMA':
            period = int(args[1]) if len(args) > 1 else 20
            data = self.context.get_indicator('EMA', {'periods': [period]})
            arr = data.get(f'EMA{period}', [])
            return self._last_valid(arr)
        
        if name == 'MACD':
            fast = int(args[0]) if len(args) > 0 else 12
            slow = int(args[1]) if len(args) > 1 else 26
            signal = int(args[2]) if len(args) > 2 else 9
            data = self.context.get_indicator('MACD', {'fast': fast, 'slow': slow, 'signal': signal})
            # 返回一个特殊对象，支持 .DIF .DEA .MACD 访问
            return {
                'DIF': self._last_valid(data.get('DIF', [])),
                'DEA': self._last_valid(data.get('DEA', [])),
                'MACD': self._last_valid(data.get('MACD', [])),
            }
        
        if name == 'KDJ':
            n = int(args[0]) if len(args) > 0 else 9
            data = self.context.get_indicator('KDJ', {'n': n})
            return {
                'K': self._last_valid(data.get('K', [])),
                'D': self._last_valid(data.get('D', [])),
                'J': self._last_valid(data.get('J', [])),
            }
        
        if name == 'RSI':
            period = int(args[0]) if len(args) > 0 else 14
            data = self.context.get_indicator('RSI', {'period': period})
            return self._last_valid(data.get('RSI', []))
        
        if name == 'BOLL':
            period = int(args[0]) if len(args) > 0 else 20
            width = float(args[1]) if len(args) > 1 else 2.0
            data = self.context.get_indicator('BOLL', {'period': period, 'width': width})
            return {
                'UPPER': self._last_valid(data.get('UPPER', [])),
                'MID': self._last_valid(data.get('MID', [])),
                'LOWER': self._last_valid(data.get('LOWER', [])),
            }
        
        if name == 'ATR':
            period = int(args[0]) if len(args) > 0 else 14
            data = self.context.get_indicator('ATR', {'period': period})
            return self._last_valid(data.get('ATR', []))
        
        if name == 'CROSS':
            # CROSS(A, B) — A 是否刚上穿 B
            a_arr = self._resolve_to_array(args[0]) if len(args) > 0 else []
            b_arr = self._resolve_to_array(args[1]) if len(args) > 1 else []
            if len(a_arr) < 2 or len(b_arr) < 2:
                return False
            i = len(a_arr) - 1
            return (a_arr[i-1] is not None and b_arr[i-1] is not None and 
                    a_arr[i] is not None and b_arr[i] is not None and
                    a_arr[i-1] <= b_arr[i-1] and a_arr[i] > b_arr[i])
        
        if name == 'INDUSTRY_AVG':
            field = str(args[0]).lower() if args else 'pe'
            return self.context.industry_data.get(f'{field}_avg')
        
        if name == 'MAX':
            period = int(args[1]) if len(args) > 1 else 20
            if self.context.kline and period <= len(self.context.kline):
                values = [k['high'] for k in self.context.kline[-period:]]
                return max(v for v in values if v is not None)
            return None
        
        if name == 'MIN':
            period = int(args[1]) if len(args) > 1 else 20
            if self.context.kline and period <= len(self.context.kline):
                values = [k['low'] for k in self.context.kline[-period:]]
                return min(v for v in values if v is not None)
            return None
        
        raise ValueError(f"未知函数: {name}")
    
    def _last_valid(self, arr):
        """获取数组最后一个非 None 值"""
        for v in reversed(arr):
            if v is not None:
                return v
        return None
    
    def _resolve_to_array(self, val):
        """将值解析为数组（用于 CROSS 函数）"""
        # 如果是数组直接返回
        if isinstance(val, list):
            return val
        # 如果是字典（指标结果），取第一个 key 的数组
        if isinstance(val, dict):
            first_key = list(val.keys())[0] if val else None
            if first_key and isinstance(val[first_key], list):
                return val[first_key]
        return []
    
    # ---- 运算符 ----
    
    def comparison(self, left, op, right):
        if left is None or right is None:
            return False
        op = str(op)
        if op == '>': return left > right
        if op == '<': return left < right
        if op == '>=': return left >= right
        if op == '<=': return left <= right
        if op == '==': return left == right
        if op == '!=': return left != right
        return False
    
    def or_expr(self, *args):
        return any(args)
    
    def and_expr(self, *args):
        return all(args)
    
    def not_expr(self, val):
        return not val
    
    def arith(self, *args):
        # args: val, op, val, op, val, ...
        # 简单处理：逐步计算
        result = args[0]
        i = 1
        while i < len(args):
            op = args[i]
            val = args[i + 1]
            if result is None or val is None:
                return None
            if str(op) == '+': result = result + val
            elif str(op) == '-': result = result - val
            i += 2
        return result
    
    def term(self, *args):
        result = args[0]
        i = 1
        while i < len(args):
            op = args[i]
            val = args[i + 1]
            if result is None or val is None:
                return None
            if str(op) == '*': result = result * val
            elif str(op) == '/': result = result / val if val != 0 else None
            i += 2
        return result


# ============================================================
# 公开 API
# ============================================================

def parse_and_eval(expression: str, context: FormulaContext):
    """
    解析并执行公式表达式。
    
    Args:
        expression: 公式文本，如 "RSI(14) < 30 AND PE < 20"
        context: 执行上下文（包含 K 线、行情、行业数据）
    
    Returns:
        公式结果（布尔值、数值或 None）
    """
    tree = parser.parse(expression)
    evaluator = FormulaEvaluator(context)
    return evaluator.transform(tree)


def validate_formula(expression: str) -> dict:
    """
    验证公式语法是否正确（不执行）。
    
    Returns:
        {"valid": True} 或 {"valid": False, "error": "错误信息"}
    """
    try:
        parser.parse(expression)
        return {"valid": True}
    except Exception as e:
        return {"valid": False, "error": str(e)}
```

---

## 步骤 4：更新 Python 主进程

### 4.1 修改 `python/main.py`

新增导入和 handler：

```python
from core.signals import detect_signals
from core.formula_engine import parse_and_eval, validate_formula, FormulaContext

def handle_detect_signals(request_id: str, params: dict):
    """检测技术信号"""
    kline = params.get("kline")
    signals = params.get("signals")  # None = 全部
    lookback = params.get("lookback", 5)
    
    if not kline:
        send_error(request_id, -1, "缺少 kline 参数")
        return
    
    result = detect_signals(kline, signals, lookback)
    send_response(request_id, result)

def handle_eval_formula(request_id: str, params: dict):
    """执行用户公式"""
    expression = params.get("expression")
    kline = params.get("kline")
    stock_data = params.get("stock_data", {})
    industry_data = params.get("industry_data", {})
    
    if not expression:
        send_error(request_id, -1, "缺少 expression 参数")
        return
    
    context = FormulaContext(
        kline=kline,
        stock_data=stock_data,
        industry_data=industry_data,
    )
    
    result = parse_and_eval(expression, context)
    send_response(request_id, {"result": result, "type": type(result).__name__})

def handle_validate_formula(request_id: str, params: dict):
    """验证公式语法"""
    expression = params.get("expression", "")
    result = validate_formula(expression)
    send_response(request_id, result)

# 更新 METHOD_HANDLERS
METHOD_HANDLERS = {
    # ... 之前的
    "detect_signals": handle_detect_signals,      # 新增
    "eval_formula": handle_eval_formula,            # 新增
    "validate_formula": handle_validate_formula,    # 新增
}
```

---

## 步骤 5：TypeScript 层 — 公式存储服务

### 5.1 `electron/main/services/stock/formula-service.ts`

```typescript
/**
 * 公式存储服务 — Formula Service
 *
 * 管理用户自定义公式的 CRUD，存储在 .dogear/stocks/formulas.json。
 * 模式参考 stock-watchlist-service.ts。
 */

import { v4 as uuidv4 } from 'uuid';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import path from 'path';
import { getConfigDir } from './stock-watchlist-service.js';  // 复用配置目录获取方法

// ============================================================
// 类型定义
// ============================================================

export interface Formula {
  id: string;
  name: string;
  type: 'screener' | 'signal' | 'score';
  expression: string;
  description?: string;
  params?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

interface FormulaStore {
  version: number;
  formulas: Formula[];
}

const DEFAULT_STORE: FormulaStore = {
  version: 1,
  formulas: [],
};

// ============================================================
// FormulaService 类
// ============================================================

class FormulaService {
  private getFilePath(): string {
    return path.join(getConfigDir(), 'stocks', 'formulas.json');
  }

  async load(): Promise<FormulaStore> {
    const data = await safeJsonRead<FormulaStore>(this.getFilePath());
    return data ?? { ...DEFAULT_STORE };
  }

  private async save(store: FormulaStore): Promise<void> {
    await safeJsonWrite(this.getFilePath(), store);
  }

  async getAll(): Promise<Formula[]> {
    const store = await this.load();
    return store.formulas;
  }

  async getById(id: string): Promise<Formula | undefined> {
    const store = await this.load();
    return store.formulas.find(f => f.id === id);
  }

  async add(formula: Omit<Formula, 'id' | 'createdAt' | 'updatedAt'>): Promise<Formula> {
    const store = await this.load();
    const now = new Date().toISOString();
    const newFormula: Formula = {
      ...formula,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    store.formulas.push(newFormula);
    await this.save(store);
    return newFormula;
  }

  async update(id: string, updates: Partial<Pick<Formula, 'name' | 'expression' | 'description' | 'params' | 'type'>>): Promise<Formula | null> {
    const store = await this.load();
    const index = store.formulas.findIndex(f => f.id === id);
    if (index === -1) return null;

    store.formulas[index] = {
      ...store.formulas[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.save(store);
    return store.formulas[index];
  }

  async remove(id: string): Promise<boolean> {
    const store = await this.load();
    const before = store.formulas.length;
    store.formulas = store.formulas.filter(f => f.id !== id);
    if (store.formulas.length === before) return false;
    await this.save(store);
    return true;
  }
}

// ============================================================
// 导出单例
// ============================================================

export const formulaService = new FormulaService();
```

### 5.2 修改 `electron/main/services/stock/index.ts`

```typescript
export { formulaService } from './formula-service.js';
```

---

## 步骤 6：新增 Agent 工具 — DetectSignals + EvalFormula

在 `stock-analysis-tools.ts` 的 tools 数组中追加两个工具。工具实现参考 Phase 1 的 CalcIndicators 模式。

关键点：
- **DetectSignals** 获取 K 线 → 调用 Python `detect_signals` → 格式化信号列表
- **EvalFormula** 加载公式 → 获取 K 线 + 行情 → 调用 Python `eval_formula` → 返回结果

### 6.1 IPC 路由

在 `electron/main/tipc/stock.ts` 中新增公式管理路由：

```typescript
// 公式管理
'stock:getFormulas': t.procedure.action(async () => {
  try {
    const formulas = await formulaService.getAll();
    return { data: formulas };
  } catch (error) {
    return { error: String(error) };
  }
}),

'stock:addFormula': t.procedure
  .input<{ name: string; type: 'screener' | 'signal' | 'score'; expression: string; description?: string }>()
  .action(async ({ input }) => {
    try {
      // 先验证语法
      const validation = await pythonBridge.call('validate_formula', { expression: input.expression });
      if (!validation.valid) {
        return { error: `公式语法错误: ${validation.error}` };
      }
      const formula = await formulaService.add(input);
      return { data: formula };
    } catch (error) {
      return { error: String(error) };
    }
  }),

'stock:removeFormula': t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    try {
      const removed = await formulaService.remove(input.id);
      return { data: removed };
    } catch (error) {
      return { error: String(error) };
    }
  }),

'stock:updateFormula': t.procedure
  .input<{ id: string; name?: string; expression?: string; description?: string; type?: 'screener' | 'signal' | 'score' }>()
  .action(async ({ input }) => {
    try {
      const { id, ...updates } = input;
      const formula = await formulaService.update(id, updates);
      return { data: formula };
    } catch (error) {
      return { error: String(error) };
    }
  }),
```

---

## 步骤 7：验证

### 测试场景

1. "帮我检测茅台最近有没有技术信号" → DetectSignals
2. "帮我写一个公式：MACD金叉且成交量放大" → AI 生成公式表达式 → 用户保存
3. "用我的筛选公式跑一下" → EvalFormula

### 编译 + 测试

```bash
pip install lark
bun run build:electron
bun run dev
```

---

## 文件修改清单

| 序号 | 操作 | 文件 |
|------|------|------|
| 1 | 修改 | `python/requirements.txt`（添加 lark） |
| 2 | 新建 | `python/core/signals.py` |
| 3 | 新建 | `python/core/formula_engine.py` |
| 4 | 修改 | `python/main.py`（3 个新方法） |
| 5 | 新建 | `electron/main/services/stock/formula-service.ts` |
| 6 | 修改 | `electron/main/services/stock/index.ts` |
| 7 | 修改 | `electron/main/agents/tools/stock-analysis-tools.ts`（2 个新工具） |
| 8 | 修改 | `electron/main/tipc/stock.ts`（公式 CRUD + 信号 IPC） |
