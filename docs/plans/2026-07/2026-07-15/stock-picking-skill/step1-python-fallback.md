---
step: 1
title: Python 层双源降级
status: done
---

## 目标

在 `python/utils/akshare_client.py` 加通用降级基础设施，改造 `get_all_a_stocks` / `get_industry_list` 两个关键接口为双源；`python/main.py` 层把 `DataSourceExhausted` 转成结构化 JSON-RPC error。做完后手动 python 命令能验证主源挂时走备源、双源都挂时抛结构化异常。

## 依赖上下文（接力棒输入）

- 现有 `akshare_client.py` 已有的封装：`_retry` / `SimpleRateLimiter`（`_bulk_limiter` 5s / `_single_limiter` 0.5s）/ `TTLCache`，直接复用
- 现有 `python/main.py` JSON-RPC 协议：stdin 收请求 stdout 发响应，异常需要转成 `{ "error": {...} }` 格式（现有 handler 里有例子）
- 全局决策见 `plan.md`：异常名 `DataSourceExhausted(errors=[(name, msg), ...])`，DataFrame 用 `attrs['_source']` 标记数据源

## 计划改动

### `python/utils/akshare_client.py`

- [ ] 定义 `class DataSourceExhausted(Exception)`：`__init__(self, errors: list[tuple[str, str]])`，`__str__` 返回可读摘要
- [ ] 加 helper `_try_sources(*sources)`：按序尝试 `[(name, fn), ...]`，成功即返回 `df` 并设 `df.attrs['_source'] = name`；全失败抛 `DataSourceExhausted`
- [ ] 改 `get_all_a_stocks`：
  - 主源保留 `ak.stock_zh_a_spot_em`
  - 加备源 `ak.stock_zh_a_spot`（新浪）
  - 加内部 `_normalize_from_sina(df)` 归一化 columns 到东财格式，缺失字段（PE/PB/流通市值）留 `NaN`
  - 主体改成 `df = _try_sources(('eastmoney', lambda: ak.stock_zh_a_spot_em()), ('sina', lambda: _normalize_from_sina(ak.stock_zh_a_spot())))`
- [ ] 改 `get_industry_list`：
  - 主源保留 `ak.stock_board_industry_name_em`
  - 加备源 `ak.stock_board_industry_summary_ths`（同花顺，day2 验证活）
  - 加 `_normalize_from_ths_industry(df)` 归一化 columns
  - 主体改成 `_try_sources` 形式
- [ ] TTLCache 里存的 df 也要保留 `attrs['_source']`（pandas DataFrame.attrs 是浅拷贝，一般 OK，验证下）

### `python/main.py`

- [ ] 在通用异常捕获处加对 `DataSourceExhausted` 的特判，返回结构化 error：
  ```python
  { "error": { "code": "DATA_SOURCE_EXHAUSTED", "message": str(e), "data": { "attempts": e.errors } } }
  ```
- [ ] 其他常规异常仍走原有格式，不动

## 验证方式

在项目根跑：

```bash
# 1. 主源正常
python -c "from python.utils.akshare_client import get_all_a_stocks; df = get_all_a_stocks(); print(df.attrs.get('_source'), len(df))"
# 预期：eastmoney 5000+

# 2. 模拟主源挂（临时改主源 lambda 里直接 raise）
python -c "from python.utils.akshare_client import get_all_a_stocks; df = get_all_a_stocks(); print(df.attrs.get('_source'), 'PE' in df.columns)"
# 预期：sina, 且 PE 字段是 NaN 或不存在

# 3. 模拟双源全挂
python -c "from python.utils.akshare_client import get_all_a_stocks, DataSourceExhausted; ..."
# 预期：抛 DataSourceExhausted，__str__ 含两个源的错误摘要
```

验证完把临时的 raise 改回来。

## 边界情况 / 现场决策

- **`stock_board_industry_cons_ths` 在当前 akshare 版本被移除**（design 文档记录的未决问题）——本 step 只改 `get_industry_list`，不涉及 cons，暂不处理；如果 Step 2/3 端到端时发现走同花顺备源后拿不到行业成分股，届时再决定是"从全A快照按 industry 字段自筛"还是别的路子
- **新浪 `stock_zh_a_spot` 的 columns 名可能与东财差异较大**——归一化时以东财 columns 为基准表，无法映射的就留 NaN，不试图从别处补拉（那是二级降级的活）
- **`_source` 元信息在 cache 里是否保留**：`TTLCache` 现有实现如果对 df 做了 deep copy 会丢 attrs，验证时确认；如果丢就在 cache set/get 两端各存/还一次 `_source`

## 实施回填

### 实际改动

- `python/utils/akshare_client.py` — 新增 `DataSourceExhausted` 异常类、`_try_sources` helper、`_normalize_from_sina` / `_normalize_from_ths_industry` 归一化函数、改造 `get_all_a_stocks` / `get_industry_list` 走 `_try_sources`
- `python/main.py` — 导入 `DataSourceExhausted`、新增 `send_data_source_exhausted_error()` 手工拼 JSON 写 stdout（因为 `core/protocol.py` 的 `send_error` 不支持 data 字段，未改 protocol.py）、主循环 except 链新增 `DataSourceExhausted` 分支（放在 JSONDecodeError 后、通用 Exception 前）

### 与计划的差异 / 现场决策

1. **`_retry` 从两个改造函数中移除**：`_try_sources` 本身就是容错手段，`_bulk_limiter` 已限速，再套 `_retry` 会跟 plan.md「不做自动重试等待」冲突。其余 7 个函数的 `_retry` 保持不动。
2. **`send_error` 未扩展**：`core/protocol.py` 不在本 step 改动范围，改用 `main.py` 内的 `send_data_source_exhausted_error` 手工组装 JSON，其他常规异常仍走 `send_error(code, message)` 老路。
3. **新浪代码列前缀处理**：`stock_zh_a_spot` 返回带 `sh`/`sz`/`bj` 前缀（如 `sh600000`），东财是纯 6 位数字。归一化时用 `str.replace(r"^(sh|sz|bj)", "", regex=True)` 去掉。
4. **TTLCache 保留 attrs 已验证**：`python/utils/cache.py` 只存元组引用不 deep copy，`df.attrs['_source']` 天然保留，无需额外处理。

### 验证结果

1. **主源正常**：用假 df 验证 `_try_sources` 首选分支设 `attrs['_source']=='eastmoney'`，缓存命中仍在。真实东财路径本沙箱网络不可达（本 sandbox 层面），需在实际 Electron 打包环境二次确认（不影响本 step 完成度）。
2. **主源挂走备源**：本沙箱环境真实触发（非模拟），`get_all_a_stocks()` 拿到 5527 只股票 `attrs['_source']=='sina'`，代码去前缀正确，PE/PB/市值为 `pd.NA`；`get_industry_list()` 降级到 `ths`，90 个板块。
3. **双源全挂**：monkeypatch 双源全 raise，抛 `DataSourceExhausted`，`str(e)` = `"数据源全部失败（2 个）: eastmoney: ...; sina: ..."`。
4. **main.py JSON-RPC 层**：起子进程真实跑主循环，双源全挂时收到响应 `{"id":..., "error":{"code":"DATA_SOURCE_EXHAUSTED", "message":..., "data":{"attempts":[["eastmoney",...],["ths",...]]}}}`，结构与 plan.md 约定一致。

### 给下一步的接力棒

- `DataSourceExhausted` 从 `python.utils.akshare_client` 导出（供 main.py 判断类型用，已完成）
- `DataFrame.attrs['_source']` 是唯一的降级信号载体，值为 `'eastmoney'` / `'sina'` / `'ths'`
- `python/main.py` 结构化 error 具体形态：`{ error: { code: "DATA_SOURCE_EXHAUSTED", message: string, data: { attempts: [[name, msg], ...] } } }`，Step 2 TS 层需严格照此解析
- **遗留**：`stock_board_industry_cons_ths`（行业成分股同花顺备源）在当前 akshare 版本被移除，本 step 未涉及；Step 3 端到端跑 SOP 时若发现走同花顺备源后拿不到行业成分股，届时决定是"从全A快照按 industry 字段自筛"还是别的路子
