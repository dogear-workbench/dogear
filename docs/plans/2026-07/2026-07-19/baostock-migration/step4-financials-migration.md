---
step: 4
title: financials 改造走 baostock 财务接口
status: done
---

## 目标

改造 `python/core/financials.py::get_financials`，主数据源从同花顺（`stock_financial_abstract_new_ths`）换成 baostock 5 个财务接口的组合；保留同花顺作为兜底（不删）。字段输出保持对 agent 兼容。

## 依赖上下文（接力棒输入）

- Step 1 产出：`python/utils/baostock_client.py::get_financial_series(code, year_range=2)` 返回 `{"profit": df, "growth": df, "operation": df, "balance": df, "cash_flow": df}`
- 现有代码入口：
  - `python/core/financials.py:52` `get_financials(symbol, periods=4)` —— 主入口，改造重点
  - 现有输出字段（同花顺归一化后）：营业总收入 / 归属净利润 / 扣非净利润 / 基本每股收益 / 每股净资产 / 净资产收益率 / 销售毛利率 / 销售净利率 / 资产负债率 / 每股经营现金流 等，每项含 `_yoy` / `_mom` / `_single_yoy` 三个衍生字段
- 上层调用点（不改）：
  - `electron/main/services/stock/python-bridge.ts` 的 `getFinancials` method
  - `electron/main/agents/tools/stock-analysis-tools.ts` 的 `GetFinancials` 工具描述

## 计划改动

- [ ] `python/core/financials.py`：
  - [ ] 顶部 import 加 `from utils.baostock_client import get_financial_series, BaostockError`
  - [ ] 新增内部函数 `_get_financials_from_baostock(symbol, periods) -> dict`：
    - `symbol` 转 baostock 格式：`600519` → `sh.600519` / `000001` → `sz.000001` / `8*` / `4*` → `bj.*`
    - 调 `get_financial_series(bs_code, year_range=(periods // 4) + 1)`
    - 从 5 张 df 里提取选股关心的字段并按 report_date 合并：
      - profit：`roeAvg`（净资产收益率）/ `npMargin`（销售净利率）/ `gpMargin`（销售毛利率）/ `netProfit`（净利润）/ `epsTTM`（每股收益 TTM）/ `MBRevenue`（营业总收入）
      - growth：`YOYEquity` / `YOYAsset` / `YOYNI`（同比增长率）
      - operation：`NRTurnRatio` / `INVTurnRatio`（周转率）
      - balance：`liabilityToAsset`（资产负债率）/ `currentRatio`（流动比率）
      - cash_flow：`CAToAsset`（经营现金流 / 总资产）
    - 计算 yoy/mom/single_yoy（本步先只算 yoy，mom/single_yoy 可暂时空缺，MVP 心态）
    - 返回结构与旧同花顺归一化后的 dict 保持一致（字段名中文化，跟旧输出对齐）
  - [ ] 改造 `get_financials`：
    - 优先调 `_get_financials_from_baostock`
    - 抛 `BaostockError` 时降级到原来的同花顺路径（`get_financial_abstract`）
    - 都失败才返回 `{"error": ..., "error_type": ...}`
- [ ] 手动验证：
  - `python -c "from core.financials import get_financials; import json; print(json.dumps(get_financials('600519', 8), ensure_ascii=False, indent=2))"`
  - 通过 python-bridge → agent 工具调 `GetFinancials` 验证输出与原来的字段结构兼容

## 验收标准

- 选股 SOP 中调 `GetFinancials` 深挖候选股能拿到近 8 季度的营收/净利润/ROE 序列
- 字段名与旧输出兼容（agent 不需要改 prompt 或工具描述）
- 同花顺兜底路径可触发（临时 mock baostock 抛异常测一次）

## 实施回填（做完后填）

### 实际改动
- `python/core/financials.py`：仅此一个文件
  - 新增 `_pct(val)`：baostock 财务比率字段是小数，×100 转百分比
  - 新增 `_symbol_to_bs_code(symbol)`：`600/601/603/605/688/689/900→sh.` / `000/001/002/003/300/301/200→sz.` / `4/8/920→bj.`；无法识别抛 `BaostockError(ApiError)` 触发降级
  - 新增 `_select_or_empty(df, cols)`：安全取列（缺列填 None、空 df 返回空表），供三表 outer join 用
  - 新增 `_get_financials_from_baostock(symbol, periods)`：走 profit + growth + balance 三表按 `statDate` outer join，字段映射到旧同花顺英文键；operation / cash_flow 拉取但未纳入输出
  - `get_financials`：顶部先 try baostock，只 catch `BaostockError` 降级到同花顺；两条路径都加 `_source`（"baostock" / "ths"）；最终失败加 `error_type: "ThsFetchError"`
- **未改**：`compare_industry` 及其辅助函数 / `python-bridge.ts` / `stock-analysis-tools.ts` / `.claude/**`
- **与计划差异**：
  1. `operation` / `cash_flow` 两表拉取但未纳入最终输出（计划提到 NRTurnRatio/INVTurnRatio/CAToAsset，委派指令未强制要求，本步为保范围最小未展开）
  2. `revenue_yoy` 自算（相邻年份同月日 revenue 差值），而非用 growth 表——因为 growth 表根本没有营收同比字段
  3. 新增 `current_ratio` 字段（旧同花顺无），只增不减不影响兼容

### 给下一步的接力棒
- **baostock 与同花顺字段差异表**：
  | 字段 | baostock 来源 | 缺失情况 |
  |---|---|---|
  | revenue / net_profit / eps / roe / net_margin / gross_margin | profit 表 | ✓ |
  | net_profit_yoy | growth.YOYPNI | ✓ |
  | debt_ratio / current_ratio | balance 表 | ⚠️ debt_ratio 数量级不稳定 |
  | revenue_yoy | 自算 | 依赖两年数据都非 null |
  | net_profit_deducted / bvps / operating_cash_flow_per_share | 无 | 恒 None |
  | mom / single_yoy 全体 | 无（MVP 决策） | 恒 None |
- **yoy / mom / single_yoy 覆盖**：只有 `net_profit_yoy`（官方 YOYPNI）和 `revenue_yoy`（自算，Q1/Q3 因 revenue 缺失常为空）有值；其余 yoy 字段全 None；mom / single_yoy 全 None
- **已知限制 / 坑**（**重要，需向下一环节传达**）：
  1. **`debt_ratio` 数据质量问题**：baostock `liabilityToAsset` 多数历史季度原始值比合理范围小 100 倍（0.001 量级而非 0.1），只有最新 1-2 个季度是对的，两只测试股票都复现相同规律。当前实现对所有季度统一 ×100，会导致历史 debt_ratio 显著失真偏小。**未做启发式修正**（客户端无法判断真值）。**建议**：agent 提示词或 `GetFinancials` 工具描述加一句"debt_ratio 部分历史季度可能不准确，交叉验证；比率<1 时高度可疑"
  2. **`MBRevenue`（revenue）在 Q1/Q3 常为 null**：baostock 该字段规律性只在半年报/年报（Q2/Q4）披露；agent 逐季看营收趋势会看到间歇性空值
  3. **累计口径 vs 单季度**：baostock 是当年累计值（Q3 = 前三季度累计），旧同花顺可能是单季度；已用 `_source` 字段标注让 agent 感知口径差异，未做单季度差分转换（超 MVP 范围）
  4. **无扣非净利润 / BVPS / 每股经营现金流**：baostock 无对应字段固定 None
  5. **降级路径已实测**（`999999` 触发无效前缀 → catch BaostockError → 走同花顺 → 同花顺也无该代码 → 返回 error），逻辑链完整

## 完成后

已回到 `../baostock-migration/plan.md` 末尾补「## 完成总结」，汇总 4 步实际改动与偏差。
