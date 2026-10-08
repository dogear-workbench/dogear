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

    def get_variable(self, name: str):
        """获取变量值"""
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
        return str(token)[1:-1]

    def NAME(self, token):
        return str(token)

    def dotted_name(self, *names):
        """处理 MACD.DIF 这样的点号访问"""
        if len(names) == 1:
            return self.context.get_variable(names[0])

        indicator_name = names[0].upper()
        attr = names[1].upper()
        data = self.context.get_indicator(indicator_name)
        arr = data.get(attr, [])
        for v in reversed(arr):
            if v is not None:
                return v
        return None

    def func_call(self, name, args=None):
        """函数调用"""
        func_name = str(name).upper()
        arg_list = args if args else []
        return self._call_function(func_name, arg_list)

    def args(self, *values):
        return list(values)

    def _call_function(self, name: str, args: list):
        """执行函数调用（白名单）"""

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
            return {
                'DIF': data.get('DIF', []),
                'DEA': data.get('DEA', []),
                'MACD': data.get('MACD', []),
            }

        if name == 'KDJ':
            n = int(args[0]) if len(args) > 0 else 9
            data = self.context.get_indicator('KDJ', {'n': n})
            return {
                'K': data.get('K', []),
                'D': data.get('D', []),
                'J': data.get('J', []),
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
                'UPPER': data.get('UPPER', []),
                'MID': data.get('MID', []),
                'LOWER': data.get('LOWER', []),
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
        if isinstance(val, list):
            return val
        if isinstance(val, dict):
            first_key = list(val.keys())[0] if val else None
            if first_key and isinstance(val[first_key], list):
                return val[first_key]
        return []

    # ---- 运算符 ----

    def comparison(self, left, op, right):
        if left is None or right is None:
            return False
        # 如果 left/right 是 dict（指标对象），取最后有效值
        if isinstance(left, dict):
            left = self._last_valid(list(left.values())[0] if left else [])
        if isinstance(right, dict):
            right = self._last_valid(list(right.values())[0] if right else [])
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
        return any(bool(a) for a in args)

    def and_expr(self, *args):
        return all(bool(a) for a in args)

    def not_expr(self, val):
        return not bool(val)

    def arith(self, *args):
        result = args[0]
        i = 1
        while i < len(args):
            op = str(args[i])
            val = args[i + 1]
            if result is None or val is None:
                return None
            if op == '+': result = result + val
            elif op == '-': result = result - val
            i += 2
        return result

    def term(self, *args):
        result = args[0]
        i = 1
        while i < len(args):
            op = str(args[i])
            val = args[i + 1]
            if result is None or val is None:
                return None
            if op == '*': result = result * val
            elif op == '/': result = result / val if val != 0 else None
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
