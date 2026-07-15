---
step: 8
title: 分红派息
status: pending
---

## 目标
新增个股分红送配详情 + 历史分红记录。

## 依赖上下文（接力棒输入）
- 项目当前完全没有分红数据
- AKShare 双源策略：
  - `stock_fhps_detail_em(symbol)` 东财分红送配详情（含股权登记日/除权日/方案进度）
  - `stock_history_dividend_detail(symbol, indicator, date)` 新浪历史分红（按"分红"/"配股"分）
  - `stock_dividend_cninfo(symbol)` 巨潮历史分红（更准，方案格式标准）

## 计划改动
- [ ] `akshare_client.py` 新增 3 个方法：
  - `get_dividend_plan(symbol: str) -> pd.DataFrame` → `ak.stock_fhps_detail_em(symbol)`，分红方案进度
  - `get_dividend_history_sina(symbol: str, indicator: str) -> pd.DataFrame` → `ak.stock_history_dividend_detail(symbol, indicator)`，indicator 枚举 `"分红"|"配股"`
  - `get_dividend_history_cninfo(symbol: str) -> pd.DataFrame` → `ak.stock_dividend_cninfo(symbol)`
- [ ] 新建 `python/core/dividend.py`：双源融合——以 cninfo 为主源，失败时降级到 sina
- [ ] `python-bridge.ts` 注册 2 个 method（sina + cninfo 合并到 `akshare.getDividendHistory`，源选择由 Python 层处理）
- [ ] `stock-analysis-tools.ts` 加 2 个工具：
  - `GetDividendPlan` — 个股分红方案（参数 symbol）
  - `GetDividendHistory` — 历史分红（参数 symbol + source?: "auto"|"cninfo"|"sina"，默认 auto）
- [ ] 缓存策略：24h（分红方案进度变化慢）

## 验证标准
- 调用 GetDividendHistory `{symbol: "600519"}` 返回茅台历年分红
- 调用 GetDividendPlan `{symbol: "600519"}` 返回当前分红方案进度

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `dividend.py` 双源策略：cninfo 优先，失败降级 sina（DataSourceExhausted 处理）
- 给 Step 9 的提示：股东数据按季度披露，新建 shareholder.py
