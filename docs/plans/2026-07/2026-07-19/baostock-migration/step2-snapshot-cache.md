---
step: 2
title: 全 A 快照懒预拉与本地缓存
status: done
---

## 目标

新建 `python/core/snapshot.py`，实现「首次调用触发预拉、跨天自动重拉」的全 A 日快照能力。产出 `.dogear/stocks/daily_snapshot/{date}.jsonl`，包含 baostock 原始字段 + 派生字段（总市值/流通市值/振幅/量比）。**不接入 screener**，本步只保证 `snapshot.get_snapshot()` 能返回一个可用的 DataFrame。

## 依赖上下文（接力棒输入）

- Step 1 产出：`python/utils/baostock_client.py` 提供 `get_all_stock_codes` / `get_stock_k_data` / `get_stock_basic` / `get_industry_map` / `is_trade_date`
- Step 1 实测：单只 K 线拉取耗时 → 决定本步串行拉全 A 是否需要中途 progress 回传
- 关键约束（来自 plan.md）：
  - 快照路径 `.dogear/stocks/daily_snapshot/{YYYY-MM-DD}.jsonl`，日期用 baostock 返回的**实际交易日**，非本地今天
  - 原子写入：`.tmp` 后 rename
  - 停牌过滤：`tradestatus=0` 或 `volume=0` 的行直接丢
  - 字段名保留 baostock 原样，派生字段用英文下划线（`total_market_cap` / `float_market_cap` / `amplitude` / `volume_ratio`）

## 计划改动

- [ ] 新建 `python/core/snapshot.py`：
  - [ ] `_get_snapshot_dir() -> Path`：从环境变量或默认路径拿 `.dogear/stocks/daily_snapshot/`（参考现有 `stock-data-service.ts` 的路径约定，需要看 Python 侧现在是怎么拿 `.dogear` 根目录的 —— 若无先加个 `get_dogear_root()`）
  - [ ] `_resolve_trade_date() -> str`：用 baostock `is_trade_date` 从今天倒推，找到最近一个交易日
  - [ ] `_snapshot_path(date) -> Path`
  - [ ] `_pull_full_a(trade_date) -> pd.DataFrame`：
    - 从 `get_all_stock_codes(trade_date)` 拿当日全部 A 股代码（过滤指数/基金，只保留 `sh.6*` / `sz.0*` / `sz.3*`；北交所 `bj.*` 可选）
    - 从 `get_stock_basic()` 拿总股本、流通股本、行业（一次性）
    - 从 `get_industry_map()` 拿行业名映射
    - 逐只调 `get_stock_k_data(code, start=trade_date, end=trade_date)` 拉当日单行数据
    - 失败的单只：log 一条并跳过
    - 每拉 500 只调 `send_progress(request_id, ...)` 回传进度（本步先支持可选 request_id）
    - 停牌过滤：drop `tradestatus == '0' | volume == 0`
    - 数值转型：baostock 返回全是 string，需要 `to_numeric(errors='coerce')` 对数值列转型
    - 派生字段计算（下方独立子函数）
  - [ ] `_add_derived_fields(df, stock_basic_df) -> pd.DataFrame`：
    - `total_market_cap = close × totalShare`（元）
    - `float_market_cap = close × liqaShare`（元）
    - `amplitude = (high - low) / preclose`（小数，非百分比）
    - `volume_ratio` **本步先不算**（需要近 5 日均量，涉及多日 K 拉取，MVP 不做，留字段但填 NaN）
  - [ ] `_atomic_write_jsonl(df, path)`：写 `path.tmp` 后 rename
  - [ ] `get_snapshot(request_id="", force_refresh=False) -> pd.DataFrame`（对外主入口）：
    - 计算当前交易日
    - 命中 `_snapshot_path(date)` 且非 `force_refresh` → 直接 `pd.read_json(path, lines=True)`
    - 未命中 → `_pull_full_a` → 落盘 → 返回
- [ ] 手动脚本验证：
  - 首次调用：跑 `python -c "from core.snapshot import get_snapshot; print(get_snapshot().head())"`，观察时长 + 输出
  - 二次调用：应命中缓存秒返
  - 检查 JSONL 文件字段完整性

## 验收标准

- 首次调用能拉到 4000+ 只有效股票（过滤停牌后）
- JSONL 文件包含全部 baostock 原始字段 + 4 个派生字段（`volume_ratio` 允许 NaN）
- 二次调用毫秒级返回
- 中断进程后不会留下损坏的半成品文件

## 实施回填（做完后填）

### 实际改动
- 新建 `python/core/snapshot.py`（~192 行，唯一改动文件）
  - `get_dogear_root()` 读 `DOGEAR_CONFIG_DIR` 环境变量，回退 `~/.dogear`（与 TS 侧 getConfigDir 对齐）
  - `_resolve_trade_date()` 用 `get_all_stock_codes(date=)` 空 DF 判断非交易日（合并 is_trade_date 语义）
  - `_pull_full_a()` 过滤 `sh.6*/sz.0*/sz.3*`，逐只拉取，单只失败跳过；每 500 只 `send_progress`（request_id 空则跳过）
  - `_add_derived_fields()` 按用户决策：`total_market_cap`/`float_market_cap`/`volume_ratio` 固定 NaN，只算 `amplitude`
  - `_atomic_write_jsonl()` 写 `.tmp` 后 `os.replace`
- **与计划差异**：
  1. **未做 `get_stock_basic()` join** —— 用户已确认跳过市值派生，接力棒决策
  2. **未做 `get_industry_map()` 行业 join** —— 范围裁剪到 step3；industry_map 缓存 7 天，screener 用到时再 join 无性能损失

### 给下一步的接力棒
- **`get_snapshot()` 返回 DataFrame 列清单（22 列）**：
  ```
  date, code, open, high, low, close, preclose, volume, amount, adjustflag,
  turn, tradestatus, pctChg, peTTM, pbMRQ, psTTM, pcfNcfTTM, isST,
  total_market_cap(NaN), float_market_cap(NaN), amplitude, volume_ratio(NaN)
  ```
- **全 A 拉取实测总时长**：432.5s（约 7.2 分钟），比 step1 预估 5 分钟略慢，量级一致
- **拉取失败股票数 / 占比**：0 / 0%，5486 候选 → 5481 有效（停牌过滤 5 只）
- **JSONL 文件**：`~/.dogear/stocks/daily_snapshot/{date}.jsonl`，约 2.1MB
- **已知限制 / 坑（step3 必读）**：
  1. **快照无 industry 列**：screener 做行业过滤需自行 `pd.merge(get_industry_map(), on="code")`；industry_map 有 7 天缓存，重复调无痛
  2. **无股本 → 无真实市值**：`total_market_cap`/`float_market_cap` 是 NaN 占位，**不可用于市值筛选条件**；若 screener 需按市值筛，得另想办法或明确告诉 agent 该条件不可用
  3. **get_snapshot() 同步阻塞 7 分钟**：接入 python-bridge 时**必须异步/带 progress**，不能同步等待（会阻塞其他 RPC）；建议 python-bridge 端加一个 `warmupSnapshot` 类的独立命令，让 agent 先起预热再查
  4. **"毫秒级缓存命中"限同进程**：`_resolve_trade_date` 内部 TTLCache 生命周期 = 进程生命周期，每次新起 `python -c ...` 还是要 3-5s 重新 login + 查交易日历；生产走常驻 python-bridge 不受影响
  5. 停牌过滤已在 snapshot 层完成，screener 侧不用再判 `tradestatus`
