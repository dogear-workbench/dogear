# 股票域（stocks）

行情数据三源接入、Python 计算层（指标/选股/公式/回测）、公司公告。

> 2026-10：自选股行情独立窗口展示层（页面/组件/store/tipc/前端类型）已下线，实际使用路径是 agent 跑完整流程直接出 markdown 报告；agent 工具链与服务层全部保留。
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

- 行情：agent 工具 → services/stock/stockService（RateLimiter 防护）→ 腾讯/东财/新浪 API；getQuote 同时 fire-and-forget 写每日快照 JSONL
- 分析：AI 调分析工具 → TS handler → Python Bridge → Python 计算层 → 返回 AI
- 公告：ListAnnouncements → orgId 映射 → 巨潮 query API → markdown；ReadAnnouncement → 缓存命中直返 / 下载 PDF → python-bridge 解析 → 写缓存
