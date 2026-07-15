---
step: 12
title: 概念板块
status: pending
---

## 目标
新增概念板块列表/成份股/历史行情（项目当前只有行业板块）。

## 依赖上下文（接力棒输入）
- 现有 `akshare_client.py:202` 的 `get_industry_stocks` 只支持行业板块
- 现有 `stock-analysis-tools.ts` 的 ListIndustries 工具 + ScreenStocks 的 industry 参数都是行业维度
- 概念板块（"AI"、"新能源"、"华为概念"）是另一种维度，需要独立工具
- AKShare 接口：`stock_board_concept_name_em()` / `stock_board_concept_cons_em(symbol)` / `stock_board_concept_hist_em(symbol, period, start_date, end_date, adjust)`

## 计划改动
- [ ] `akshare_client.py` 新增 3 个方法：
  - `get_concept_list() -> pd.DataFrame` → `ak.stock_board_concept_name_em()`
  - `get_concept_stocks(symbol: str) -> pd.DataFrame` → `ak.stock_board_concept_cons_em(symbol)`，symbol 是概念名（如 "AI"）
  - `get_concept_hist(symbol: str, period: str, start_date: str, end_date: str, adjust: str) -> pd.DataFrame` → `ak.stock_board_concept_hist_em(...)`
- [ ] 新建 `python/core/concept.py`：纯函数（板块名归一化、字段裁剪）
- [ ] `python-bridge.ts` 注册 3 个 method
- [ ] `stock-analysis-tools.ts` 加 3 个工具：
  - `ListConceptBoards` — 列概念板块（无参）
  - `GetConceptStocks` — 概念成份股（参数 symbol=概念名）
  - `GetConceptHistory` — 概念板块历史 K 线（参数 symbol + period + start/end_date）
- [ ] 缓存策略：列表 24h、成份股 24h、历史 1h
- [ ] 注意：不与 ListIndustries / ScreenStocks 的 industry 参数耦合（概念和行业是两个维度，工具不共用）

## 验证标准
- 调用 ListConceptBoards 返回所有概念板块
- 调用 GetConceptStocks `{symbol: "AI"}` 返回 AI 概念成份股
- 调用 GetConceptHistory `{symbol: "AI", period: "daily", start_date: "20240101", end_date: "20240601"}` 返回 K 线

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- 所有 12 个 step 完成后，回 plan.md 填「完成总结」
- 验证全局：打开 dogear 应用，AI 聊天里测试每个新工具至少一次
