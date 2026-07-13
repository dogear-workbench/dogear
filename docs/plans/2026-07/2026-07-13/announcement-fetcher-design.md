# 公司公告按需抓取 设计

## 背景

Dogear 现有股票能力量化侧已较完整（K线、指标、ScreenStocks、公式、回测），但**定性信息侧完全空白**。用户想让 agent 分析个股时能拉到年报、季报、临时公告等一手材料辅助判断。这是「关注领域 → 筛选候选 → 深度分析」这条链路里最基础的一环——后续的主题选股、按天工作流都会用到它。

本设计只覆盖**公司公告**一类信息源（暂不做研报/新闻/雪球讨论），以最小实现打通"agent 能主动拉一手材料"的能力。

## 目标

- Agent 在分析个股时可以按需拉取**列表**和**全文**两级信息
- 全文包含**叙述文本 + 表格结构化数据**（能抽出利润表、资产负债表数字）
- **懒缓存**：agent 读过的公告本地留存，下次直读（PDF 是死数据，一次下载永久有效）
- 零调度（不做定时预抓，那是第三阶段）
- 复用现有技术栈（Python bridge、article-service.ts 两级 fallback 风格）、复用现有 watchlist

## 架构

**核心决策**：按需抓取 + 懒缓存（PDF/markdown 落本地，读过就留）、巨潮资讯为唯一源、pdfplumber 走 Python bridge 解析、复用现有 watchlist。

分 3 层：

```
Agent 工具层  stock-announcement-tools.ts     (新)
                ↓
Service 层   announcement-service.ts          (新)
                ↓ (含缓存分支：命中直读、未命中下载写盘)
Python 桥接  python-bridge.ts 新增 RPC        (改)
Python 侧    python_workspace/announcements/parser.py (新)

.dogear/stocks/announcements/                (新目录)
├── sh600519/
│   ├── index.json    # {url, title, type, date, hash, cachedAt}[]
│   ├── <hash>.pdf    # 原始 PDF（备源，可清理）
│   └── <hash>.md     # 解析后 markdown（agent 直读的最终产物）
└── sz000001/
    └── ...
```

**排除的选项**：
- **定时预抓入库**：眼下没有调度需求（那是第三阶段），懒缓存已经能覆盖绝大部分场景
- **腾讯/新浪公告源**：腾讯无公告接口；新浪只有 HTML 页面无 API，脆弱且转载有版权风险
- **东财公告为主源**：巨潮是证监会指定官方源，零版权风险 + 覆盖最全（东财对港股/北交所偶尔漏）
- **雪球公告**：要 cookie、账号封禁风险，直接排除
- **纯 Node PDF 方案（pdf-parse/pdf2json）**：表格提取能力不够，公告核心痛点就是财报表格
- **pymupdf**：AGPL license，商业化路径受限
- **Jina Reader**：外部服务、20 RPM 频率限制，作为兜底价值不大（本地 pdfplumber 已经很稳）
- **多源 fallback（巨潮 + 东财）**：初期简化，等真出问题再补
- **新建关注池概念**：现有 `stocks/watchlist.json` + `stock-watchlist-service.ts` 已提供关注池能力，直接复用

## 模块边界

| 层 | 文件 | 职责 |
|---|---|---|
| Agent 工具 | `electron/main/agents/tools/stock-announcement-tools.ts` | 注册 `ListAnnouncements` / `ReadAnnouncement` 两个 MCP 工具 |
| Service | `electron/main/services/stock/announcement-service.ts` | 调巨潮列表 API、下载 PDF、调 Python bridge、组装返回 |
| Service（复用） | `electron/main/services/stock/rate-limiter.ts` | 巨潮 API 加入现有 RateLimiter 防御体系 |
| Bridge | `electron/main/services/stock/python-bridge.ts` | 新增 `parse_announcement_pdf(path)` RPC 方法 |
| Python | `python_workspace/announcements/parser.py` | pdfplumber 解析 PDF → `{text, tables}` |
| 类型 | `types/stock.ts` | 新增 `Announcement` / `AnnouncementDetail` |
| Codebase map | `.claude/rules/codebase-map.md` | 同步新增模块索引 |

## 数据流

**Flow 1：列举公告**
1. Agent 调 `ListAnnouncements({ code, market, since?, types? })`
2. Service 查本地 `orgId` 映射表（首次运行时一次性抓巨潮全量映射存 `.dogear/stocks/cninfo-org-map.json`）
3. POST `http://www.cninfo.com.cn/new/hisAnnouncement/query`（表单：stock + column + category + startDate/endDate）
4. 解析返回 JSON，抽出 `[{title, type, date, url, size}]` 交给 agent

**Flow 2：读取全文（带懒缓存）**
1. Agent 调 `ReadAnnouncement({ url, code, market })`
2. Service 校验 URL 属于 `static.cninfo.com.cn`（防 SSRF）
3. 计算 `hash = sha256(url).slice(0,16)`
4. **缓存命中路径**：`.dogear/stocks/announcements/{market}{code}/<hash>.md` 存在 → 直接读返回
5. **缓存未命中路径**：
   1. 下载 PDF 到 `.dogear/stocks/announcements/{market}{code}/<hash>.pdf`
   2. Python bridge 调 `parse_announcement_pdf(path)` → pdfplumber 逐页 `extract_text()` + `extract_tables()`
   3. 组装 markdown（叙述按页拼 + 表格转 markdown table）→ 写入 `<hash>.md`
   4. 更新 `index.json`：追加 `{url, title, type, date, hash, cachedAt}`
   5. 返回 markdown
6. **可选清理**：PDF 保留（备源，占空间但便于重解析），markdown 是最终产物

**巨潮 orgId 映射**：巨潮 API 需要 `stock=code,orgId` 格式，orgId 是巨潮内部编号。首次调用时批量拉全市场映射（一次性接口 `/new/data/szse_stock`、`/new/data/sse_stock`）存本地 JSON，之后离线查表。

## 错误处理 / 边界情况

| 场景 | 处理 |
|---|---|
| 巨潮 API 502/超时 | RateLimiter 已有断路器 + 重试 3 次，失败向 agent 返回 `{ok:false, error}`，不做东财 fallback |
| PDF 下载超过 30MB（招股书）| Service 层拦截，返回元数据 + `"文件过大（Xmb），建议只看摘要或分段读"`，不下载 |
| pdfplumber 解析失败/内容为空 | 返回 `{ok:false, error:"PDF 解析失败", meta}`，不做 Jina 兜底（初期简化） |
| 扫描件公告（早年招股书）| pdfplumber 返回空文本，同上作为解析失败处理，agent 提示用户直接看原文 |
| URL 非 `static.cninfo.com.cn` | Service 拒绝，防 SSRF |
| orgId 映射表过期（新上市股票）| 找不到 orgId 时懒加载重抓映射表；仍失败返回明确错误 |
| Python bridge 未启动 | 复用现有 stock-tools 的启动检查逻辑 |
| 缓存目录清理 | 不主动清（初期），若用户反馈占空间大再加清理策略；建议 UI 加"清理股票缓存"按钮 |
| watchlist 中删除股票 | 保留 announcements 目录（防误删后重新加入需重下），提供 UI 手动清理 |

## 未决问题

留给实施阶段拍板：

1. **超长公告分页读**：一个年报 markdown 输出可能 20 万字，超过 agent 单次能吃的上下文。是让工具默认返回摘要 + 目录、agent 再指定"读第 N 章"，还是直接返回全文让 agent 自己截？倾向前者但要看 pdfplumber 出的目录结构可用性
2. **表格 markdown 化的策略**：合并单元格、跨页表格 pdfplumber 处理不完美，是保留原始结构（可能乱）还是启发式合并（可能丢信息）？先用最朴素的按页 extract_tables 输出，看效果再迭代
3. **types 过滤参数的枚举值**：巨潮 category 有几十个（category_ndbg_szsh=年报、category_bndbg_szsh=半年报…），暴露哪些给 agent？先给 4 个主类（年报/季报/临时公告/招股书），后续按需扩
4. **是否要把 orgId 映射表纳入常规更新**：新上市股票会漏，先靠"找不到就重抓"的懒加载，观察是否够用
5. **Agent 工具是否要暴露"按关键词过滤公告标题"**：巨潮 API 支持关键词，但初期不加，靠 agent 自己在 `ListAnnouncements` 返回列表后过滤

## 与后续阶段的衔接

本阶段完成后：
- **第二阶段（主题→选股）**：ScreenStocks 筛出候选后，agent 可以调 `ListAnnouncements` 查每只候选股最近是否有减持/业绩预告等重要公告，作为筛选二次过滤
- **第三阶段（按天工作流）**：本阶段的懒缓存已经把"读过就留"的基础打好，第三阶段加"每晚定时扫 watchlist 新公告预抓"就是在 Service 层加一个 scheduler + `syncWatchlistAnnouncements()` 方法，工具接口和缓存结构不变
