# 股票分析系统增强 — 整体架构设计

> 2026-04-15 | 设计文档 | 状态：讨论中

## 1. 背景与目标

### 1.1 现状

当前 Dogear 的股票模块具备基础的行情查看能力：

- **数据源**：腾讯财经（实时行情）、东方财富（K线历史）、新浪（K线备用）
- **AI 工具**：6 个基础工具（SearchStock、GetStockQuote、GetKLineData、GetTimeline、GetWatchlist、ModifyWatchlist）
- **存储**：K线 JSONL + 每日快照 JSONL 自动采集（内盘外盘等 API 无法提供的数据）
- **前端**：K线图（Lightweight Charts v5）、分时图、行情卡片、自选股列表
- **防护**：令牌桶 + 滑动窗口 + 断路器三层请求防御

### 1.2 核心缺口

| 缺口 | 说明 |
|------|------|
| **计算能力为零** | AI 拿到原始 OHLCV，无法获取 MACD/RSI 等技术指标，不可能让 AI "脑算" |
| **没有筛选能力** | 只能查单只股票，无法"找价格 10-30 元的消费股" |
| **没有策略框架** | 用户的分析逻辑无法固化，每次都要重新描述 |
| **基本面数据缺失** | 缺少财报（营收增长、净利润、ROE）、行业对比等数据 |

### 1.3 设计宗旨

> **AI 是军师，不是决策者。**

- **确定性的计算固化为代码** — 技术指标、公式筛选、回测，由程序执行，AI 不猜数字
- **AI 做泛化分析** — 综合多维度数据、串联信息、趋势判断、风险提示
- **能脚本化的就脚本化** — 减少给 AI 空泛指令，给精确数据让它做更高层的推理
- **用户可定义公式** — 像证券软件一样自定义指标和策略

---

## 2. 整体架构

```
                      AI Agent（军师）
                         ↓ 调用工具
         ┌───────────────┼───────────────┐
         ↓               ↓               ↓
    数据获取层         计算分析层        策略执行层
   (Python/HTTP)     (Python)          (Python)
         │               │               │
    ┌────┤          ┌────┤          ┌────┤
    │ AKShare       │ 技术指标      │ 公式引擎
    │ 腾讯行情API   │ 财务分析      │ 筛选器
    │ 东方财富API   │ 行业对比      │ 回测
    │ (按需获取)    │ (纯函数)      │ (信号检测)
    └────┘          └────┘          └────┘

    Electron 主进程 (TypeScript)
    ├── Python Bridge（child_process，JSON-RPC 通信）
    ├── Agent 工具定义 + 调度协调
    ├── IPC 路由 + 前端渲染
    └── 现有数据源 + 存储（保持不变）
```

### 2.1 职责划分

| 层 | 语言 | 职责 |
|----|------|------|
| **Python** | Python 3 + AKShare + pandas + numpy | 数据获取（全市场）、指标计算、公式解析执行、筛选、回测 |
| **TypeScript（主进程）** | Node.js / Electron | Python Bridge 管理、Agent 工具定义、IPC 路由、已有数据源（腾讯/东方/新浪）、存储 |
| **TypeScript（渲染进程）** | React + Zustand | UI 渲染、用户交互 |

**为什么引入 Python？**
- 量化计算是 Python 生态的强项（pandas/numpy 天然适配）
- AKShare 提供了极其丰富的 A 股数据源，远超自己封装 HTTP API
- 技术指标公式在 Python 中实现更简洁、更可靠
- 用户可接受安装 Python 依赖

---

## 3. Python Bridge 设计

### 3.1 通信架构

Electron 通过 `child_process.spawn('python', ['python/main.py'])` 启动一个**持久化**的 Python 守护进程，通过 stdin/stdout 交换 NDJSON（换行分隔 JSON）。

**为什么是持久进程而非每次 spawn？**
- Python 冷启动 + AKShare 导入 ≈ 2-5 秒
- 持久进程将启动成本摊销到首次调用
- 后续调用延迟 < 100ms

### 3.2 通信协议

```
→ Request（TS → Python, stdin）
{"id":"req-001","method":"calc_indicators","params":{"kline":[...],"indicators":["MACD","RSI"]}}

← Response（Python → TS, stdout）
{"id":"req-001","result":{"MACD":{"DIF":[...],"DEA":[...],"MACD":[...]},"RSI":{"RSI":[...]}}}

← Error
{"id":"req-001","error":{"code":-1,"message":"Invalid indicator params"}}

← Progress（长时间操作，如全市场筛选）
{"id":"req-002","progress":{"current":150,"total":5000,"message":"筛选中..."}}
```

### 3.3 PythonBridge 服务类

位置：`electron/main/services/stock/python-bridge.ts`

关键行为：

| 特性 | 说明 |
|------|------|
| **懒启动** | 首次调用时 spawn，不在应用启动时启动 |
| **环境检测** | 探测 `python3` → `python` → `py`（Windows），缓存解释器路径 |
| **健康检查** | 启动后发 `ping`，5秒内收到 `pong` 才标记为可用 |
| **请求匹配** | `Map<id, {resolve, reject, timeout}>`，UUID 匹配请求响应 |
| **超时管理** | 指标计算 30s、筛选 120s、回测 300s，超时 reject + 可选重启 |
| **崩溃恢复** | 进程异常退出 → reject 所有 pending → 下次调用时重新 spawn |
| **断路器** | 连续 3 次崩溃触发冷却（复用 rate-limiter 模式） |
| **优雅关闭** | `app.will-quit` 时发 `shutdown` 命令 + 2s 后 kill |

### 3.4 Python 环境依赖

```
# python/requirements.txt
akshare>=1.14
pandas>=2.0
numpy>=1.24
lark>=1.1       # 公式解析器
```

首次调用时检测：`python -c "import akshare, pandas, numpy, lark"`
- 成功 → 正常工作
- 失败 → 前端 toast 提示用户安装依赖（给出具体命令）

---

## 4. 技术指标计算引擎

### 4.1 内置指标

全部在 Python 中用 pandas/numpy 实现，零外部数据依赖：

| 类别 | 指标 | 函数签名 | 默认参数 |
|------|------|---------|---------|
| **趋势** | MA（简单移动均线） | `MA(series, period)` | period=20 |
| | EMA（指数移动均线） | `EMA(series, period)` | period=20 |
| | MACD | `MACD(series, fast, slow, signal)` | 12, 26, 9 |
| | BOLL（布林带） | `BOLL(series, period, width)` | 20, 2 |
| **震荡** | KDJ | `KDJ(high, low, close, n, m1, m2)` | 9, 3, 3 |
| | RSI | `RSI(series, period)` | 14 |
| | WR（威廉） | `WR(high, low, close, period)` | 14 |
| **量价** | OBV（能量潮） | `OBV(close, volume)` | — |
| | VWAP | `VWAP(high, low, close, volume)` | — |
| **波动** | ATR（真实波幅） | `ATR(high, low, close, period)` | 14 |

### 4.2 数据流

```
AI 调用 CalcIndicators 工具
    ↓
TypeScript 工具 handler：
  1. 通过现有 stockService.getKLine() 获取 K 线数据
     （复用已有的缓存 + 限流 + 备用源逻辑）
  2. 将 K 线数据发送给 Python Bridge
    ↓
Python indicators.py：
  1. 接收 K 线数组，转 DataFrame
  2. 计算请求的指标
  3. 返回最新 N 天的指标数值
    ↓
TypeScript 格式化结果：
  "MACD(12,26,9) 最新: DIF=2.15, DEA=1.98, 柱=0.17 (金叉形态)
   RSI(14) 最新: 58.3 (中性区间 40-60)"
    ↓
AI 综合分析 → 给用户建议
```

**关键设计决策**：K 线数据由 TypeScript 获取（复用现有 stockService 的缓存/限流/容错），Python 只做纯计算。这避免了在 Python 中重复实现数据获取逻辑。

---

## 5. 数据扩展（AKShare）

### 5.1 新增数据源

通过 AKShare 按需获取全市场数据，**不做全量本地缓存**：

| 数据 | AKShare 函数 | 用途 | 缓存策略 |
|------|-------------|------|---------|
| 全 A 股实时快照 | `stock_zh_a_spot_em()` | 筛选基础数据 | 60s |
| 行业板块列表 | `stock_board_industry_name_em()` | 行业分类 | 24h |
| 行业成分股 | `stock_board_industry_cons_em(symbol)` | 行业筛选 | 24h |
| 财报摘要 | `stock_financial_abstract_ths(symbol)` | 基本面分析 | 1h |
| 财务指标 | `stock_financial_analysis_indicator(symbol)` | ROE/毛利率等 | 1h |
| 历史日K（备用） | `stock_zh_a_hist(symbol, ...)` | 东方财富失败时备用 | 60s |

### 5.2 数据源分工

```
实时行情 ──→ 腾讯财经（已有，稳定宽松）
K线历史 ──→ 东方财富（已有）+ 新浪备用（已有）+ AKShare 备用（新增）
全市场快照 ──→ AKShare（新增，单次调用返回全市场）
行业分类 ──→ AKShare（新增）
财报数据 ──→ AKShare（新增）
```

### 5.3 AKShare 限流策略

Python 端内置限流（`akshare_client.py`）：

| 类型 | 限制 | 说明 |
|------|------|------|
| 批量接口 | 1次/5秒 | `stock_zh_a_spot_em()` 等全市场调用 |
| 单股接口 | 2次/秒，60次/分钟 | `stock_financial_abstract_ths()` 等逐股调用 |
| 错误重试 | 指数退避 1s→2s→4s，最多 3 次 | 应对临时网络问题 |

---

## 6. 选股筛选系统

### 6.1 筛选流程

```
用户描述（自然语言）："找 PE 低于 20 的消费股"
    ↓
AI 解析意图 → 构造结构化条件
    ↓
调用 ScreenStocks 工具：
  { conditions: { pe_max: 20, industry: "食品饮料" } }
    ↓
Python screener.py 执行：
  1. AKShare stock_zh_a_spot_em() → 全 A 股快照（~5000只）
  2. 按行业过滤 → 候选列表
  3. 按基本面条件过滤（PE、PB、市值等）
  4. 如有技术指标条件 → 逐股获取K线 + 计算指标 + 过滤
  5. 排序 + 限制结果数量
  6. 返回结果列表
    ↓
AI 分析筛选结果 → 给出评述
```

### 6.2 筛选条件类型

| 类别 | 条件示例 |
|------|---------|
| **基本面** | PE、PB、市值、流通市值、行业 |
| **行情** | 价格区间、涨跌幅、换手率、成交量 |
| **技术指标** | RSI < 30、MACD 金叉、价格在布林下轨 |
| **组合** | 以上条件的 AND/OR 组合 |
| **自定义公式** | 用户定义的表达式 |

### 6.3 性能考量

- `stock_zh_a_spot_em()` 单次调用返回全市场基础数据（含PE/PB/市值/行业），不需要逐股查询
- 技术指标筛选需要逐股拉 K 线 → 先用基本面条件缩小范围再算指标
- AI 通过 subagent 方式调用（可用低级模型），不阻塞主对话

---

## 7. 公式引擎

### 7.1 三种公式类型

| 类型 | 输入 | 输出 | 用途 |
|------|------|------|------|
| **screener** | 全市场数据 | 符合条件的股票列表 | 选股 |
| **signal** | 单只股票数据 | 买入/卖出/观望 | 交易信号 |
| **score** | 单只股票数据 | 0-100 分 | 综合评分 |

### 7.2 表达式语言

类似通达信（TDX）风格，但更简洁安全：

**行情变量**：`CLOSE`, `OPEN`, `HIGH`, `LOW`, `VOL`, `AMOUNT`, `PE`, `PB`, `MARKET_CAP`

**指标函数**：
```
MA(series, N)          # 简单移动均线
EMA(series, N)         # 指数移动均线
MACD(fast, slow, sig)  # 返回 .DIF .DEA .MACD
KDJ(N)                 # 返回 .K .D .J
RSI(N)                 # RSI
BOLL(N, K)             # 返回 .UPPER .MID .LOWER
ATR(N)                 # 真实波幅
OBV()                  # 能量潮
```

**信号函数**：
```
CROSS(A, B)            # A 上穿 B
```

**统计/比较函数**：
```
MAX(series, N)         # N 日最高
MIN(series, N)         # N 日最低
STD(series, N)         # N 日标准差
INDUSTRY_AVG(field)    # 行业均值
RANK(field)            # 行业排名
```

**评分函数**（score 类型专用）：
```
RSI_SCORE(N)           # RSI 归一化评分
PE_SCORE()             # PE 相对行业评分
TREND_SCORE()          # 趋势综合评分
```

**运算符**：`+`, `-`, `*`, `/`, `>`, `<`, `>=`, `<=`, `==`, `!=`, `AND`, `OR`, `NOT`, `IN`

### 7.3 公式示例

```
# 筛选型：低估值消费股
PE < INDUSTRY_AVG(PE) AND RSI(14) < 30 AND INDUSTRY IN ('食品饮料', '家用电器')

# 信号型：MACD 放量金叉
CROSS(MACD(12,26,9).DIF, MACD(12,26,9).DEA) AND VOL > MA(VOL, 20) * 1.5

# 评分型：综合评分
RSI_SCORE(14) * 0.3 + PE_SCORE() * 0.4 + TREND_SCORE() * 0.3
```

### 7.4 解析器实现

使用 Python `lark` 库定义正式语法（而非 `ast.parse`），原因：
- 语法与 Python 不同（AND/OR/CROSS 等关键字）
- lark 能提供精确的错误提示（"第23列缺少右括号"）
- 安全沙箱 — 不允许 import/exec/eval，只有白名单函数

### 7.5 公式存储

```json
// .dogear/stocks/formulas.json
{
  "version": 1,
  "formulas": [
    {
      "id": "uuid-xxx",
      "name": "低估值消费股筛选",
      "type": "screener",
      "expression": "PE < INDUSTRY_AVG(PE) AND RSI(14) < 30",
      "description": "PE 低于行业均值且 RSI 超卖",
      "params": {},
      "createdAt": "2026-04-15T10:00:00Z",
      "updatedAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

管理服务：`formula-service.ts`，复用 `safe-json.ts` 的安全读写模式。

### 7.6 AI 与公式的协作

- 用户描述策略逻辑 → AI 帮生成表达式语言代码
- 用户可保存/编辑/删除公式
- AI 调用 `EvalFormula` 工具执行公式，读取结果再做分析

---

## 8. 新增 Agent 工具

### 8.1 工具清单

在现有 6 个工具基础上新增 7 个分析工具：

| 工具 | 用途 | 依赖 | 超时 |
|------|------|------|------|
| **CalcIndicators** | 计算技术指标 | Python + 现有K线数据 | 30s |
| **ScreenStocks** | 全市场条件筛选 | Python + AKShare | 120s |
| **GetFinancials** | 财报/基本面数据 | Python + AKShare | 30s |
| **CompareIndustry** | 行业内对比分析 | Python + AKShare | 30s |
| **DetectSignals** | 检测技术信号 | Python + 现有K线数据 | 30s |
| **EvalFormula** | 执行用户公式 | Python + 公式引擎 | 60s |
| **SimpleBacktest** | 简单策略回测 | Python + 现有K线数据 | 300s |

### 8.2 工具设计

#### CalcIndicators

```
输入: market, code, indicators[], params?, period?, limit?
输出: 各指标最新值 + 简要趋势判断

示例输出:
"=== 贵州茅台(600519) 技术指标 ===
MACD(12,26,9): DIF=2.15, DEA=1.98, 柱=0.17 | 金叉形态，DIF在零轴上方
RSI(14): 58.3 | 中性区间(40-60)
KDJ(9,3,3): K=72.1, D=65.8, J=84.7 | 偏强，接近超买区
BOLL(20,2): 上轨=1580, 中轨=1520, 下轨=1460 | 现价1545，位于中轨上方"
```

#### ScreenStocks

```
输入: conditions{industry?, pe_min/max?, pb_min/max?, market_cap_min/max?, 
      technical?[{indicator, condition, value}]}, formula?, limit?
输出: 匹配的股票表格

示例输出:
"筛选条件: PE<20, 行业=食品饮料, RSI(14)<30
找到 8 只符合条件的股票:
| 代码   | 名称     | 价格   | PE    | RSI   | 市值(亿) |
|--------|----------|--------|-------|-------|----------|
| 000858 | 五粮液   | 148.50 | 18.2  | 27.5  | 5,762    |
| ...    | ...      | ...    | ...   | ...   | ...      |"
```

#### GetFinancials

```
输入: market, code, metrics?[], periods?
输出: 最近N期财报关键指标

示例输出:
"=== 贵州茅台(600519) 财务数据 ===
| 指标       | 2025Q4   | 2025Q3   | 2025Q2   | 2025Q1   |
|------------|----------|----------|----------|----------|
| 营收(亿)   | 1,505.6  | 1,032.8  | 709.2    | 430.8    |
| 净利润(亿) | 747.3    | 510.2    | 352.1    | 215.8    |
| ROE(%)     | 32.5     | 31.8     | 30.2     | 29.5     |
| 毛利率(%)  | 91.8     | 91.5     | 91.2     | 91.0     |"
```

#### CompareIndustry

```
输入: market, code, metrics?[]
输出: 在行业中的排名 + 行业均值/中位数

示例输出:
"=== 贵州茅台 vs 白酒行业(共18只) ===
| 指标     | 茅台    | 行业均值 | 行业中位数 | 排名 |
|----------|---------|----------|------------|------|
| PE(TTM)  | 28.5    | 35.2     | 30.1       | 5/18 |
| ROE(%)   | 32.5    | 18.7     | 16.2       | 1/18 |
| 市值(亿) | 19,200  | 3,850    | 1,200      | 1/18 |"
```

#### DetectSignals

```
输入: market, code, signals?[], lookback?
输出: 近期触发的技术信号列表

内置信号:
- macd_golden_cross / macd_death_cross
- kdj_golden_cross / kdj_oversold / kdj_overbought
- rsi_oversold / rsi_overbought
- boll_upper_break / boll_lower_break
- volume_breakout（成交量突破20日均量1.5倍）
- ma_bullish_arrangement（均线多头排列）

示例输出:
"=== 贵州茅台(600519) 近5日信号 ===
2026-04-14: RSI(14)=28.5 → RSI超卖信号（<30）
2026-04-12: MACD金叉（DIF上穿DEA）
无其他信号触发"
```

#### EvalFormula

```
输入: formula_id 或 formula_text, market?, code?
输出: 公式执行结果（根据类型不同）

screener → 股票列表
signal → 买入/卖出/观望 + 原因
score → 分数 + 各维度得分
```

#### SimpleBacktest

```
输入: market, code, formula_id 或 formula_text, period?, initial_capital?
输出: 回测结果统计

示例输出:
"=== 回测: MACD金叉策略 on 贵州茅台 ===
回测周期: 2025-04-15 ~ 2026-04-15 (1年)
初始资金: ¥100,000

总收益率: +12.5%
年化收益: +12.5%
最大回撤: -8.2%
胜率: 55.0% (6胜5负)
平均持有: 12天
交易次数: 11次

收益曲线: [简化数据点]"
```

### 8.3 MCP Server 注册

新工具注册为独立的 MCP Server `dogear-stock-analysis`（与现有 `dogear-stock` 分离），原因：
- 现有 6 个工具纯 TypeScript，零外部依赖，快速可靠
- 新工具依赖 Python，可能不可用
- 分离后 Python 故障不影响基础股票功能

---

## 9. 简单回测

### 9.1 回测引擎

不是完整的量化回测框架，而是满足"快速验证一个想法"的需求：

```
输入: K线数据 + signal 公式
处理: 按时间顺序遍历，公式返回 true 时标记买入/卖出
输出: 收益率、胜率、最大回撤、交易记录
```

### 9.2 限制（有意简化）

- 不支持仓位管理（每次全仓买入/卖出）
- 不计算手续费和滑点
- 不支持做空
- 不支持多股组合

这些限制是有意的 — 目标是快速验证信号有效性，不是做专业量化。

---

## 10. 目录结构

```
dogear/
├── python/                           # 新增：Python 计算层
│   ├── main.py                       # JSON-RPC 守护进程入口
│   ├── requirements.txt              # akshare, pandas, numpy, lark
│   ├── core/
│   │   ├── __init__.py
│   │   ├── protocol.py               # JSON-RPC 协议处理
│   │   ├── indicators.py             # 技术指标计算
│   │   ├── screener.py               # 股票筛选引擎
│   │   ├── financials.py             # AKShare 财务数据获取
│   │   ├── formula_engine.py         # 公式解析器 + 执行器
│   │   └── backtest.py               # 简单回测引擎
│   └── utils/
│       ├── __init__.py
│       ├── akshare_client.py          # AKShare 封装（限流+缓存）
│       └── cache.py                   # TTL 内存缓存
│
├── electron/main/
│   ├── services/stock/
│   │   ├── python-bridge.ts           # 新增：Python 进程管理
│   │   ├── formula-service.ts         # 新增：公式 CRUD 存储
│   │   ├── stock-service.ts           # 已有（保持不变）
│   │   ├── rate-limiter.ts            # 已有（保持不变）
│   │   ├── stock-data-service.ts      # 已有（保持不变）
│   │   ├── stock-watchlist-service.ts # 已有（保持不变）
│   │   └── index.ts                   # 更新：导出新服务
│   │
│   ├── agents/tools/
│   │   ├── stock-tools.ts             # 已有 6 个工具（保持不变）
│   │   └── stock-analysis-tools.ts    # 新增：7 个分析工具
│   │
│   └── tipc/
│       └── stock.ts                   # 更新：新增分析相关 IPC 路由
│
└── .dogear/stocks/
    ├── watchlist.json                 # 已有
    ├── formulas.json                  # 新增：用户公式存储
    ├── kline/                         # 已有
    └── daily/                         # 已有
```

**python/ 为什么在项目根目录？**
- 不是 TypeScript，不应被 `tsconfig.electron.json` 处理
- 是运行时依赖，非编译时依赖
- `electron-builder` 打包时作为 `extraFiles` 包含

---

## 11. 关键数据流

### 11.1 个股诊断全流程

```
用户："帮我分析贵州茅台能不能买"
    ↓
AI 规划分析步骤，依次调用工具：
    ↓
① GetStockQuote → 实时行情（现价、涨跌、PE/PB/市值）        [已有工具]
② CalcIndicators → MACD/KDJ/RSI/BOLL 计算结果              [新工具]
③ GetFinancials → 营收增长、净利润、ROE 趋势                [新工具]
④ CompareIndustry → 白酒行业排名对比                        [新工具]
⑤ DetectSignals → 近期有无关键信号                          [新工具]
    ↓
AI 综合 5 组确定性数据 → 多维度分析 → 输出结论
```

### 11.2 选股全流程

```
用户："帮我找适合抄底的消费股"
    ↓
AI 理解"抄底" → 超卖+支撑位+低估值
    ↓
调用 ScreenStocks({
  conditions: { industry: "食品饮料", pe_max: 30 },
  technical: [
    { indicator: "RSI", condition: "below", value: 30 },
    { indicator: "BOLL", condition: "below", reference: "LOWER" }
  ]
})
    ↓
Python 执行：全市场快照 → 行业过滤 → PE 过滤 → 技术指标过滤
    ↓
返回候选列表 → AI 进一步分析 → 推荐
```

---

## 12. 实施分层（概要）

| 阶段 | 内容 | 核心交付 |
|------|------|---------|
| **Phase 1** | Python Bridge + 技术指标 | `python-bridge.ts` + `indicators.py` + `CalcIndicators` 工具 |
| **Phase 2** | AKShare 数据 + 筛选 | `akshare_client.py` + `screener.py` + `ScreenStocks/GetFinancials/CompareIndustry` 工具 |
| **Phase 3** | 公式引擎 + 信号检测 | `formula_engine.py` + `formula-service.ts` + `EvalFormula/DetectSignals` 工具 |
| **Phase 4** | 回测 + 完善 | `backtest.py` + `SimpleBacktest` 工具 + 预置公式模板 |

每个阶段独立可用，不依赖后续阶段。

---

## 13. 关键文件索引

实施时需要参考的现有文件：

| 文件 | 参考用途 |
|------|---------|
| `electron/main/services/stock/stock-service.ts` | 数据源模式、服务单例模式 |
| `electron/main/agents/tools/stock-tools.ts` | Agent 工具定义模板 |
| `electron/main/services/stock/rate-limiter.ts` | 断路器和请求管理模式 |
| `electron/main/services/stock/stock-watchlist-service.ts` | safe-json 存储 CRUD 模式 |
| `electron/main/services/stock/index.ts` | 服务导出模式 |
| `electron/main/services/conversation-runtime-service.ts` | MCP Server 注册位置 |
| `electron/main/agents/tools/tool-registry.ts` | 工具注册表 |
| `electron/main/services/safe-json.ts` | 安全 JSON 读写 |