---
step: 7
title: 估值历史与长期指标
status: pending
---

## 目标
新增个股估值历史（PE-TTM/PE静/PB/PEG/PS 时间序列）+ 长期指标（含股息率）。

## 依赖上下文（接力棒输入）
- 现有 GetStockQuote 返回当前 PE/PB（快照），无历史
- AKShare 接口：
  - `stock_value_em(symbol)` 返回数据日期/收盘价/总市值/流通市值/PE(TTM)/PE(静)/市净率/PEG/市现率/市销率
  - `stock_a_indicator_lg(symbol)` 返回日期/股息率/PE/PB（乐咕数据源，历史长）

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_value_history(symbol: str) -> pd.DataFrame` → `ak.stock_value_em(symbol)`
  - `get_long_indicator(symbol: str) -> pd.DataFrame` → `ak.stock_a_indicator_lg(symbol)`
- [ ] 新建 `python/core/valuation.py`：纯函数（日期排序、字段重命名、缺失值处理）
- [ ] `python-bridge.ts` 注册 2 个 method
- [ ] `stock-analysis-tools.ts` 加工具 `GetValuationHistory`：
  - 参数：`symbol + type: "value" | "long_indicator"`
  - value 返回估值时间序列（多指标）；long_indicator 返回股息率 + 长期 PE/PB
- [ ] 缓存策略：1h（估值历史日频更新）

## 验证标准
- 调用 GetValuationHistory `{symbol: "600519", type: "value"}` 返回 PE/PB 历史序列
- 调用 GetValuationHistory `{symbol: "600519", type: "long_indicator"}` 返回股息率历史

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `valuation.py` 已建，后续若加大盘估值（巴菲特指标/股债利差等）可在此扩展（但当前 plan 不含择时类）
- 给 Step 8 的提示：分红数据是离散事件（不是日频），新建 dividend.py
