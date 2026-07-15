---
step: 1
title: 升级已弃用接口
status: done
---

## 目标
把官方标记为"替换"的两个接口升级到新版，避免后续 step 在旧接口上构建。

## 依赖上下文（接力棒输入）
- 当前 `python/utils/akshare_client.py:243` 调用 `ak.stock_financial_abstract_ths(symbol)`，缓存 1h
- 当前 `python/utils/akshare_client.py:266` 调用 `ak.stock_financial_analysis_indicator(symbol)`，新浪数据源
- `python/core/financials.py:91-117` 处理 abstract 返回 DataFrame 的多列名映射
- 现有调用点：`screener.py` 用 financial_abstract 做财务筛选；`stock-analysis-tools.ts` 的 GetFinancials / CompareIndustry 工具消费这些数据
- 关键约束：数据返回结构对外暴露的契约要尽量保持兼容（避免级联改动）

## 计划改动
- [ ] `akshare_client.py`：`get_financial_abstract` 改用 `ak.stock_financial_abstract_new_ths(symbol, indicator="按报告期")`，新版本字段更全（含 yoy/mom/single_yoy），按报告期返回
- [ ] `akshare_client.py`：`get_financial_indicators` 改用 `ak.stock_financial_analysis_indicator_em(symbol="SH600519", indicator="按报告期")`，注意 em 版 symbol 要带市场前缀（SH/SZ/BJ），需要从裸代码推断前缀（沪 6 开头、深 0/3 开头、北 8/4 开头）
- [ ] `financials.py:91-117`：更新列名映射表适配新版字段
- [ ] `screener.py`：检查财务筛选条件使用的列名是否仍存在
- [ ] `stock-analysis-tools.ts` 的 GetFinancials 工具描述：补充新版能返回的字段（yoy/mom 等）
- [ ] 缓存 TTL 保持 1h 不变

## 验证标准
- 调用 GetFinancials 工具查贵州茅台（600519），返回 DataFrame 含 yoy/mom 字段
- 调用 CompareIndustry 工具不报错
- `bun run build:electron` + `bun run lint` 通过

## 实施回填

### 实际改动
- `python/utils/akshare_client.py`：
  - 新增 `_THS_ABSTRACT_METRIC_MAP`（21 个指标 metric_name → 中文名）+ `_THS_ABSTRACT_DROP_METRICS`（丢 3 个冗余 `*_yoy_growth_ratio`）
  - 新增 `_pivot_ths_financial_abstract()` 长表转宽表 + `_symbol_to_secucode()` 裸码转 SECUCODE
  - `get_financial_abstract(symbol, indicator="按报告期")` 改调 `stock_financial_abstract_new_ths`，返回宽表附 `_yoy`/`_mom`/`_single_yoy` 衍生列（原始小数 ×100 转百分比）
  - `get_financial_indicators(symbol, indicator="按报告期")` 改调 `stock_financial_analysis_indicator_em`
  - 缓存 key 追加 `indicator` 维度，TTL 保持 3600s
- `python/core/financials.py`：`column_map` 保留所有旧英文字段名（revenue/net_profit/roe/gross_margin/…），新增 yoy/mom/single_yoy 系列映射；删除新 API 不产出的旧同花顺容错别名（`营业收入`/`每股收益`/`毛利率`/`经营现金流`）
- `python/core/screener.py`：**未改动**（核实其 PE/PB 筛选字段全部来自 `get_all_a_stocks`，与本次升级的两个函数无交集）
- `electron/main/agents/tools/stock-analysis-tools.ts:389-392`：GetFinancials 描述补充新增字段说明与新接口名
- 4 文件 diff：+113 -29，含 step1.md 本身

### 与计划的一处偏差
- Plan 里 `get_financial_indicators` 示例的 symbol 格式为前缀式 `"SH600519"`，实测该接口只吃**后缀 SECUCODE 格式** `"600519.SH"`，前缀式会返回空数据。已按实测的 `_symbol_to_secucode()`（沪 6→.SH，深 0/3→.SZ，北 8/4→.BJ）实现。
- `get_financial_indicators` 目前全代码库无消费方，只做了接口升级 + symbol 格式修正，返回列仍是东财原始 141 列英文缩写（`EPSJB`/`TOTALOPERATEREVE`/`ROEJQ` 等），未做中文归一化——留待未来有消费方的 step 按需处理，避免为不存在的调用方过度设计。

### 给下一步的接力棒
- `get_financial_abstract` 新签名：`def get_financial_abstract(symbol: str, indicator: str = "按报告期") -> pd.DataFrame`
- `get_financial_indicators` 新签名：`def get_financial_indicators(symbol: str, indicator: str = "按报告期") -> pd.DataFrame`，symbol 是裸代码（内部转 `600519.SH` 这种 SECUCODE 格式，**不是** `SH600519` 前缀）
- 已存在的复用辅助：`_symbol_to_secucode()`（裸码→SECUCODE）可被后续需要东财 SECUCODE 格式的接口直接复用
- 给 Step 5 的提示：abstract 升级后字段仍然只是摘要，三大报表（200+ 字段）走 step 5 新建的 statements.py，不要混用
