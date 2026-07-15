# 选股 skill 实施计划

**目标**：落地 `.claude/skills/stock-picking/SKILL.md` 让 agent 自动进 3 步选股 SOP，并给候选池根基接口配双源兜底，让整个流程在数据源不稳时仍能"稳而慢"地跑起来。

**架构思路**：Python 层加通用降级 helper 覆盖两个关键接口（全A快照/板块列表），双源全挂时抛结构化异常；TypeScript 工具层捕获异常返回明确失败信号；SKILL.md 教 agent 如何在降级/中止场景下如实告诉用户。**排除全面多源降级**（维护成本高）、**排除 stock_yjbb_em 批量业绩接口**（东财源封禁风险）——用 Step 2 内逐股同花顺补拉替代。

**背景文档**：`../stock-picking-skill-design.md`（完整设计 + 排除方案 + 未决问题）

**涉及模块**：
- `python/utils/akshare_client.py` — 双源降级基础设施 + 两个函数改造
- `python/main.py` — JSON-RPC 层结构化 error
- `electron/main/agents/tools/stock-analysis-tools.ts` — `ScreenStocks` 工具适配
- `.claude/skills/stock-picking/SKILL.md`（新增）— skill 提示词

## 步骤索引

- [x] [Step 1: Python 层双源降级](./step1-python-fallback.md) — 通用 helper + 两个函数改造 + main.py 结构化 error
- [x] [Step 2: TS 工具层适配](./step2-ts-tool-adapt.md) — ScreenStocks 捕获降级信号 + `_source` 传递到 markdown
- [x] [Step 3: SKILL.md + 端到端验证](./step3-skill-e2e.md) — 编写 skill 提示词 + 手动跑一次完整 SOP（端到端由用户手动执行）

## 全局决策

### 命名与数据约定

- 降级异常类名：`DataSourceExhausted`，构造参数是 `errors: list[tuple[str, str]]`（源名, 错误摘要 ≤100 字符）
- DataFrame 元信息键：`df.attrs['_source']` = `'eastmoney'` / `'sina'` / `'ths'` 等
- 主源挂 → 走备源时**不打日志到 stdout**（Python 层任何非 JSON-RPC 输出都会污染协议），走 stderr

### 错误处理约定（三级）

- **一级**（候选池根基，双源）：主源挂走备源 + 输出 `_source`；双源全挂抛 `DataSourceExhausted`
- **二级**（财报补拉，单源）：同花顺挂 → 跳过软条件筛，工具输出如实说明"未按 ROE 筛"
- **三级**（深挖细节，单源）：单只单维度挂 → 该维度标注"未获取"，报告结尾统一列【数据缺口】表

### 铁律（写入 SKILL.md）

- 缺数据必须明确留白，禁止用瞎猜内容填充报告段落（对齐记忆 `feedback-fidelity-no-fabrication`）
- 所有 python 调用继续走 `_bulk_limiter` (5s) / `_single_limiter` (0.5s)，Step 2 内逐股财报补拉必须串行（对齐记忆 `feedback-stock-api-rate-limit`）

### 不做的事（对齐 YAGNI）

- 不做自动重试等待（rate limiter 已限速，重试是死）
- 不做主源自动恢复检测（每次都先试主源，成本极低）
- 不改其他 7 个 akshare 函数（雪球 xq 两个另议）
- 不为未来观察 SOP 埋伏笔（本次只做圈选）
