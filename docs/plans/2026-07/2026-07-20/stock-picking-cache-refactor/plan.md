# stock-picking 缓存与流程重构 实施计划

**目标**：解决 stock-picking skill 的两个根因问题——(1) 多层不透明截断导致好票被误杀、执行易出错；(2) 单股接口每次真调导致重跑成本高、无法多权重试算。做法是引入财报/公告本地缓存 + 一次性候选池预热 + 显式评分工具，把"选股"从"顺序流水线"改成"预热一次+反复本地评分"模式。

**架构思路**：
- 已缓存的数据源不动（baostock 全 A 快照、K 线 JSONL、每日快照、公告 PDF 全文）
- 新增缓存：**同花顺财报**（按 reportPeriod 永久 key）+ **巨潮公告标题列表**（当天 key，隔天失效）
- 新增两个 MCP 工具：`PreheatCandidatePool`（一次调用完成硬筛 + 全池数据预热，内部智能编排串行/并行）+ `RankCandidates`（纯本地评分排序，支持权重可调）
- skill 从"agent 手工串行调 N 只财报"改为"调一次预热工具 + 调一次评分工具"，逻辑收敛到主进程，agent 只做决策不做编排

**为什么不做**：
- 不给同花顺做"全 A 财报预拉"——同花顺无全量接口，5481 只 × 0.5s = 45 分钟不现实
- 不把评分函数放在 agent 侧手工算——每次调权重都要 agent 重算，容易漂移；固化成工具后秒级重跑
- 不新增 IPC 端点，评分走 MCP 工具即可（agent 直接可调，不需要前端参与）

**涉及模块**：
- `electron/main/services/stock/financials-cache-service.ts` — 新增
- `electron/main/services/stock/announcement-service.ts` — 改（加当天缓存）
- `electron/main/services/stock/preheat-service.ts` — 新增
- `electron/main/services/stock/scoring-service.ts` — 新增
- `electron/main/agents/tools/stock-analysis-tools.ts` — 改 GetFinancials 走缓存
- `electron/main/agents/tools/stock-picking-tools.ts` — 新增（PreheatCandidatePool + RankCandidates）
- `.claude/skills/stock-picking/SKILL.md` — 重写 SOP

## 步骤索引

- [x] [Step 1: 财报缓存服务 + 改 GetFinancials](./step1-financials-cache.md) — 新增 financials-cache-service，GetFinancials 先查缓存再调 Python
- [x] [Step 2: 公告列表当天缓存](./step2-announcements-cache.md) — announcement-service.listAnnouncements 加当天 key 缓存
- [ ] [Step 3: 候选池预热服务 + PreheatCandidatePool 工具](./step3-preheat-service.md) — 新增 preheat-service 编排硬筛+全池数据预热；新增 MCP 工具
- [ ] [Step 4: 综合评分服务 + RankCandidates 工具](./step4-scoring-tool.md) — 新增 scoring-service 纯函数打分；新增 MCP 工具支持权重可调
- [ ] [Step 5: 改写 stock-picking skill 文档](./step5-skill-rewrite.md) — 把新 SOP + 权重公式 + 子会话粒度 + 长周期维度全部落进 SKILL.md

## 全局决策

**缓存目录约定**：
- 财报：`.dogear/stocks/financials/{market}.{code}.jsonl`（每期一行 JSON，追加）
- 公告列表：`.dogear/stocks/announcements/{market}{code}/list.{YYYY-MM-DD}.json`

**缓存新鲜度策略**：
- 财报：**按 reportPeriod 缓存**（如 `2025Q4`），同一期永远命中；请求 N 期时，命中的期直接返回，缺失的期调 Python 补拉后合并写缓存
- 公告列表：**当天 key**，当天首次拉写盘，同天再调命中缓存；隔天旧文件保留不删（下次调时新写 `list.{今天}.json`，旧的自然作废）
- K 线 / 快照 / PDF 全文：现有策略不变

**数据结构约定**（跨 step 共用）：
```ts
// 候选池单只数据（Step 3 输出、Step 4 输入）
interface CandidateData {
  market: number;                    // 0 深 / 1 沪
  code: string;
  name: string;
  price: number;                     // 现价
  changePercent: number;             // 当日涨跌%
  pe: number | null;
  pb: number | null;
  industry: string;
  // 财报（来自 Step 1 缓存）
  roe: number | null;                // 最近年报 ROE %
  netProfitYoY: number | null;       // 最近年报净利同比 %
  netProfitYoYQuarter: number | null;// 最近一季报净利同比 %
  // 信号（来自 DetectSignals）
  signals: Array<{ date: string; name: string; description: string }>;
  // 公告标题（来自 Step 2 缓存）
  announcements: Array<{ date: string; title: string; type: string; url: string }>;
  // 数据缺口
  failures: string[];                // 哪些维度拉失败了
}

// 评分权重（Step 4）
interface ScoringWeights {
  roe: number;              // 默认 0.25
  growth: number;           // 默认 0.25（净利增速）
  valuation: number;        // 默认 0.20（PE 倒数）
  signal: number;           // 默认 0.15（信号强度）
  catalyst: number;         // 默认 0.10（公告催化剂）
  penalty: number;          // 默认 0.05（业绩下滑惩罚，实际是负权重）
}

// 排序结果（Step 4 输出）
interface RankedCandidate extends CandidateData {
  score: number;                     // 综合分 0-100
  scoreBreakdown: Record<keyof ScoringWeights, number>;  // 每维度得分
  rank: number;
}
```

**候选池上限**：`PreheatCandidatePool` 工具 `limit` 参数默认 50，上限 100。预热预算约 40s（同花顺 50 × 0.5s = 25s 串行 + K 线/公告并行 15s）。

**错误处理约定**：
- 缓存读失败（文件损坏/JSON parse 错）→ 打日志、当作未命中、继续调上游
- 缓存写失败 → 打日志、不影响本次返回
- 预热阶段单只单维度失败 → 记入该只的 `failures[]`，不阻断全池；预热结果附带 `preheatStatus` 汇总失败率
- 评分阶段某维度全池都缺失（比如所有 ROE 都 null）→ 该维度权重归零，其他维度按比例放大

**工具命名与 server 命名**：
- MCP server: `dogear-stock-picking`（新，与 `dogear-stock` / `dogear-stock-analysis` / `dogear-stock-announcement` 并列）
- 工具名: `PreheatCandidatePool` / `RankCandidates`
- 元数据在 tool-registry 里注册（复用 registerTools 机制）

**不写单测**（项目偏好）；每 step 完成后手动 build + 用 skill 跑一遍验证。
