---
step: 1
title: baostock 客户端骨架
status: done
---

## 目标

在 `python/utils/baostock_client.py` 落地 baostock 三类接口的封装：全 A 快照拉取、行业分类、财务数据；含登录/登出管理和 TTL 缓存。**不需要接入 screener/financials**，本步只保证独立跑通、拉得到数据。

## 依赖上下文（接力棒输入）

- 姊妹文档：`../baostock-migration-design.md`（背景 + 字段对照表 + 未决问题）
- 参考实现：`python/utils/akshare_client.py`（缓存 + 限流 + 重试 + 双源降级的既有范式，本步可复用其 `TTLCache` 和 `_retry` 装饰器风格）
- 关键约束（来自 plan.md 全局决策）：
  - session 进程级单例，避免每次都 `bs.login()`
  - 字段名保留 baostock 原样（`peTTM` / `pbMRQ` / `turn` 等），不做中文化
  - 停牌过滤 (`tradestatus=0` / `volume=0`) **不在本步做**，留给 step2 的 snapshot 层

## 计划改动

- [ ] `python/requirements.txt` 添加 `baostock`（版本不锁死，用 pip 装最新）
- [ ] 手动 `pip install baostock` 验证包能装上
- [ ] 新建 `python/utils/baostock_client.py`：
  - [ ] 模块级 session 管理：`_ensure_login()` / `_logout_at_exit()`（用 `atexit` 注册）
  - [ ] `BaostockError` 异常类（含 `error_type` 字段：`LoginFailed` / `EmptyResult` / `ApiError`）
  - [ ] `get_industry_map() -> pd.DataFrame`：调 `bs.query_stock_industry()` 拿全市场股票→行业映射；列 `code / code_name / industry / industryClassification`；缓存 7 天
  - [ ] `get_all_stock_codes(date="") -> pd.DataFrame`：调 `bs.query_all_stock(day=date)` 拿当日全部证券代码（也用来判断该日是否交易日）；缓存 1 天
  - [ ] `get_stock_basic() -> pd.DataFrame`：调 `bs.query_stock_basic()` 拿全 A 基本信息（含总股本，用于市值派生）；缓存 7 天
  - [ ] `get_stock_k_data(code, start_date, end_date, frequency="d") -> pd.DataFrame`：调 `bs.query_history_k_data_plus()` 拉指定股票日 K，字段固定为 `date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,peTTM,pbMRQ,psTTM,pcfNcfTTM,isST`；用于快照拉取的单只调用
  - [ ] `get_financial_series(code, year_range=2) -> dict`：组合调 5 个财务接口（`query_profit_data` / `query_growth_data` / `query_operation_data` / `query_balance_data` / `query_cash_flow_data`），year_range 内每季度逐个拉，返回 `{"profit": df, "growth": df, ...}`；缓存 1 小时
  - [ ] `is_trade_date(date_str) -> bool`：调 `bs.query_trade_dates()` 判断某日是否交易日
- [ ] 模块末尾加 `if __name__ == "__main__"` 手工验证块：登录、调 4 个接口打印前 3 行，验证连通性

## 验收标准

- 命令行跑 `python -m utils.baostock_client`（在 `python/` 目录下）能看到 4 个接口的输出，无异常
- 单只 K 线拉取实测耗时记录一下（1 只 vs 10 只 vs 100 只），供 step2 估算全 A 5000 只的时长

## 实施回填（做完后填）

### 实际改动
- 新增 `python/utils/baostock_client.py`（~340 行）
- `python/requirements.txt` 追加 `baostock`（不锁版本）
- **与计划差异**：无功能性差异；实测发现 `query_stock_basic()` 不含总股本字段（design 文档「未决问题」猜测其含总股本，实测不含），需 step2 另想办法（见接力棒）

### 给下一步的接力棒
- **关键签名**（6 个导出 + 1 个异常类）：
  - `BaostockError(message, error_type)` — error_type ∈ {LoginFailed, EmptyResult, ApiError}
  - `get_industry_map() -> pd.DataFrame` — 列 `updateDate/code/code_name/industry/industryClassification`，缓存 7 天
  - `get_all_stock_codes(date="") -> pd.DataFrame` — 列 `code/tradeStatus/code_name`，缓存 1 天；非交易日返回空 DF 不抛（**可替代 is_trade_date 判断**）
  - `get_stock_basic() -> pd.DataFrame` — 列 `code/code_name/ipoDate/outDate/type/status`，**不含总股本**，缓存 7 天
  - `get_stock_k_data(code, start, end, freq="d") -> pd.DataFrame` — 18 列原样保留，无数据抛 `EmptyResult`，不缓存
  - `is_trade_date(date_str) -> bool`
  - `get_financial_series(code, year_range=2) -> dict` — 5 个财务子表，缓存 1 小时
- **单只 K 线拉取实测耗时**：1 只 0.09s / 10 只 0.72s（平均 0.072s/只） / 100 只 4.75s（平均 0.048s/只）；随批量摊薄，session/socket 复用生效
- **全 A 预估时长**：5000 × 0.06s ≈ 5 分钟（4~6 分钟区间，与 design 3-5 分钟基本吻合）
- **已知限制 / 坑**（step2 必读）：
  1. `query_stock_basic()` 不含总股本 `totalShare`，需从 `get_financial_series` 的 profit 子表拼装；若 step2 快照要派生市值，得对每只股票额外调财务接口（按年/季度单只查，不是批量接口），**会显著拖慢全 A 预拉**——step2 需评估：接受精度损失（跳过市值派生）/ 用其他轻量来源 / 一次性拉最新季度 profit 拼总股本
  2. `bs.login()/bs.logout()` 会打印 stdout（"login success!"），已用 `contextlib.redirect_stdout` 吞掉；其余 query 类不打印。这一点 design/plan 未提，对 python-bridge JSON-RPC 集成很关键
  3. `get_all_stock_codes(date="")` 在非交易日返回空 DataFrame 是**预期行为**（不抛异常），语义与 `is_trade_date` 可合一——step2 判断非交易日时直接看该结果空不空即可，不必额外调 `is_trade_date`
  4. 环境已预装 baostock，未触发新安装，无版本冲突
