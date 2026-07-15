---
step: 5
title: 三大报表全量字段
status: pending
---

## 目标
新增资产负债表/利润表/现金流量表的全量字段数据（替代 abstract 的精简版），供深度财务分析使用。

## 依赖上下文（接力棒输入）
- Step 1 接力棒：abstract 已升级到 `new_ths`，但仍是摘要（~10 字段）；step 5 提供 200+ 字段的全量报表
- symbol 参数带市场前缀：em 接口要 `"SH600519"`，不像 abstract 是裸代码
- 现有 `financials.py` 处理摘要，不混入 statements（数据量级差异巨大）

## 计划改动
- [ ] `akshare_client.py` 新增 3 个方法：
  - `get_balance_sheet(symbol: str) -> pd.DataFrame` → `ak.stock_balance_sheet_by_report_em(symbol="SH600519")`，319 字段
  - `get_profit_sheet(symbol: str) -> pd.DataFrame` → `ak.stock_profit_sheet_by_report_em(symbol)`，203 字段
  - `get_cash_flow_sheet(symbol: str) -> pd.DataFrame` → `ak.stock_cash_flow_sheet_by_report_em(symbol)`，252 字段
  - symbol 参数统一接收裸代码，内部转 SH/SZ/BJ 前缀（复用 Step 1 的推断逻辑）
- [ ] 新建 `python/core/statements.py`：
  - 字段裁剪：原始 200+ 字段太多，按"关键科目"裁剪到 ~50 字段（货币资金/应收/存货/总资产/负债/股东权益/净利润/营收/经营现金流 等）
  - 单位统一：原始单位混杂，统一到元
  - 按报告期排序（最新在前）
- [ ] `python-bridge.ts` 注册 3 个 method
- [ ] `stock-analysis-tools.ts` 加工具 `GetFinancialStatements`：
  - 参数：`symbol + statement: "balance" | "profit" | "cashflow"`
  - 描述写明：返回关键科目（不是全 319 字段），单位元
- [ ] 缓存策略：24h（财报按报告期更新，季度级频率）

## 验证标准
- 调用 GetFinancialStatements `{symbol: "600519", statement: "balance"}` 返回关键科目历史
- 三种 statement 类型都跑通

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `statements.py` 关键科目裁剪清单（执行后回填）：[列出最终保留的字段]
- 给 Step 6 的提示：业绩预告/快报是全市场按日期查询（不是单股），数据形态不同，新建 earnings.py
