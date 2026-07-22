# 长期视角选股 SOP 重构 实施计划

**目标**：完全替换现有短期视角的 `PreheatCandidatePool + RankCandidates`，改为基于 5 年长期数据的价值评估工具 `PreheatLongTermPool + RankByLongTerm`，让 stock-picking skill 贯彻"长期观察或投入"的用户诉求。

**架构思路**：Python 层负责财报数据拉取 + 聚合计算（复用现有 baostock 主 + 同花顺备双源）；TS 层负责硬筛编排 + K 线拉取 + K 线派生指标（复用 rate-limiter 保护）+ 打分排序。工具完全新命名不并存，旧工具和 skill 文档同步删除。**排除方案**：加参数开关（单工具双职责难维护）、Python 承担全部计算（跨进程序列化 250 期 K 线成本高）、只改 skill 不改代码（agent 手工串行拉数据慢且不稳）。

**设计文档**：[../long-term-stock-picking-design.md](../long-term-stock-picking-design.md)（每个 step 引用它避免重复描述细节）

## 涉及模块

**新增**：
- `python/core/long_term.py` — 5 年财报聚合 + CAGR/CV 计算
- `python/main.py` — 加 `long_term_financials` JSON-RPC 方法
- `electron/main/services/stock/long-term-preheat-service.ts` — 硬筛 + 预检 + 编排
- `electron/main/services/stock/long-term-rank-service.ts` — 分位数打分 + 加权
- `electron/main/agents/tools/stock-picking-tools.ts`（新建 or 复用现有位置）

**修改**：
- `electron/main/agents/tools/tool-registry.ts` — 删旧工具注册 + 加新工具
- `C:/dogear/.claude/skills/stock-picking/SKILL.md` — 完全重写

**删除**：
- `electron/main/services/stock/preheat-service.ts`
- `electron/main/services/stock/rank-service.ts`
- 旧 `PreheatCandidatePool` / `RankCandidates` MCP 工具定义（可能在 `stock-analysis-tools.ts` 或独立文件，Step 4 确认）

## 步骤索引

- [x] [Step 1: Python 长期财报指标计算](./step1-python-long-term.md) — 新建 `long_term.py` + `main.py` 加 `long_term_financials` JSON-RPC 方法
- [x] [Step 2: TS 预热编排服务](./step2-ts-preheat-service.md) — 新建 `long-term-preheat-service.ts`，编排硬筛 + 预检 + 财报/K 线拉取 + K 线派生指标
- [ ] [Step 3: TS 打分排序服务](./step3-ts-rank-service.md) — 新建 `long-term-rank-service.ts`，分位数打分 + 权重归一化 + 全池归零重分配
- [ ] [Step 4: MCP 工具定义 + 注册表更新 + 删除旧工具](./step4-mcp-tools-registry.md) — 定义 `PreheatLongTermPool` + `RankByLongTerm`，删除旧的两个工具及其 service 文件
- [ ] [Step 5: Skill 文档完全重写](./step5-skill-rewrite.md) — 重写 `stock-picking/SKILL.md`，新 3 步 SOP + 新铁律 + 新示例
- [ ] [Step 6: 端到端手工验证](./step6-e2e-validation.md) — 跑一次完整流程，验证 status 字段、评分逻辑、错误场景

## 全局决策

（所有 step 都要遵守）

### 命名与目录
- Python 计算模块：`python/core/long_term.py`（snake_case 文件名）
- Python JSON-RPC 方法名：`long_term_financials`（snake_case）
- TS 服务：`long-term-preheat-service.ts` / `long-term-rank-service.ts`（kebab-case 文件名）
- MCP 工具名：`PreheatLongTermPool` / `RankByLongTerm`（PascalCase，跟现有工具命名风格一致）
- 内部字段：TS 用 camelCase（`roeMean5y` / `netProfitCAGR5y` / `yearPositionPct`），Python 用 snake_case，跨进程边界做转换

### 数据字段（跨 step 一致）
每只 CandidateData 必含以下字段（详见 design.md「关键接口」段）：
- 基础：`market / code / name / industry`
- 5 年财报聚合：`annualReports[]` (year/roe/netProfit/revenue) + `roeMean5y` + `netProfitCAGR5y` + `revenueCAGR5y` + `roeCV5y` + `netProfitDeclineYears` + `reportYearsAvailable` (3-5)
- 周 K 聚合：`weeklyMA26` + `weeklyMA52` + `ma26Slope` (up/flat/down) + `trendState` (strong_bull/consolidation/pullback/bear) + `klinePeriodsAvailable`
- 年内位置：`currentPrice` + `yearHigh` + `yearLow` + `yearPositionPct` (0-100)
- 完整性：`failures[]` (元素 in 'financials' | 'kline')

### 错误处理级别（跨 step 一致）
- **A 中止级**：整体 error 返回，参见 design.md「错误处理 A」
- **B 单只剔除**：从最终池踢掉，记入 status 对应计数器
- **C 单只单维度降级**：保留但该维度 0 分或换算法
- **D 全池归零**：权重重分配（只在 Step 3 rank 阶段处理）

### 打分口径
- 4 维度权重默认均衡各 0.25
- 权重不需要和为 1，`RankByLongTerm` 内部自动归一化
- 分位数在**候选池内部**排序（不是全市场绝对分）
- 全池某维度 null → 该维度权重设 0，其他按比例放大，返回 `weightsApplied` 透传

### 并发策略
- 财报：Python 端天然串行（baostock 不支持并发会话）
- K 线：TS 层每批 5 只并发（走 rate-limiter）
- 预检：并发 10 只（只拉 1 期财报，很快）
- 全池默认 limit 50，最大 100

### 不做的事
- 不写单元测试（项目偏好）
- 不加第三方财报源（本次范围外）
- 不保留短期视角工具（完全替换）
- 不加权重预设（默认均衡，未来迭代）
