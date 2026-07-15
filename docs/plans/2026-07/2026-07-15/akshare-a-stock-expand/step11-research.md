---
step: 11
title: 研报与盈利预测
status: pending
---

## 目标
新增个股研报（含 PDF 链接、机构评级）+ 分析师盈利预测（一致预期 EPS/PE）。

## 依赖上下文（接力棒输入）
- 项目当前完全没有研报数据
- AKShare 接口：
  - `stock_research_report_em(symbol)` 单股研报列表，含报告名/东财评级/机构/盈利预测（多年 EPS+PE）
  - `stock_profit_forecast_em(symbol)` symbol 可选（空=全部），返回研报数/评级分布/多年 EPS 预测

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_research_report(symbol: str) -> pd.DataFrame` → `ak.stock_research_report_em(symbol)`
  - `get_profit_forecast(symbol: str) -> pd.DataFrame` → `ak.stock_profit_forecast_em(symbol)`
- [ ] 新建 `python/core/research.py`：纯函数（评级归一化、机构去重）
- [ ] `python-bridge.ts` 注册 2 个 method
- [ ] `stock-analysis-tools.ts` 加 2 个工具：
  - `GetResearchReport` — 个股研报列表（参数 symbol）
  - `GetProfitForecast` — 盈利预测（参数 symbol）
  - 描述写明：研报可能很多（数百条），返回最近 N 条（如 50）；PDF 链接供进一步阅读
- [ ] 缓存策略：研报 6h、预测 6h

## 验证标准
- 调用 GetResearchReport `{symbol: "600519"}` 返回茅台研报列表
- 调用 GetProfitForecast `{symbol: "600519"}` 返回盈利预测（多年 EPS）

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `research.py` 已建
- 给 Step 12 的提示：概念板块是另一维度（vs 行业板块），新建 concept.py
