---
step: 3
title: 北向资金
status: done
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
- `python/utils/akshare_client.py` +90 行：`_HSGT_INDIVIDUAL_COLUMNS` / `_HSGT_HIST_COLUMNS` 列名映射 + `get_hsgt_individual(symbol)`（`_single_limiter` + 缓存 3600s）+ `get_hsgt_hist(fund_type)`（`_bulk_limiter` + 缓存 3600s）。**实测确认两个接口参数名都是 `symbol=`**（不是 plan 里猜测的 `stock=`），用 `inspect.signature` 验证过
- `python/core/hsgt.py` 新建 117 行：`get_hsgt_individual_series` / `get_hsgt_hist_data` 两个纯函数，参考 fund_flow.py 结构
- `python/main.py`：import 两函数 + 2 个 handler（参数校验含 fund_type 六选一） + `METHOD_HANDLERS` 注册
- `electron/main/agents/tools/stock-analysis-tools.ts`：`GetNorthboundHolding` 工具（individual/summary 两支，markdown 表格输出）+ `registerTools` 元数据

### 关键修复（plan 未预料）
北向两个接口的日期列返回 `datetime.date` 对象（不是字符串，与 fund_flow 依赖的接口不同），`core/protocol.py:send_response` 用裸 `json.dumps` 会崩。已在 `hsgt.py:_safe_num` 加 `datetime.date/datetime/pd.Timestamp` → ISO 字符串（前 10 位）分支，端到端验证过。

### 参数命名决策
Plan 写 `symbol: "individual" | "summary"`，改成 `type`：与 `GetFundFlow` 的 `type` 字段保持一致，`symbol` 在本工具集里专指股票代码（`stock` 字段承载实际股票代码，与 `GetFundFlow` 对齐）。

### 数据源限制（预期行为）
交易所自 2024-08-19 起不再披露沪深港通每日资金流明细，`get_hsgt_hist_data` 的 `net_buy_amount`/`buy_amount`/`sell_amount`/`daily_fund_inflow`/`daily_balance` 从那之后恒为 null（用真实数据验到 2026-07-15 仍空）。仅 `hold_market_cap`（持股市值）+ `leading_stock`（领涨股）+ `hs300` 仍在更新。已在 hsgt.py docstring、工具描述、markdown 输出末尾三处标注。

### 单位说明（未做换算，保真优先）
- `net_buy_amount`/`buy_amount`/`sell_amount`/`daily_fund_inflow`/`daily_balance`：**亿元**
- `cumulative_net_buy_amount`：**万亿元**
- `hold_market_cap`：**元**
（akshare 原始设计，工具描述里已标注单位）

### 遗留问题
- `stock-analysis-tools.ts` 现 1143 行、9 个工具；`akshare_client.py` 现 691 行——均超出 300 行拆分门槛，是 step1/step2 遗留状态，按 plan 全局决策"step 5 之后统一考虑拆分"暂不处理

### 给下一步的接力棒
- `hsgt.py` 已建，后续若加沪深港通持股详情（`stock_hsgt_individual_detail_em`）可在此扩展
- `_safe_num` 的 date 转换分支后续 core/*.py 遇同类接口可复用同款处理
- 给 Step 4 的提示：分钟级 K 线与北向数据无依赖，可独立做
