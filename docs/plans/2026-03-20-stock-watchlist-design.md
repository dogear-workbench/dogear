# 自选股行情系统设计

> 日期：2026-03-20
> 状态：设计完成

## 概述

在 Dogear 中新增自选股行情模块，支持自选股管理、个股详情（行情/K线/资金流向/基本面）、分时图，数据来源为东方财富公开 API。

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 数据源 | 东方财富 push2 API | 公开免费、无需认证、数据全面 |
| K线图 | lightweight-charts (TradingView) | 专为金融数据设计，轻量高性能 |
| 自选股存储 | JSON | 数据量小，整体读写，复用项目现有模式 |
| K线历史存储 | JSONL | 追加写入不需重新序列化，适合时序数据 |
| 页面入口 | 独立路由 `/stocks` | 与书籍/文章平行的一级功能 |

---

## 一、整体架构

```
数据层（Electron Main）
├── stock-service.ts            # 东方财富 API 请求 + RateLimiter 防御体系
├── stock-data-service.ts       # JSONL K线历史读写
└── stock-watchlist-service.ts  # JSON 自选股列表读写

IPC 层
└── tipc/stock.ts               # 股票相关 RPC 路由

前端层
├── stores/stock-store.ts       # Zustand 状态管理
├── app/stocks/page.tsx         # 股票主页面（/stocks 路由）
└── components/stock/           # 股票相关组件
```

**数据流**：前端 → tipc → stock-service（API 请求，经 RateLimiter）→ 缓存/存 JSONL → 返回前端

---

## 二、请求防御体系（核心）

### 2.1 架构分层

```
stock-service.ts（业务层）
    │
    ▼
RateLimiter（频率控制器）
    ├── TokenBucket      令牌桶：控制瞬时速率（2次/秒）
    ├── SlidingWindow    滑动窗口：控制总量（60次/分钟）
    ├── CircuitBreaker   断路器：连续失败时熔断
    └── RequestMerger    请求合并：相同请求去重
    │
    ▼
HttpClient（底层请求）
    ├── 超时控制（10s AbortController）
    ├── 指数退避重试（最多3次：2s → 4s → 8s）
    ├── 响应校验（空数据/错误码检测）
    └── 内存缓存（行情 10s TTL / K线按日缓存）
```

### 2.2 令牌桶（Token Bucket）

- 容量：2 个令牌
- 补充速率：每 500ms 补充 1 个
- 每次请求消耗 1 个令牌
- 无令牌时排队等待

### 2.3 滑动窗口（Sliding Window）

- 窗口大小：60 秒
- 最大请求数：60 次/窗口
- 记录每次请求时间戳，超限时拒绝并等待

### 2.4 断路器（Circuit Breaker）

```
CLOSED（正常）──连续3次失败──▶ OPEN（熔断，拒绝所有请求）
    ▲                              │
    │                         等待 30s
    │                              ▼
    └──────探测成功──────── HALF_OPEN（放行1个探测请求）
                                   │
                              探测失败 → 回到 OPEN，等待时间翻倍（最大 120s）
```

### 2.5 请求合并（Request Merger）

- 自选股列表行情：合并为 1 次批量请求（`fs` 参数拼接多股代码）
- 相同参数的重复请求：在飞行中的请求共享 Promise

### 2.6 失败处理策略

| 场景 | 检测方式 | 应对 |
|------|---------|------|
| 连接重置 (HTTP 000) | fetch 异常 | 触发断路器计数，指数退避重试 |
| HTTP 403 封禁 | 状态码 | 断路器直接 OPEN，等待 60s |
| 空数据返回 | `data.diff` 为空/null | 重试 1 次，间隔 3s |
| 超时 (>10s) | AbortController | 取消并重试，缩小请求量 |
| 连续 3 次失败 | 断路器 | 熔断，30s 后半开探测 |

### 2.7 缓存策略

```
请求个股行情 → 内存缓存命中？（10s TTL）
  ├── 命中 → 直接返回
  └── 未命中 → 请求 API → 写入缓存 → 返回

请求K线历史 → JSONL 本地有数据？
  ├── 有 → 读取最后一条日期，只请求之后的增量
  └── 没有 → 全量请求 → 写入 JSONL
```

### 2.8 前端防抖

- 刷新按钮：500ms 防抖
- 切换股票：300ms 防抖（快速切换时不发无用请求）
- 周期切换（日K/周K）：200ms 防抖

---

## 三、东方财富 API 接口

### 3.1 接口清单

| 接口 | 用途 | 域名/路径 |
|------|------|-----------|
| 行情列表 | 自选股批量行情 | `push2.eastmoney.com/api/qt/clist/get` |
| 个股实时 | 单股详细行情 | `push2.eastmoney.com/api/qt/stock/get` |
| K线历史 | 日K/周K/月K/分钟K | `push2his.eastmoney.com/api/qt/stock/kline/get` |
| 分时数据 | 当日分时图 | `push2.eastmoney.com/api/qt/stock/trends2/get` |
| 资金流向 | 主力/散户资金 | `push2.eastmoney.com/api/qt/stock/fflow/daykline/get` |
| 股票搜索 | 代码/名称模糊搜索 | `searchapi.eastmoney.com/api/suggest/get` |

### 3.2 行情全量字段

```
f1=market, f2=price, f3=changePercent, f4=changeAmount,
f5=volume, f6=turnover, f7=amplitude, f8=turnoverRate,
f9=peRatio, f10=volumeRatio, f11=fiveMinChange,
f12=code, f13=marketId, f14=name,
f15=high, f16=low, f17=open, f18=prevClose,
f20=totalMarketCap, f21=floatMarketCap, f22=speedPercent,
f23=pbRatio, f24=changePercent60d, f25=changePercentYTD,
f62=mainNetInflow, f115=peRatioTTM,
f128=leadStock, f136=leadStockChange, f152=reserved
```

### 3.3 K线参数

| 参数 | 说明 | 可选值 |
|------|------|--------|
| secid | 市场.代码 | "1.600519"（1=沪, 0=深） |
| klt | K线周期 | 1/5/15/30/60=分钟K, 101=日K, 102=周K, 103=月K |
| fqt | 复权类型 | 0=不复权, 1=前复权, 2=后复权 |
| lmt | 返回条数 | 120/250/0=全部 |
| end | 结束日期 | "20260320" 或 "20500101"=最新 |
| fields1 | 基本字段 | "f1,f2,f3,f4,f5,f6" |
| fields2 | K线字段 | "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" |

K线 fields2 含义：f51=日期, f52=开盘, f53=收盘, f54=最高, f55=最低, f56=成交量, f57=成交额, f58=振幅, f59=涨跌幅, f60=涨跌额, f61=换手率

---

## 四、数据模型

### 4.1 存储结构

```
.dogear/stocks/
├── watchlist.json              # 自选股列表
└── kline/
    ├── 1.600519.jsonl          # 贵州茅台 K线（沪市）
    ├── 0.000001.jsonl          # 平安银行 K线（深市）
    └── ...
```

### 4.2 TypeScript 类型

```typescript
// === 自选股 ===
interface WatchlistItem {
  code: string;            // "600519"
  market: number;          // 1=沪 0=深
  name: string;            // "贵州茅台"
  addedAt: string;         // ISO 时间
  sortOrder: number;       // 排序权重
  tags?: string[];         // 用户自定义标签
}

interface Watchlist {
  version: number;
  items: WatchlistItem[];
}

// === 实时行情 ===
interface StockQuote {
  code: string;
  name: string;
  market: number;
  price: number;
  changePercent: number;
  changeAmount: number;
  volume: number;
  turnover: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  amplitude: number;
  turnoverRate: number;
  peRatio: number;
  peRatioTTM: number;
  pbRatio: number;
  totalMarketCap: number;
  floatMarketCap: number;
  volumeRatio: number;
  speedPercent: number;
  fiveMinChange: number;
  mainNetInflow: number;
  changePercent60d: number;
  changePercentYTD: number;
  timestamp: number;
}

// === K线数据点（JSONL 每行一条）===
interface KLineDataPoint {
  date: string;            // "2026-03-20"
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  amplitude: number;
  changePercent: number;
  changeAmount: number;
  turnoverRate: number;
}

// === 分时数据 ===
interface TimelinePoint {
  time: string;            // "09:30"
  price: number;
  avgPrice: number;
  volume: number;
  turnover: number;
  changePercent: number;
}

// === 资金流向 ===
interface MoneyFlowPoint {
  date: string;
  mainInflow: number;      // 主力流入
  mainOutflow: number;     // 主力流出
  mainNetInflow: number;   // 主力净流入
  retailInflow: number;    // 散户流入
  retailOutflow: number;   // 散户流出
  retailNetInflow: number; // 散户净流入
}

// === 搜索结果 ===
interface StockSearchResult {
  code: string;
  name: string;
  market: number;
  type: string;            // 股票类型
}
```

---

## 五、前端页面与组件

### 5.1 页面布局

```
┌─────────────────────────────────────────────────┐
│  ← 返回    自选股行情              搜索🔍  ⚙️   │
├──────────────┬──────────────────────────────────┤
│  自选股列表    │  行情卡片（StockQuote）           │
│              │  ¥1,856.00  +2.35%  +42.60      │
│  📈 贵州茅台  ├──────────────────────────────────┤
│  📉 平安银行  │                                  │
│  📈 宁德时代  │  K线图（日K/周K/月K + 成交量副图） │
│              │                                  │
│  ─────────── ├──────────────────────────────────┤
│  + 添加股票   │  分时 | 资金流向 | 基本面          │
│              │  └ 底部 Tab 切换内容 ┘            │
└──────────────┴──────────────────────────────────┘
     240px                 剩余空间
```

### 5.2 组件树

```
app/stocks/page.tsx               # 路由入口
└── components/stock/
    ├── StockPage.tsx              # 页面容器，双栏布局
    ├── WatchList.tsx              # 左栏：自选股列表（拖拽排序、右键菜单）
    ├── StockSearch.tsx            # 搜索弹窗（模糊匹配 → 添加）
    ├── StockDetail.tsx            # 右栏容器
    │   ├── StockQuote.tsx         # 行情卡片（价格、涨跌、开高低收、市值等）
    │   ├── KLineChart.tsx         # K线图（Lightweight Charts 封装）
    │   │   ├── 周期切换：日K/周K/月K/1min/5min/15min/30min/60min
    │   │   ├── 复权切换：前复权/后复权/不复权
    │   │   ├── 成交量副图
    │   │   └── 均线叠加（MA5/10/20/60）
    │   ├── TimelineChart.tsx      # 分时图
    │   ├── MoneyFlow.tsx          # 资金流向图表
    │   └── StockFundamental.tsx   # 基本面数据
    └── shared/
        ├── PriceText.tsx          # 价格着色（红涨绿跌）
        └── PercentBadge.tsx       # 涨跌幅徽章
```

### 5.3 交互流程

1. **进入页面** → 加载 watchlist.json → 批量请求所有自选股行情（合并为 1 个 API 调用）→ 渲染列表
2. **点击某只股票** → 请求个股详情 + 日K线数据 → 右栏渲染
3. **切换K线周期** → 请求对应周期数据 → 图表刷新
4. **搜索添加** → 调用搜索 API → 选中 → 保存 watchlist.json → 刷新行情
5. **手动刷新** → 防抖 500ms → 批量更新行情
6. **拖拽排序** → 更新 sortOrder → 保存 watchlist.json

---

## 六、IPC 路由设计

```typescript
// tipc/stock.ts — 预计 RPC 列表
stockRouter = {
  // 自选股管理
  'stock:getWatchlist',          // 获取自选股列表
  'stock:addToWatchlist',        // 添加自选股
  'stock:removeFromWatchlist',   // 移除自选股
  'stock:reorderWatchlist',      // 排序自选股

  // 行情数据
  'stock:batchQuotes',           // 批量行情（自选股列表用）
  'stock:getQuote',              // 单股详细行情
  'stock:getKLine',              // K线历史数据
  'stock:getTimeline',           // 分时数据
  'stock:getMoneyFlow',          // 资金流向

  // 搜索
  'stock:search',                // 股票搜索

  // 状态
  'stock:getRateLimiterStatus',  // 获取限流器状态（调试用）
}
```
