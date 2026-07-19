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
- [ ] [Step 3: screener 改造走本地快照](./step3-screener-migration.md) — `screen_stocks` / `ListIndustries` / 行业过滤从 snapshot 读
- [ ] [Step 4: financials 改造走 baostock 财务接口](./step4-financials-migration.md) — `get_financials` 主源换 baostock，同花顺兜底保留

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
