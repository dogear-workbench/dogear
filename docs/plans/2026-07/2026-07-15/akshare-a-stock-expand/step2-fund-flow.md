---
step: 2
title: 资金流向
status: pending
---

## 目标
新增个股/大盘/板块资金流向数据，修复 TS 层 `stock-service.ts:529-533` 的"返回空数组"占位，让前端 MoneyFlow 组件有真实数据。

## 依赖上下文（接力棒输入）
- 前端 `MoneyFlow.tsx` 组件存在但拿不到数据；走 `stock-store.ts` 的 `fetchMoneyFlow` action
- TS 层 `stock-service.ts:529-533` 占位明确写"返回空数组"
- 无前置 step 强依赖（这是新增数据流），但建议在 Step 1 之后做（避免新老接口混改）
- AKShare 接口返回字段：日期/收盘价/涨跌幅/主力净流入-净额-净占比/超大单/大单/中单/小单 净额与净占比

## 计划改动
- [ ] `akshare_client.py` 新增 3 个方法：
  - `get_individual_fund_flow(stock: str, market: str) -> pd.DataFrame` → `ak.stock_individual_fund_flow(stock, market)`，market 枚举 `"sh"|"sz"|"bj"`，返回近 100 个交易日
  - `get_market_fund_flow() -> pd.DataFrame` → `ak.stock_market_fund_flow()`，大盘历史
  - `get_sector_fund_flow_rank(indicator: str, sector_type: str) -> pd.DataFrame` → `ak.stock_sector_fund_flow_rank(indicator, sector_type)`，indicator 枚举 `"今日"|"5日"|"10日"`，sector_type 枚举 `"行业资金流"|"概念资金流"|"地域资金流"`
- [ ] 新建 `python/core/fund_flow.py`：纯函数处理（如计算主力净占比排名、5日主力净额累计）
- [ ] `python-bridge.ts` 注册 3 个 method：`akshare.getIndividualFundFlow` / `akshare.getMarketFundFlow` / `akshare.getSectorFundFlowRank`
- [ ] `stock-analysis-tools.ts` 加新工具 `GetFundFlow`：
  - 参数：`type: "individual" | "market" | "sector"`，individual 必填 stock+market；sector 必填 indicator+sector_type
  - 一个工具聚合三种用途（避免工具爆炸）
  - 描述写清单位：净额单位元，净占比单位 %
- [ ] 修复 `stock-service.ts:529-533`：把"返回空数组"换成调用 python-bridge 的 `akshare.getIndividualFundFlow`，返回结构对齐前端 MoneyFlow 组件期望的 `MoneyFlowPoint[]`
- [ ] 缓存策略：individual 60s、market 5min、sector 5min

## 验证标准
- 前端 MoneyFlow 组件能显示个股资金流图
- 调用 GetFundFlow 工具 `{type: "individual", stock: "600519", market: "sh"}` 返回近 100 日数据
- 调用 GetFundFlow 工具 `{type: "sector", indicator: "今日", sector_type: "行业资金流"}` 返回板块排名

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `fund_flow.py` 已建，后续若需要资金流衍生指标（如主力连续净流入天数）在此扩展
- 给 Step 3 的提示：北向资金语义独立（外资性质），单独建 `hsgt.py` 模块，不要混进 fund_flow
- 工具 GetFundFlow 已占用了 `type` 参数，北向工具用不同工具名避免混淆
