# 股票域（stocks）

自选股行情页、行情数据三源接入、Python 计算层（指标/选股/公式/回测）、公司公告。

## 页面与组件（components/stock/）

- `app/stocks/page.tsx` — 自选股行情页（独立窗口路由 `#/stocks`，双栏：自选股列表+个股详情）
- `WatchList.tsx` / `StockSearch.tsx` — 自选股列表（右键删除）/ 搜索弹窗（东财 API 防抖）
- `StockQuote.tsx` — 行情卡片（30+ 字段，红涨绿跌）
- `KLineChart.tsx` — K 线图（Lightweight Charts v5：蜡烛+均线+成交量，分钟/日/周/月）
- `TimelineChart.tsx` / `MoneyFlow.tsx` — 分时图 / 资金流向柱状图
- `StockFundamental.tsx` / `DailySnapshotList.tsx` — 基本面网格 / 历史每日快照表格
- `StockDetail.tsx` — 个股详情容器（行情+K线+tab 切换）
- `shared/PriceText.tsx` / `shared/PercentBadge.tsx` — 价格着色 / 涨跌幅徽章

## Store 与类型

- `stores/stock-store.ts` — 自选股状态：watchlist/quotes/K线/分时/资金/搜索/限流状态
- `types/stock.ts` — WatchlistItem/StockQuote/KLineDataPoint 等全量类型

## 服务层（services/stock/）

- `rate-limiter.ts` — 请求防御：令牌桶+滑动窗口+断路器+请求合并+内存缓存
- `stock-service.ts` — 三数据源封装（腾讯行情/分时 + 东财 K线/搜索 + 新浪备用）
- `stock-watchlist-service.ts` — 自选股存储（`.dogear/stocks/watchlist.json`）
- `stock-data-service.ts` — K线+每日快照 JSONL 增量存储（`.dogear/stocks/kline/` + `.dogear/stocks/daily/`）
- `python-bridge.ts` — Python 守护进程通信（JSON-RPC over stdin/stdout）
- `python-venv.ts` — darwin 专用 venv 管理（Homebrew PEP 668 拒绝直装，依赖装 `<userData>/python-venv`；ensureVenv 探测/重建/创建 + Python ≥3.10 解析校验；win32 不走此模块）
- `formula-service.ts` — 公式 CRUD（`.dogear/stocks/formulas.json`，screener/signal/score）
- `announcement-service.ts` — 公告服务（巨潮资讯网）：orgId 映射懒抓、PDF 下载解析缓存、共享 rateLimiter

## Agent 工具（agents/tools/）

- `stock-tools.ts` — 行情六工具：SearchStock/GetStockQuote/GetKLineData/GetTimeline/GetWatchlist/ModifyWatchlist
- `stock-analysis-tools.ts` — 分析十工具，按三域分组：技术指标与信号（CalcIndicators/DetectSignals）、量化分析（ScreenStocks/GetFinancials/CompareIndustry/EvalFormula/SimpleBacktest）、板块与资金（ListIndustries/GetFundFlow/GetNorthboundHolding）；共享格式化助手在 `stock-format.ts`（safe/formatYuan/lastValue 等）
- `stock-picking-tools.ts` — 长期候选池两工具：PreheatLongTermPool（5 年视角候选池预热）/RankByLongTerm（排序）；配套 `services/stock/` 的 long-term-*（kline-indicators/preheat-service/rank-service/types）与 financials-cache-service
- `stock-announcement-tools.ts` — 公告两工具：ListAnnouncements/ReadAnnouncement（URL 必须原样从列表结果粘贴）

## 注意

- Python 计算层经 python-bridge JSON-RPC 通信，TS handler 不直接实现指标算法
- 公告 PDF 30MB 双层拦截（content-length+流式计数），只放行 `static.cninfo.com.cn` 防 SSRF
- 公告缓存只增不淘，清理走 clearAnnouncementCache；orgId 映射新股票找不到时懒重抓
- ScreenStocks 的 industry 需精确等值匹配东财板块名（先用 ListIndustries 查）

## 数据流

- 行情：Renderer → stock-store → tipc/stock → stockService（RateLimiter 防护）→ 腾讯/东财/新浪 API；getQuote 同时 fire-and-forget 写每日快照 JSONL
- 分析：AI 调分析工具 → TS handler → Python Bridge → Python 计算层 → 返回 AI
- 公告：ListAnnouncements → orgId 映射 → 巨潮 query API → markdown；ReadAnnouncement → 缓存命中直返 / 下载 PDF → python-bridge 解析 → 写缓存
