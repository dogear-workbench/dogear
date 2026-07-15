---
step: 9
title: 股东结构
status: pending
---

## 目标
新增十大流通股东 + 股东户数（筹码集中度）。

## 依赖上下文（接力棒输入）
- 项目当前完全没有股东数据
- AKShare 接口：
  - `stock_gdfx_free_top_10_em(symbol, date)` symbol 要小写市场前缀（如 "sh688686"），date 是季度末日
  - `stock_zh_a_gdhs_detail_em(symbol)` 股东户数详情（含本期/上次/增减/变化比例）

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_top10_holders(symbol: str, date: str) -> pd.DataFrame` → `ak.stock_gdfx_free_top_10_em(symbol="sh688686", date="20240930")`
    - symbol 接收裸代码，内部转小写前缀
    - date 校验：必须是季末日（0331/0630/0930/1231）
  - `get_shareholder_count(symbol: str) -> pd.DataFrame` → `ak.stock_zh_a_gdhs_detail_em(symbol)`
- [ ] 新建 `python/core/shareholder.py`：纯函数（日期解析、变化比例计算）
- [ ] `python-bridge.ts` 注册 2 个 method
- [ ] `stock-analysis-tools.ts` 加工具 `GetShareholderInfo`：
  - 参数：`symbol + type: "top10" | "count"`
  - top10 必填 date（季度末日）；count 不需要 date
  - 描述写明：top10 的 date 必须是季末日；不是所有季度都有数据，最早可查到 ~2010 年
- [ ] 缓存策略：24h（季度披露，变化极慢）

## 验证标准
- 调用 GetShareholderInfo `{symbol: "600519", type: "top10", date: "20240930"}` 返回十大流通股东
- 调用 GetShareholderInfo `{symbol: "600519", type: "count"}` 返回股东户数变化

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `shareholder.py` 已建，后续若加十大股东（非流通）`stock_gdfx_top_10_em` 可在此扩展
- 给 Step 10 的提示：龙虎榜是日频事件数据，新建 dragon_tiger.py
