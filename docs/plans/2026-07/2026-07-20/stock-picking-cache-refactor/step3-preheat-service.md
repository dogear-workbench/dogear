---
step: 3
title: 候选池预热服务 + PreheatCandidatePool MCP 工具
status: done
---

## 目标

把"硬筛候选池 + 全池数据预热"封装成一次调用，agent 只调一次 `PreheatCandidatePool` 就拿到完整候选池数据（含财报/信号/公告标题），后续所有分析都读本地缓存。

内部按数据源智能编排：
- baostock 硬筛：一次
- 财报（同花顺）：**主进程内串行** 50 次（Step 1 缓存加持后大部分命中的情况下秒完）
- K 线 + 信号：**并行小批**（每批 5 只）
- 公告标题：**并行小批**（每批 5 只）

## 依赖上下文

**前置 step 产出**（等 Step 1/2 完成后回填具体签名）：
- Step 1: `readFinancialsCache` / `writeFinancialsCache` 签名 + `financials-cache-service.ts` 已导出的 fetch-or-cache 逻辑
- Step 2: `list.{today}.json` 缓存 + `filterCachedAnnouncements` 纯函数

**现有可复用接口**：
- baostock 硬筛：`electron/main/services/stock/*.ts` 里对应 ScreenStocks 的服务函数（找一下 grep `screenStocks`）
- K 线：`stockDataService.getKLine(market, code, period, limit)` 已 JSONL 缓存
- 信号计算：`pythonBridge.call('detect_signals', ...)` 参考 stock-analysis-tools.ts DetectSignals 工具
- 公告：Step 2 改造后的 `listAnnouncements`

## 计划改动

### 新建 `electron/main/services/stock/preheat-service.ts`

导出：

```ts
interface PreheatConditions {
  industries: string[];        // CSRC 分类名列表（如 ["C39计算机、通信和其他电子设备制造业"]）
  priceMax?: number;
  priceMin?: number;
  peMax?: number;
  peMin?: number;
  marketCapMin?: number;       // 单位：亿
  marketCapMax?: number;
  excludeNegativePe?: boolean; // 默认 true
  excludeSt?: boolean;         // 默认 true
}

interface PreheatOptions {
  limit?: number;              // 候选池上限，默认 50，最大 100
  wantSignalLookback?: number; // 信号回看天数，默认 7
  wantAnnouncementSince?: string; // 公告起始日期，默认近 30 天
}

interface PreheatResult {
  candidates: CandidateData[];  // 见 plan.md 全局决策
  status: {
    total: number;              // 硬筛后的候选池大小
    financialsHit: number;      // 财报缓存命中数
    financialsFetched: number;  // 实际调 Python 的数
    signalsSuccess: number;
    announcementsSuccess: number;
    failuresByCategory: Record<string, number>;
  };
  elapsedMs: number;
}

export async function preheatCandidatePool(
  conditions: PreheatConditions,
  options?: PreheatOptions
): Promise<PreheatResult>
```

**编排逻辑**：
1. 对每个 industry 调 ScreenStocks 服务，合并去重
2. 应用硬条件本地筛（priceMax / peMax / marketCapMin 等）
3. 排序：优先按 PE 升序（估值优先）
4. 截断到 `limit`
5. 并发执行三条子流水线：
   - **财报流水线**：for-await 顺序调 GetFinancials-with-cache（Step 1 已实现），每只等返回再下一只
   - **K 线+信号流水线**：Promise.all 分批（每批 5 只并发），批内并发批间串行
   - **公告标题流水线**：Promise.all 分批（每批 5 只并发）
6. 汇总每只的 CandidateData
7. 组装 status + elapsedMs 返回

**为什么财报要主进程串行而不是分批并行**：Step 1 缓存加持后大部分命中；即使未命中，同花顺限流是 0.5s/单股，改分批也没提速；且分批并行有一批全未命中时会撞封禁。保持串行最稳。

### 新建 `electron/main/agents/tools/stock-picking-tools.ts`

MCP server: `dogear-stock-picking`，注册工具元数据。

```ts
// PreheatCandidatePool 工具
tool(
  'PreheatCandidatePool',
  '一次调用完成"硬筛候选池 + 全池数据预热"...（详细描述见下）',
  {
    industries: z.array(z.string()).describe('CSRC 行业分类名列表...'),
    price_max: z.number().optional(),
    price_min: z.number().optional(),
    pe_max: z.number().optional(),
    market_cap_min: z.number().optional(),
    market_cap_max: z.number().optional(),
    exclude_negative_pe: z.boolean().default(true),
    exclude_st: z.boolean().default(true),
    limit: z.number().default(50).describe('候选池上限，默认 50，最大 100'),
  },
  async (args) => {
    const result = await preheatCandidatePool({...}, {limit: args.limit});
    // 输出：格式化 markdown 表格 + JSON 数据块（供 RankCandidates 用）
    return { content: [{ type: 'text', text: formatPreheatOutput(result) }] };
  }
)
```

**输出格式**：markdown 表（可读）+ 附一个 JSON 代码块（结构化，供 agent 直接传给 RankCandidates）。

```markdown
## 候选池预热结果

**硬筛后**：50 只 | **财报命中**：45/50 | **信号成功**：50/50 | **公告成功**：49/50 | **耗时**：38s

| 代码 | 名称 | 现价 | 涨跌 | PE | PB | ROE | 净利同比 | 信号数 | 公告数 |
|---|---|---|---|---|---|---|---|---|---|
| ... (完整 50 行) |

### 数据缺口

- 300XXX: 公告拉取失败（巨潮超时）

### 结构化数据（供 RankCandidates）

\`\`\`json
{ "candidates": [ { "market": 0, "code": "000682", ... }, ... ] }
\`\`\`
```

### tool-registry 注册

在 `stock-picking-tools.ts` 末尾：
```ts
registerTools([
  { name: 'PreheatCandidatePool', description: '...', server: 'dogear-stock-picking', category: 'stock' },
  { name: 'RankCandidates', description: '...', server: 'dogear-stock-picking', category: 'stock' },  // Step 4 也在同文件
]);
```

### 手动验证

- 调 PreheatCandidatePool(industries=["C39..."], price_max=20, pe_max=40, limit=20) → 40s 内返回 20 只完整数据
- 第二次调同参数 → 应该财报全命中，耗时 <15s（只有 K 线/公告并行部分）
- 极端条件返回 0 只 → 返回空 candidates + status 不崩

## 实施回填（做完后填）

详细交付内容见组共享区 `step3-delivery.md`。摘要：

### 实际改动

- 新增 `electron/main/services/stock/preheat-service.ts`（编排服务）
- 新增 `electron/main/agents/tools/stock-picking-tools.ts`（MCP 工具）
- 修改 `electron/main/services/tool-packs.ts`（新增 `stock-picking` 可选工具包）
- 修改 `electron/main/services/conversation-runtime-service.ts`（工厂表挂 `createStockPickingTools`）
- 修改 `electron/main/agents/tools/tool-registry.ts`（`dogear-stock-picking` 中文标签 + 固定排序）
- 与计划差异：MCP server 挂载点不是 `query-based-session.ts`，而是走既有的「可选工具包」机制（`tool-packs.ts` + `conversation-runtime-service.ts`），与 `dogear-stock` / `dogear-stock-analysis` / `dogear-stock-announcement` 完全一致的注册路径；`netProfitYoYQuarter` 取 `net_profit_single_yoy`，当前主数据源 baostock 恒不产出该字段（MVP 限制，见 `python/core/financials.py`），多数情况下为 null，Step 4 评分需按"该维度全池缺失则权重归零"处理。

### 给下一步的接力棒

- `PreheatResult { candidates: CandidateData[]; status: PreheatStatus; elapsedMs: number }`，`CandidateData` 字段与 plan.md 全局决策一致
- MCP server 名：`dogear-stock-picking`；工具名：`PreheatCandidatePool`；需在设置页「工具包」里手动开启 `stock-picking` 才会挂载
- 输出 markdown 末尾固定一个 \`\`\`json 代码块，内容为 `{ "candidates": CandidateData[] }`
- 已知边界：`marketCapMin/Max` 因快照无股本数据基本不生效；`netProfitYoYQuarter` 大概率为 null（见上）
