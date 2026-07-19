# baostock 迁移实施计划

**目标**：让选股 SOP 能跑通（`ListIndustries` / `ScreenStocks` / `GetFinancials` 三条路径全部脱离东财 clist 依赖）。MVP 心态，能出结果就行，可行后再优化。

**架构思路**：新增 baostock 作为选股 SOP 唯一数据源；单只查询 + 全 A 快照本地缓存策略（`.dogear/stocks/daily_snapshot/{date}.jsonl`）；TS 侧 `stock-service.ts` 和 akshare 稳定接口全部保持不动；仅改 Python 侧 `screener.py` / `financials.py` 的底层数据源。排除 efinance（同源无效），排除整包迁移（MVP 不做）。

**背景**：见姊妹文档 `../baostock-migration-design.md`（背景/边界/未决问题全集）。

**涉及模块**：
- 新增：`python/utils/baostock_client.py`、`python/core/snapshot.py`
- 改造：`python/core/screener.py`、`python/core/financials.py`、`python/requirements.txt`
- 不动：`electron/main/services/stock/*.ts`、`python/utils/akshare_client.py`、`python/core/hsgt.py`、`python/core/fund_flow.py`、Agent 工具层（`stock-tools.ts` / `stock-analysis-tools.ts`）

## 步骤索引

- [x] [Step 1: baostock 客户端骨架](./step1-baostock-client.md) — 登录管理 + 三类接口封装 + TTL 缓存
- [x] [Step 2: 全 A 快照懒预拉与本地缓存](./step2-snapshot-cache.md) — snapshot.py 首次触发即拉、跨天重拉、派生字段计算
- [x] [Step 3: screener 改造走本地快照](./step3-screener-migration.md) — `screen_stocks` / `ListIndustries` / 行业过滤从 snapshot 读
- [x] [Step 4: financials 改造走 baostock 财务接口](./step4-financials-migration.md) — `get_financials` 主源换 baostock，同花顺兜底保留

## 全局决策

**Python 侧数据源分层（不要打破）**
- 选股 SOP 三个入口 → baostock
- 自选股实时行情 / K 线 → TS 侧 `stock-service.ts`（腾讯/东财/新浪，不动）
- 资金流 / 北向 → 现有 akshare 相关接口（本次不涉及）
- 雪球基本信息 / 巨潮行业 PE → 现有 akshare 接口保留

**baostock 使用规范**
- session 复用：进程级单例，避免每次调用都 `bs.login()`（登录本身要打网络）
- 拉取失败：单只跳过 + 记 log，不中断批量；连接级失败抛 `BaostockConnectionError`
- 字段命名：baostock 原始字段名（`peTTM` / `pbMRQ` / `turn` / `pctChg` 等）**保留原样入 JSONL**，不做中文化归一，让 screener 侧直接引用
- 停牌过滤：`tradestatus=0` 或 `volume=0` 的行在 snapshot 层丢弃，不落到 JSONL

**快照文件规范**
- 路径：`.dogear/stocks/daily_snapshot/{YYYY-MM-DD}.jsonl`（日期用 baostock 返回的实际交易日，非本地今天）
- 原子性：写入用 `.tmp` 后缀，写完 rename，保证要么完整要么不存在
- 保留策略：不主动清理旧文件（用户手动删；未来量大再说）

**错误传递**
- Python 侧异常统一走 `send_progress` / JSON-RPC error 返回，不吞
- baostock 相关错误要带上 `error_type`（`ConnectionError` / `LoginFailed` / `EmptyResult`），供 agent 判断该重试还是该报错

**MVP 明确不做的（等能跑通再说）**
- 定时刷新（首次触发即拉，一天一次）
- 并发/多线程拉取（串行即可）
- 快照多源合并降级（baostock 挂了就报错，不再走 akshare 兜底）
- akshare_client 里挂掉的接口清理（挂着即可）

## 完成总结

选股 SOP 三条路径（ScreenStocks / ListIndustries / GetFinancials）全部脱离东财 clist 依赖，改走 baostock 数据源；同花顺作为 GetFinancials 兜底保留；实测 5481 只有效 A 股快照约 7 分钟一次性预拉，之后本地缓存毫秒命中。

**实际改动清单**：
- 新增 `python/utils/baostock_client.py`（6 个接口 + BaostockError + 进程级 session 单例 + TTL 缓存 + stdout 噪声吞掉）
- 新增 `python/core/snapshot.py`（懒预拉 + 本地 JSONL 缓存 + 原子写入 + 派生字段占位）
- 改造 `python/core/screener.py::screen_stocks`（数据源换成 snapshot + industry_map join，字段用 baostock 原名，market_cap 条件走警告分支）
- 改造 `python/main.py::handle_list_industries`（同样切换到 snapshot + 按行业分组聚合）
- 改造 `python/core/financials.py::get_financials`（新增 baostock 主路径，同花顺降级兜底，两条路径 `_source` 标注来源）
- 同步改 `electron/main/agents/tools/stock-analysis-tools.ts` 三处工具描述（"东财板块名" → "证监会行业分类名"）
- `python/requirements.txt` 加 `baostock`

**与原计划的关键偏差**（用户已决策通过）：
1. **snapshot 跳过市值派生**（step2）：`get_stock_basic()` 实测无总股本字段，`total_market_cap` / `float_market_cap` / `volume_ratio` 三个字段 NaN 占位；screener 侧市值筛选条件走警告不误伤
2. **industry 命名体系变化**（step3）：baostock 用证监会分类（"J66货币金融服务"），跟东财板块名（"银行"）完全不重叠；改工具描述引导 agent 先查 ListIndustries，未做归一化映射
3. **financials 部分字段无数据**（step4）：baostock 无扣非净利润 / 每股净资产 / 每股经营现金流；mom / single_yoy 全部 MVP 不做

**已知遗留问题**（后续可能需要处理）：
1. **`debt_ratio` 数据质量**：baostock `liabilityToAsset` 多数历史季度原始值小 100 倍，导致 debt_ratio 展示失真偏小；未做启发式修正——建议在 GetFinancials 工具描述或 stock-picking skill 提示 agent 交叉验证
2. **市值筛选完全不可用**：需要独立解决股本数据源问题
3. **CSRC 分类粒度问题**：J66 混少量非银金融，agent 拿到结果需自行辨识
4. **revenue Q1/Q3 常空**：baostock 只在半年报/年报稳定披露 MBRevenue
5. **快照首次同步阻塞 7 分钟**：接入 python-bridge 时建议加异步预热命令
6. **pyc 缓存文件被 tracked**（历史遗留，非本次引入）：与 baostock 迁移无关，可另起清理任务

**未做但已规划的后续（超 MVP 范围）**：
- snapshot 定时刷新（当前首次触发即拉，一天一次；后续可上定时任务）
- 全 A 拉取并发化（当前串行 7 分钟，加并发可压到 2-3 分钟）
- 快照多源合并降级（当前 baostock 挂了直接报错，未来可加 akshare 兜底）
- 累计口径 → 单季度差分（financials `_source` 已标注让 agent 感知，未做转换）
- akshare_client 里已挂掉的接口清理（挂着不影响）
