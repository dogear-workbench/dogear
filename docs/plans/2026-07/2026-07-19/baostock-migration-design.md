# 引入 baostock 打通选股 SOP 设计

## 背景

- 东财 `push2.eastmoney.com` 系列 clist 接口（`stock_zh_a_spot_em` / `stock_board_industry_name_em` 等）被服务端主动断连，属外部服务端反爬/限流，非本地问题（详见 `shared/notes/spot-em-error-context.md` 的 curl 独立验证）。
- 由此选股 SOP 的第 1、2 步（`ListIndustries` 找候选板块、`ScreenStocks` 按 PE/PB/市值/涨跌幅筛全 A）无法进行。现有代码已有新浪/同花顺降级，但字段严重不全（PE/PB/市值全部 NaN），不足以支撑选股。
- efinance 底层同样打东财 push2 域名，换过去无效。baostock 是证券宝独立服务器（socket 长连接协议），完全不受东财封禁影响。

## 目标

**MVP：让选股 SOP 能跑通。** 不追求优雅，不做花活，能出结果就试试。可行后再优化。

具体验收标准：
- `ListIndustries` 能列出中文行业名
- `ScreenStocks` 能按 PE/PB/市值/换手/涨跌幅/行业组合条件过滤全 A 并返回结果
- `GetFinancials` 能返回营收/净利润/ROE/毛利率的近几年季度序列
- 全流程无东财 clist 依赖

## 架构

**分层定位**：
- `stock-service.ts`（TS 侧腾讯/东财/新浪 API 三源）**保持不动**——这是自选股实时行情/K 线展示专用，跟选股 SOP 是两条独立路径
- `python/utils/akshare_client.py` **不删不改**——挂掉的接口挂着即可，选股 SOP 不再走它；仍稳定的接口（雪球基本信息、巨潮行业 PE 等）保留
- **新增 baostock 作为选股 SOP 的唯一数据源**（全 A 快照 / 行业分类 / 财务）

**核心策略**：预拉全 A 快照 + 本地缓存
- baostock 是单只按 code 查询，无批量 spot 接口
- 选股需要全市场视图 → 预拉当日全 A 日 K last row 落地到 JSONL
- `ScreenStocks` 从本地快照读，不打网络
- 当日快照存在即直接用，跨天自动重拉

**排除的选项**：
- 换 efinance：同源无效
- 只加 baostock 作行业分类第三降级源：救不了核心痛点（全 A 快照）
- 整包迁移 15 个接口：MVP 阶段不做，只迁选股 SOP 需要的路径

## 模块边界

**新增文件**
- `python/utils/baostock_client.py`
  - 登录/登出管理（session 复用，避免每次调用都 login）
  - `get_all_a_snapshot(date)`：拉全 A 当日日 K last row，含字段派生（市值/振幅/量比）
  - `get_industry_map()`：`query_stock_industry` 拉全市场股票→行业映射
  - `get_financial_series(code, quarters=8)`：组合调用 `query_profit_data` / `query_growth_data` / `query_operation_data` / `query_balance_data` / `query_cash_flow_data`
  - TTL 缓存（全 A 快照 8h、行业映射 7 天、财务 1h）
- `python/core/snapshot.py`
  - 懒预拉逻辑：第一次调用 `get_snapshot()` 时检查 `.dogear/stocks/daily_snapshot/{date}.jsonl` 是否存在，无则拉、有则读
  - 派生字段计算：总市值 = `close × 总股本`（总股本来自 baostock `query_stock_basic`）、振幅 = `(high-low)/preclose`、量比 = `volume / 近5日均量`
  - 停牌过滤：`tradestatus=0` 或 `volume=0` 的行剔除

**改造文件**
- `python/core/screener.py`
  - `ScreenStocks` 数据源从 `ak.stock_zh_a_spot_em()` 改为 `snapshot.get_snapshot()`
  - 行业筛选从 `ak.stock_board_industry_cons_em(industry=name)` 改为 `snapshot` 内联的 industry 列过滤
  - `ListIndustries` 从 `ak.stock_board_industry_name_em()` 改为 baostock `query_stock_industry` 的行业名去重
- `python/core/financials.py`
  - `GetFinancials` 主源改 baostock `get_financial_series`
  - 保留旧同花顺接口作为兜底（不删）
- `python/requirements.txt`：添加 `baostock`

**不改动**
- `electron/main/services/stock/*.ts`（TS 侧全部保持）
- `electron/main/agents/tools/stock-tools.ts`（工具名/参数不变，agent 侧无感）
- `electron/main/agents/tools/stock-analysis-tools.ts`（工具接口不变，只是底层实现换了）
- `python/core/hsgt.py` / `python/core/fund_flow.py`（资金流/北向 baostock 覆盖不了，暂搁置，选股 SOP 不依赖）

## 数据流

**选股请求链路**
```
Agent 调 ScreenStocks(industry="食品饮料", pe_max=30, pb_max=5)
  ↓ TypeScript handler → python-bridge JSON-RPC
python screener.screen_stocks(conditions)
  ↓ snapshot.get_snapshot() 检查 daily_snapshot/{today}.jsonl
    ├─ 命中：直接读 (~毫秒级)
    └─ 未命中：baostock_client.get_all_a_snapshot() 拉全 A（~3-5 分钟串行）
       ├─ 期间 python-bridge 保持连接不断（长任务模式）
       └─ 拉完落 JSONL 并返回 DataFrame
  ↓ pandas 应用筛选条件（行业过滤 / PE/PB/市值/换手区间 / 技术指标）
  ↓ 返回 top N 结果给 agent
```

**快照 JSONL 结构**（`.dogear/stocks/daily_snapshot/2026-07-19.jsonl`）
每行一条股票记录，字段：
- 基础：`code` / `name` / `industry` / `date`
- 行情：`open` / `high` / `low` / `close` / `preclose` / `volume` / `amount` / `turn` / `pctChg` / `tradestatus` / `isST`
- 估值：`peTTM` / `pbMRQ` / `psTTM` / `pcfNcfTTM`
- 派生（本地算）：`total_market_cap` / `float_market_cap` / `amplitude` / `volume_ratio`

## 错误处理 / 边界情况

- **baostock 登录失败**：抛 `BaostockConnectionError`，工具返回 `isError: true` + 明确原因（未安装 / 网络不通），不做静默降级
- **单只股票拉取失败**：跳过并记 log，不中断整批预拉（5000 只里挂几只可接受，只要主体成功）
- **快照预拉中断**：不写半成品 JSONL，用 `.tmp` 后缀落盘、拉完 rename，保证要么完整要么不存在
- **跨天首次调用**：`get_snapshot()` 内部走"未命中"分支，agent 侧会等 3-5 分钟——python-bridge 的调用超时要够长（现有超时若不够要放宽）
- **停牌股 / ST 股**：`snapshot` 拉取时保留，`ScreenStocks` 默认过滤 `tradestatus=0`；`isST` 由 agent 通过筛选条件显式排除
- **周末 / 非交易日**：baostock 拉不到当日数据（返回空），此时应自动回退到最近一个交易日 —— 由 `snapshot.py` 用 baostock `query_trade_dates` 判断

## 未决问题（实施时补）

- **实际预拉时长**：估算 3-5 分钟，但 baostock 长连接协议的真实吞吐待跑测才知道。若超过 10 分钟需考虑降低目标（先只拉常见板块 / 分批）
- **python-bridge 超时**：现有 IPC 超时是否足以撑住一次冷启动预拉？可能需要加"流式进度回传"让前端不显示假死
- **baostock session 存活**：长时间不操作会不会掉线？需要探测重连策略
- **总股本字段来源**：`query_stock_basic` 是否有总股本？若无需要用财务接口 `query_balance_data` 里的 `totalShare` 拼装，会拖慢预拉
- **快照过期后自动重拉**：MVP 只做"当天有就用、跨天重拉"。未来是否要盘中定时刷（比如 15 点收盘后自动重拉当日）留后续
- **巨潮公告集成**：现有 `mcp__dogear-stock-announcement__*` 保持不动，agent 在深挖阶段按需调用即可，不做整合

## 实施拆分建议

按 staged-impl 大致 4 步：
1. **step1-baostock-client**：`baostock_client.py` 骨架 + 登录管理 + 全 A 快照拉取（单只循环）+ 手动脚本验证时长
2. **step2-snapshot-cache**：`snapshot.py` 懒预拉 + JSONL 落盘 + 派生字段 + 非交易日回退
3. **step3-screener-migration**：改造 `screener.py` 的 `ScreenStocks` / `ListIndustries` / 行业过滤走 snapshot
4. **step4-financials-migration**：改造 `financials.py` 的 `GetFinancials` 走 baostock 5 个财务接口

每步验收都是"选股 SOP 的某一环能跑通"，不做单测（项目偏好）。
