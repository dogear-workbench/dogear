---
step: 2
title: 资金流向
status: done
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
- `python/utils/akshare_client.py`（+145 行）：新增资金流章节
  - `_FUND_FLOW_SUFFIX_MAP`：主力/超大单/大单/中单/小单 净额/净占比 → 英文字段名，三方法共用
  - `_normalize_sector_fund_flow_rank`：处理板块排名带 indicator 前缀（"今日主力净流入-净额"）的列名
  - `get_individual_fund_flow(stock, market)`：`_single_limiter` + 60s 缓存
  - `get_market_fund_flow()` / `get_sector_fund_flow_rank(indicator, sector_type)`：`_bulk_limiter` + 300s 缓存
- `python/core/fund_flow.py`（新建 147 行，纯函数）：三个 `_series` / `_data` 函数，`_safe_num` 统一 NaN→None，异常 catch 后返回 `{"error": ...}`
- `python/main.py`：import fund_flow 三函数，新增 3 个 `handle_*` 带参数校验，`METHOD_HANDLERS` 注册
- `electron/main/services/stock/stock-service.ts:535-567`：`getMoneyFlow` 从"返回空数组"占位改为 `pythonBridge.call('get_individual_fund_flow', ...)`；market number(1沪/0深) 转 "sh"/"sz"；Python 异常或业务 error 时 `console.warn` + 返回 `[]` 降级不阻塞前端
- `electron/main/agents/tools/stock-analysis-tools.ts`：新增 `formatYuan()` 辅助 + `GetFundFlow` 工具（type=individual|market|sector 聚合三种查询）+ `registerTools([...])` 元数据注册

### 与计划的两处偏差
1. **Python method 命名从 plan 的 `akshare.<action>` 改为 snake_case 不带前缀**：现有 `METHOD_HANDLERS`（`ping`/`get_financials`/`screen_stocks`/`list_industries` 等 12 个 method）全部是 snake_case 无前缀，plan 的点分命名空间在代码库里没有先例。为保持单一约定沿用 `get_individual_fund_flow` / `get_market_fund_flow` / `get_sector_fund_flow_rank`。全局决策 #1 应视为已修正。
2. **MoneyFlowPoint 类型保留不变（方案 A）**：实测 `MoneyFlow.tsx` 只消费 `mainNetInflow` / `retailNetInflow` 两个字段，其他四个 inflow/outflow 前端从未使用。所以 AKShare 只给净额不给拆分流入流出没问题——固定填 0 即可，不改类型和前端组件。

### 遗留问题
- AKShare 三接口的实际返回列名基于惯例整理，未连线实测（用户手测确认），如有出入只需改 `akshare_client.py` 映射表
- `market="bj"` 个股资金流未实测（`ak.stock_individual_fund_flow` 是否真支持 bj 未验证）

### 给下一步的接力棒
- `fund_flow.py` 已建，后续若需要资金流衍生指标（如主力连续净流入天数）在此扩展
- `_FUND_FLOW_SUFFIX_MAP` 可复用于其他返回相同字段模板的接口
- 给 Step 3 的提示：北向资金语义独立（外资性质），单独建 `hsgt.py`，不要混进 fund_flow
- 工具 `GetFundFlow` 已占用了 `type` 参数，北向工具用不同工具名（如 `GetNorthboundFlow`）避免语义混淆
