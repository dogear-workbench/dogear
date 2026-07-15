---
step: 6
title: 业绩预告与快报
status: pending
---

## 目标
新增业绩预告和业绩快报数据，用于捕捉预期差（早于正式财报披露）。

## 依赖上下文（接力棒输入）
- Step 5 接力棒：statements.py 是单股查询；业绩预告/快报是全市场按日期查询，数据形态不同
- AKShare 接口：`stock_yjyg_em(date)` / `stock_yjkb_em(date)` 返回某报告期全市场数据
- date 格式：`"20240331"`，文档明确从 20081231 开始；可选值 `"XXXX0331"|"XXXX0630"|"XXXX0930"|"XXXX1231"`

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_earnings_forecast(date: str) -> pd.DataFrame` → `ak.stock_yjyg_em(date)`，业绩预告（含预测指标/业绩变动/预告类型）
  - `get_earnings_express(date: str) -> pd.DataFrame` → `ak.stock_yjkb_em(date)`，业绩快报（已披露的快报数据）
- [ ] 新建 `python/core/earnings.py`：从全市场数据中按 symbol 过滤（如果调用方传了 symbol）
- [ ] `python-bridge.ts` 注册 2 个 method
- [ ] `stock-analysis-tools.ts` 加工具 `GetEarningsReport`：
  - 参数：`date + type: "forecast" | "express" + symbol?`
  - symbol 可选：不传返回全市场；传了则 Python 层过滤
  - 描述写清：date 必须是季度末日格式
- [ ] 缓存策略：24h（按报告期，季度级）

## 验证标准
- 调用 GetEarningsReport `{date: "20240331", type: "forecast"}` 返回全市场预告
- 调用 GetEarningsReport `{date: "20240331", type: "express", symbol: "600519"}` 返回茅台快报（如果有）

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `earnings.py` 已建，后续若加业绩报表 `stock_yjbb_em`（全市场正式业绩）可在此扩展
- 给 Step 7 的提示：估值历史是单股时间序列，新建 valuation.py
