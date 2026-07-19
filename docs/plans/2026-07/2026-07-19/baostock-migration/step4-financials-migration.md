---
step: 4
title: financials 改造走 baostock 财务接口
status: pending
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
- 与计划差异：

### 给下一步的接力棒
- baostock 财务字段与同花顺字段映射差异表：
- yoy/mom/single_yoy 覆盖情况：
- 已知限制 / 坑：

## 完成后

回到 `../baostock-migration/plan.md` 末尾补「## 完成总结」，汇总 4 步实际改动与偏差。
