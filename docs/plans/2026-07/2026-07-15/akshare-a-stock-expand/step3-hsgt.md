---
step: 3
title: 北向资金
status: pending
---

## 目标
新增个股北向持股历史 + 北向资金汇总历史（外资动向）。

## 依赖上下文（接力棒输入）
- Step 2 接力棒：`fund_flow.py` 已建，但北向单独建 `hsgt.py`（资金性质不同）
- AKShare 北向接口字段：持股日期/收盘价/涨跌幅/持股数量/持股市值/持股数量占A股百分比/今日增持股数/今日增持资金

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_hsgt_individual(symbol: str) -> pd.DataFrame` → `ak.stock_hsgt_individual_em(symbol)`，symbol 是裸代码（如 "002008"），返回该股的北向持股历史
  - `get_hsgt_hist(fund_type: str) -> pd.DataFrame` → `ak.stock_hsgt_hist_em(symbol=fund_type)`，fund_type 枚举 `"北向资金"|"沪股通"|"深股通"|"南向资金"|"港股通沪"|"港股通深"`
- [ ] 新建 `python/core/hsgt.py`：纯函数（字段标准化、日期解析）
- [ ] `python-bridge.ts` 注册 2 个 method：`akshare.getHsgtIndividual` / `akshare.getHsgtHist`
- [ ] `stock-analysis-tools.ts` 加工具 `GetNorthboundHolding`：
  - 参数：`symbol: "individual" | "summary"`
  - individual 必填 stock；summary 必填 fund_type
  - 描述写清：A 股个股只关注北向（沪股通+深股通），南向是港股
- [ ] 缓存策略：individual 1h、summary 1h（北向数据日频更新）

## 验证标准
- 调用 `GetNorthboundHolding {symbol: "individual", stock: "002008"}` 返回该股北向持股历史
- 调用 `GetNorthboundHolding {symbol: "summary", fund_type: "北向资金"}` 返回北向汇总历史

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `hsgt.py` 已建，后续若加沪深港通持股详情（`stock_hsgt_individual_detail_em`）可在此扩展
- 给 Step 4 的提示：分钟级 K 线与北向数据无依赖，可独立做
