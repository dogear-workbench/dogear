---
step: 10
title: 龙虎榜
status: pending
---

## 目标
新增龙虎榜详情 + 机构席位追踪。

## 依赖上下文（接力棒输入）
- 项目当前完全没有龙虎榜数据
- AKShare 接口：
  - `stock_lhb_detail_em(start_date, end_date)` 按日期区间查全市场上榜明细，返回字段含代码/名称/上榜日/解读/收盘价/涨跌幅/龙虎榜净买额/上榜后1日/2日/5日/10日涨跌幅
  - `stock_lhb_jgstatistic_em(symbol)` symbol 是周期枚举 `"近一月"|"近三月"|"近六月"|"近一年"`

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_dragon_tiger_detail(start_date: str, end_date: str) -> pd.DataFrame` → `ak.stock_lhb_detail_em(...)`
  - `get_dragon_tiger_institution(period: str) -> pd.DataFrame` → `ak.stock_lhb_jgstatistic_em(symbol=period)`
- [ ] 新建 `python/core/dragon_tiger.py`：从全市场 detail 数据中按 symbol 过滤（可选，工具层传 symbol 时）
- [ ] `python-bridge.ts` 注册 2 个 method
- [ ] `stock-analysis-tools.ts` 加工具 `GetDragonTiger`：
  - 参数：`type: "detail" | "institution"`
  - detail 必填 start_date + end_date（YYYYMMDD），可选 symbol 过滤
  - institution 必填 period（枚举 `"近一月"|...`）
- [ ] 缓存策略：detail 1h、institution 1h

## 验证标准
- 调用 GetDragonTiger `{type: "detail", start_date: "20240101", end_date: "20240131"}` 返回该月龙虎榜
- 调用 GetDragonTiger `{type: "institution", period: "近一月"}` 返回机构席位追踪

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- `dragon_tiger.py` 已建
- 给 Step 11 的提示：研报数据是单股列表查询，新建 research.py
