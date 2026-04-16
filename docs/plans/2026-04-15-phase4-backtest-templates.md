# Phase 4 实施文档：简单回测 + 预置公式模板

> 前置依赖：Phase 1-3 已完成（Python Bridge + 指标 + AKShare + 公式引擎 + 信号检测）
> 设计文档：`2026-04-15-stock-analysis-system-design.md`

## 目标

实现简单策略回测和预置公式模板。完成后 AI 可以执行：
```
"如果每次MACD金叉买入、死叉卖出，茅台过去一年表现如何" → SimpleBacktest 工具
"有哪些现成的公式可以用" → 列出预置模板
```

## 交付物

| 文件 | 类型 | 说明 |
|------|------|------|
| `python/core/backtest.py` | 新建 | 简单回测引擎 |
| `python/main.py` | 修改 | 注册回测方法 |
| `electron/main/agents/tools/stock-analysis-tools.ts` | 修改 | 新增 SimpleBacktest 工具 |
| `electron/main/services/stock/formula-service.ts` | 修改 | 预置公式模板初始化 |
| `electron/main/tipc/stock.ts` | 修改 | 新增回测 IPC 路由 |

---

## 步骤 1：回测引擎

### 1.1 `python/core/backtest.py`

```python
"""
简单回测引擎

对信号公式在历史 K 线上进行回测：
- 遍历 K 线数据，每个 bar 计算公式
- 公式返回 True → 买入或卖出（交替）
- 统计收益率、胜率、最大回撤等

限制（有意简化）:
- 全仓操作（每次买入/卖出都是 100% 仓位）
- 不计算手续费和滑点
- 不支持做空
- 不支持多股组合
"""

import sys
from .indicators import calculate as calc_indicators
from .formula_engine import parse_and_eval, FormulaContext

def _log(msg: str):
    print(f"[backtest] {msg}", file=sys.stderr, flush=True)


def simple_backtest(
    kline: list[dict],
    buy_expression: str,
    sell_expression: str | None = None,
    initial_capital: float = 100000,
) -> dict:
    """
    简单策略回测。
    
    Args:
        kline: K 线数据（需要足够长，至少 60 条）
        buy_expression: 买入信号公式（如 "CROSS(MACD(12,26,9).DIF, MACD(12,26,9).DEA)"）
        sell_expression: 卖出信号公式（如 "CROSS(MACD(12,26,9).DEA, MACD(12,26,9).DIF)"）。
                        如果为 None，使用 buy_expression 的反向逻辑（有持仓时触发 = 卖出）
        initial_capital: 初始资金，默认 100000
    
    Returns:
        {
            "initial_capital": 100000,
            "final_capital": 112500,
            "total_return_pct": 12.5,
            "trade_count": 11,
            "win_count": 6,
            "lose_count": 5,
            "win_rate_pct": 54.5,
            "max_drawdown_pct": -8.2,
            "avg_holding_days": 12,
            "best_trade_pct": 8.5,
            "worst_trade_pct": -4.2,
            "trades": [
                {
                    "type": "buy",
                    "date": "2025-06-15",
                    "price": 1450.0,
                    "capital": 100000,
                    "shares": 68
                },
                {
                    "type": "sell",
                    "date": "2025-07-02",
                    "price": 1520.0,
                    "capital": 104760,
                    "profit_pct": 4.76
                },
                ...
            ],
            "equity_curve": [
                {"date": "2025-04-15", "equity": 100000},
                ...
            ]
        }
    """
    n = len(kline)
    if n < 60:
        return {"error": f"K 线数据不足（{n} 条），至少需要 60 条"}
    
    _log(f"开始回测: {n} 根K线, 初始资金 {initial_capital}")
    
    # 如果没有指定卖出公式，默认为"买入信号的反向"
    if sell_expression is None:
        # 简单策略：买入后等下一次买入信号卖出（周期性）
        # 或者用户可以提供明确的卖出条件
        sell_expression = buy_expression  # 同一个信号触发交替买卖
    
    capital = initial_capital
    shares = 0
    holding = False
    trades = []
    equity_curve = []
    entry_price = 0
    entry_date = ""
    peak_equity = initial_capital
    max_drawdown = 0
    
    # 从第 60 根 K 线开始（确保指标有足够数据）
    start_idx = 60
    
    for i in range(start_idx, n):
        # 当前 bar 的 K 线子集（从头到 i）
        kline_slice = kline[:i+1]
        current_price = kline[i]['close']
        current_date = kline[i]['date']
        
        # 计算当前权益
        current_equity = capital + (shares * current_price if holding else 0)
        equity_curve.append({"date": current_date, "equity": round(current_equity, 2)})
        
        # 更新最大回撤
        if current_equity > peak_equity:
            peak_equity = current_equity
        drawdown = (current_equity - peak_equity) / peak_equity * 100
        if drawdown < max_drawdown:
            max_drawdown = drawdown
        
        # 构建上下文并计算信号
        context = FormulaContext(kline=kline_slice)
        
        try:
            if not holding:
                # 检测买入信号
                buy_signal = parse_and_eval(buy_expression, context)
                if buy_signal:
                    # 买入
                    shares = int(capital / current_price)
                    if shares <= 0:
                        continue
                    cost = shares * current_price
                    capital -= cost
                    holding = True
                    entry_price = current_price
                    entry_date = current_date
                    
                    trades.append({
                        "type": "buy",
                        "date": current_date,
                        "price": round(current_price, 2),
                        "shares": shares,
                        "capital_before": round(capital + cost, 2),
                    })
            else:
                # 检测卖出信号
                sell_signal = parse_and_eval(sell_expression, context)
                if sell_signal:
                    # 卖出
                    proceeds = shares * current_price
                    profit_pct = (current_price - entry_price) / entry_price * 100
                    capital += proceeds
                    
                    # 计算持有天数
                    try:
                        from datetime import datetime
                        d1 = datetime.strptime(entry_date[:10], "%Y-%m-%d")
                        d2 = datetime.strptime(current_date[:10], "%Y-%m-%d")
                        holding_days = (d2 - d1).days
                    except:
                        holding_days = 0
                    
                    trades.append({
                        "type": "sell",
                        "date": current_date,
                        "price": round(current_price, 2),
                        "shares": shares,
                        "profit_pct": round(profit_pct, 2),
                        "holding_days": holding_days,
                        "capital_after": round(capital, 2),
                    })
                    
                    shares = 0
                    holding = False
                    
        except Exception as e:
            _log(f"公式执行异常 at {current_date}: {e}")
            continue
    
    # 如果回测结束时还持有，按最后价格计算
    if holding and shares > 0:
        last_price = kline[-1]['close']
        proceeds = shares * last_price
        profit_pct = (last_price - entry_price) / entry_price * 100
        capital += proceeds
        trades.append({
            "type": "forced_sell",
            "date": kline[-1]['date'],
            "price": round(last_price, 2),
            "shares": shares,
            "profit_pct": round(profit_pct, 2),
            "note": "回测结束时自动平仓",
        })
        shares = 0
        holding = False
    
    # 统计结果
    final_capital = capital
    total_return_pct = (final_capital - initial_capital) / initial_capital * 100
    
    sell_trades = [t for t in trades if t['type'] in ('sell', 'forced_sell')]
    win_trades = [t for t in sell_trades if t.get('profit_pct', 0) > 0]
    lose_trades = [t for t in sell_trades if t.get('profit_pct', 0) <= 0]
    
    trade_count = len(sell_trades)
    win_count = len(win_trades)
    lose_count = len(lose_trades)
    win_rate = (win_count / trade_count * 100) if trade_count > 0 else 0
    
    profits = [t.get('profit_pct', 0) for t in sell_trades]
    best_trade = max(profits) if profits else 0
    worst_trade = min(profits) if profits else 0
    
    holding_days_list = [t.get('holding_days', 0) for t in sell_trades if 'holding_days' in t]
    avg_holding = sum(holding_days_list) / len(holding_days_list) if holding_days_list else 0
    
    # 精简 equity_curve（数据点太多时只保留采样）
    if len(equity_curve) > 100:
        step = len(equity_curve) // 100
        equity_curve = equity_curve[::step] + [equity_curve[-1]]
    
    return {
        "initial_capital": initial_capital,
        "final_capital": round(final_capital, 2),
        "total_return_pct": round(total_return_pct, 2),
        "trade_count": trade_count,
        "win_count": win_count,
        "lose_count": lose_count,
        "win_rate_pct": round(win_rate, 1),
        "max_drawdown_pct": round(max_drawdown, 2),
        "avg_holding_days": round(avg_holding, 1),
        "best_trade_pct": round(best_trade, 2),
        "worst_trade_pct": round(worst_trade, 2),
        "trades": trades,
        "equity_curve": equity_curve,
        "period": f"{kline[start_idx]['date']} ~ {kline[-1]['date']}",
        "total_bars": n - start_idx,
    }
```

---

## 步骤 2：更新 Python 主进程

### 2.1 修改 `python/main.py`

```python
from core.backtest import simple_backtest

def handle_simple_backtest(request_id: str, params: dict):
    """简单策略回测"""
    kline = params.get("kline")
    buy_expression = params.get("buy_expression")
    sell_expression = params.get("sell_expression")
    initial_capital = params.get("initial_capital", 100000)
    
    if not kline:
        send_error(request_id, -1, "缺少 kline 参数")
        return
    if not buy_expression:
        send_error(request_id, -1, "缺少 buy_expression 参数")
        return
    
    result = simple_backtest(kline, buy_expression, sell_expression, initial_capital)
    send_response(request_id, result)

# 更新路由表
METHOD_HANDLERS = {
    # ... 之前的
    "simple_backtest": handle_simple_backtest,    # 新增
}
```

---

## 步骤 3：Agent 工具 — SimpleBacktest

在 `stock-analysis-tools.ts` 的 tools 数组中追加：

```typescript
// ========================================
// 工具: 简单策略回测
// ========================================
tool(
  'SimpleBacktest',
  '在历史 K 线数据上回测交易策略。\n' +
  '给定买入/卖出信号公式，模拟交易并统计收益率、胜率、最大回撤等。\n' +
  '限制: 全仓操作、不计手续费/滑点、不支持做空。\n' +
  '使用场景: 用户想验证一个技术策略在某只股票上的历史表现。',
  {
    market: z.number().describe('市场代码（1=沪市 0=深市）'),
    code: z.string().describe('股票代码'),
    buy_expression: z.string()
      .describe('买入信号公式，如 "CROSS(MACD(12,26,9).DIF, MACD(12,26,9).DEA)"'),
    sell_expression: z.string().optional()
      .describe('卖出信号公式。如不填，使用买入信号交替触发买卖'),
    period: z.enum(['3m', '6m', '1y', '2y', '3y']).default('1y')
      .describe('回测周期'),
    initial_capital: z.number().default(100000)
      .describe('初始资金（元）'),
  },
  async (args) => {
    try {
      // 根据回测周期确定 K 线条数
      const periodMap: Record<string, number> = {
        '3m': 60, '6m': 120, '1y': 250, '2y': 500, '3y': 500,
      };
      const limit = periodMap[args.period] || 250;

      // 获取 K 线数据
      const secid = `${args.market}.${args.code}`;
      const klineData = await stockService.getKLine({
        secid,
        period: 101,  // 日K
        adjust: 1,    // 前复权
        limit,
      });

      if (klineData.length < 60) {
        return {
          content: [{
            type: 'text' as const,
            text: `K 线数据不足（${klineData.length} 条），回测至少需要 60 条数据。`,
          }],
        };
      }

      // 调用 Python 回测
      const result = await pythonBridge.call<{
        initial_capital: number;
        final_capital: number;
        total_return_pct: number;
        trade_count: number;
        win_count: number;
        lose_count: number;
        win_rate_pct: number;
        max_drawdown_pct: number;
        avg_holding_days: number;
        best_trade_pct: number;
        worst_trade_pct: number;
        period: string;
        total_bars: number;
        trades: Array<Record<string, unknown>>;
        error?: string;
      }>('simple_backtest', {
        kline: klineData,
        buy_expression: args.buy_expression,
        sell_expression: args.sell_expression || null,
        initial_capital: args.initial_capital,
      }, 300_000);  // 回测超时 5min

      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `回测失败: ${result.error}` }],
          isError: true,
        };
      }

      // 格式化输出
      const output = [
        `=== 回测结果: ${args.code} ===`,
        `回测周期: ${result.period}（共 ${result.total_bars} 个交易日）`,
        `买入公式: ${args.buy_expression}`,
        args.sell_expression ? `卖出公式: ${args.sell_expression}` : '卖出公式: 买入信号交替触发',
        ``,
        `初始资金: ¥${result.initial_capital.toLocaleString()}`,
        `最终资金: ¥${result.final_capital.toLocaleString()}`,
        `总收益率: ${result.total_return_pct >= 0 ? '+' : ''}${result.total_return_pct}%`,
        `最大回撤: ${result.max_drawdown_pct}%`,
        ``,
        `交易次数: ${result.trade_count} 次`,
        `胜率: ${result.win_rate_pct}%（${result.win_count}胜 ${result.lose_count}负）`,
        `平均持有: ${result.avg_holding_days} 天`,
        `最佳单笔: +${result.best_trade_pct}%`,
        `最差单笔: ${result.worst_trade_pct}%`,
      ].join('\n');

      // 交易记录（最近 10 笔）
      const recentTrades = result.trades.slice(-10);
      let tradesStr = '';
      if (recentTrades.length > 0) {
        const tradeLines = recentTrades.map((t: any) => {
          if (t.type === 'buy') {
            return `  ${t.date} 买入 ${t.shares}股 @ ¥${t.price}`;
          } else {
            const profitPrefix = (t.profit_pct || 0) >= 0 ? '+' : '';
            return `  ${t.date} 卖出 ${t.shares}股 @ ¥${t.price}（${profitPrefix}${t.profit_pct}%）`;
          }
        });
        tradesStr = `\n\n最近交易记录:\n${tradeLines.join('\n')}`;
      }

      return {
        content: [{ type: 'text' as const, text: output + tradesStr }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `回测失败: ${error}` }],
        isError: true,
      };
    }
  }
),
```

---

## 步骤 4：预置公式模板

### 4.1 修改 `electron/main/services/stock/formula-service.ts`

在 `FormulaService` 类中添加预置模板初始化方法：

```typescript
/** 预置公式模板 */
private static readonly BUILTIN_TEMPLATES: Omit<Formula, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // ---- 筛选型 ----
  {
    name: '低估值蓝筹',
    type: 'screener',
    expression: 'PE < 15 AND PB < 2 AND MARKET_CAP > 100',
    description: 'PE<15, PB<2, 市值>100亿 的低估值大盘股',
  },
  {
    name: 'RSI超卖',
    type: 'screener',
    expression: 'RSI(14) < 30',
    description: 'RSI(14) 低于 30 的超卖股票',
  },
  {
    name: '布林下轨低吸',
    type: 'screener',
    expression: 'CLOSE < BOLL(20,2).LOWER AND RSI(14) < 40',
    description: '价格在布林下轨以下且 RSI 偏弱',
  },
  // ---- 信号型 ----
  {
    name: 'MACD金叉',
    type: 'signal',
    expression: 'CROSS(MACD(12,26,9).DIF, MACD(12,26,9).DEA)',
    description: 'MACD DIF 上穿 DEA',
  },
  {
    name: 'MACD金叉+放量',
    type: 'signal',
    expression: 'CROSS(MACD(12,26,9).DIF, MACD(12,26,9).DEA) AND VOL > MA(VOL, 20) * 1.5',
    description: 'MACD 金叉同时成交量放大1.5倍',
  },
  {
    name: 'KDJ超卖金叉',
    type: 'signal',
    expression: 'KDJ(9).K < 20 AND CROSS(KDJ(9).K, KDJ(9).D)',
    description: 'KDJ 在超卖区域金叉',
  },
  // ---- 评分型 ----
  {
    name: '综合评分',
    type: 'score',
    expression: 'RSI(14) * 0.3 + (100 - PE) * 0.4 + (CLOSE > MA(CLOSE, 60)) * 30',
    description: 'RSI权重30% + PE估值权重40% + 趋势权重30%',
  },
];

/** 初始化预置模板（首次加载时写入） */
async ensureBuiltinTemplates(): Promise<void> {
  const store = await this.load();
  
  // 如果已有公式，不重复写入
  if (store.formulas.length > 0) return;
  
  const now = new Date().toISOString();
  for (const template of FormulaService.BUILTIN_TEMPLATES) {
    store.formulas.push({
      ...template,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    });
  }
  
  await this.save(store);
  _log(`已写入 ${FormulaService.BUILTIN_TEMPLATES.length} 个预置公式模板`);
}
```

在 `getAll()` 方法开头调用：

```typescript
async getAll(): Promise<Formula[]> {
  await this.ensureBuiltinTemplates();  // 确保预置模板存在
  const store = await this.load();
  return store.formulas;
}
```

---

## 步骤 5：注册工具元数据

在 `stock-analysis-tools.ts` 的 `registerTools` 中追加：

```typescript
{ name: 'SimpleBacktest', description: '简单策略回测', server: 'dogear-stock-analysis', category: 'stock' },
```

---

## 步骤 6：IPC 路由

在 `electron/main/tipc/stock.ts` 中新增：

```typescript
'stock:runBacktest': t.procedure
  .input<{
    market: number;
    code: string;
    buy_expression: string;
    sell_expression?: string;
    period?: number;
    initial_capital?: number;
  }>()
  .action(async ({ input }) => {
    try {
      const klineData = await stockService.getKLine({
        secid: `${input.market}.${input.code}`,
        period: 101,
        adjust: 1,
        limit: input.period || 250,
      });

      const result = await pythonBridge.call('simple_backtest', {
        kline: klineData,
        buy_expression: input.buy_expression,
        sell_expression: input.sell_expression || null,
        initial_capital: input.initial_capital || 100000,
      }, 300_000);

      return { data: result };
    } catch (error) {
      return { error: String(error) };
    }
  }),
```

---

## 步骤 7：验证

### 测试场景

1. **基础回测**：
   > "用MACD金叉买入、死叉卖出的策略，回测贵州茅台过去一年"
   → SimpleBacktest 工具 → 收益率、胜率等统计

2. **预置模板使用**：
   > "有哪些现成的公式模板"
   → AI 调用 GetFormulas 列出预置模板
   > "用'KDJ超卖金叉'策略回测平安银行"
   → 加载模板公式 → SimpleBacktest

3. **自定义策略回测**：
   > "如果每次RSI低于25买入、RSI高于75卖出，回测效果如何"
   → AI 构造公式 → SimpleBacktest

### 编译 + 测试

```bash
bun run build:electron
bun run dev
```

---

## 文件修改清单

| 序号 | 操作 | 文件 |
|------|------|------|
| 1 | 新建 | `python/core/backtest.py` |
| 2 | 修改 | `python/main.py`（新增回测方法） |
| 3 | 修改 | `electron/main/agents/tools/stock-analysis-tools.ts`（新增 SimpleBacktest） |
| 4 | 修改 | `electron/main/services/stock/formula-service.ts`（预置模板） |
| 5 | 修改 | `electron/main/tipc/stock.ts`（回测 IPC 路由） |

---

## 全部 Phase 完成后的能力总览

| 能力 | 工具 | Phase |
|------|------|-------|
| 搜索股票 | SearchStock | 已有 |
| 实时行情 | GetStockQuote | 已有 |
| K线历史 | GetKLineData | 已有 |
| 分时数据 | GetTimeline | 已有 |
| 自选股管理 | GetWatchlist / ModifyWatchlist | 已有 |
| **技术指标计算** | CalcIndicators | Phase 1 |
| **全市场筛选** | ScreenStocks | Phase 2 |
| **财报数据** | GetFinancials | Phase 2 |
| **行业对比** | CompareIndustry | Phase 2 |
| **信号检测** | DetectSignals | Phase 3 |
| **公式执行** | EvalFormula | Phase 3 |
| **策略回测** | SimpleBacktest | Phase 4 |

共 **13 个 Agent 工具**（6 已有 + 7 新增），覆盖从行情查看到量化分析的完整链路。

AI 从"只能看行情"升级为"能算、能筛、能验证策略的量化军师"。
