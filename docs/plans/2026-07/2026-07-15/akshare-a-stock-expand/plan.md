# AKShare A 股接口扩展实施计划

**目标**：补齐 dogear 在 A 股市场的 AKShare 数据空白，覆盖高+中价值档（共 12 个业务域，约 30 个 AKShare 接口），每个接口全链路打通到 Agent 工具，让 AI 在聊天里能直接调用。

**架构思路**：
- 现有架构（Python 客户端 → Python 计算层 → python-bridge → Agent 工具）不变，按业务域扩展
- 每个业务域一个独立 step，新增的 core 模块按域分文件（fund_flow.py / statements.py / valuation.py 等），不混进现有的 financials.py
- Agent 工具按域聚合，工具文件超过 5 个工具时再拆（参考现有 stock-analysis-tools.ts / stock-announcement-tools.ts 的拆法）

**涉及模块**：
- `python/utils/akshare_client.py` — 新增 ~30 个客户端方法
- `python/core/*.py` — 新增 8 个业务模块（fund_flow / hsgt / statements / earnings / valuation / dividend / shareholder / dragon_tiger / research / concept）
- `electron/main/services/stock/python-bridge.ts` — 新增对应 JSON-RPC method
- `electron/main/agents/tools/stock-analysis-tools.ts` — 新增 Agent 工具并 `registerTools()`
- `electron/main/services/stock/stock-service.ts` — 修复资金流向"返回空数组"占位

## 步骤索引

### 阶段 0：基础修复
- [x] [Step 1: 升级已弃用接口](./step1-upgrade-deprecated.md) — `abstract_ths` → `new_ths`、`indicator`（新浪）→ `indicator_em`（东财）

### 阶段 1：资金面
- [x] [Step 2: 资金流向](./step2-fund-flow.md) — 个股/大盘/板块资金流，修复 TS 层占位
- [ ] [Step 3: 北向资金](./step3-hsgt.md) — 个股北向持股历史 + 北向汇总

### 阶段 2：行情数据
- [ ] [Step 4: 分钟级 K 线](./step4-minute-kline.md) — 1/5/15/30/60 分钟周期 + 日内分时

### 阶段 3：财务深度
- [ ] [Step 5: 三大报表](./step5-statements.md) — 资产负债表/利润表/现金流量表全量字段
- [ ] [Step 6: 业绩预告/快报](./step6-earnings-forecast.md) — 早于正式财报的预期数据

### 阶段 4：估值与权益
- [ ] [Step 7: 估值历史与长指标](./step7-valuation.md) — PE/PB/PS/PEG 时间序列 + 股息率
- [ ] [Step 8: 分红派息](./step8-dividend.md) — 分红送配详情 + 历史分红
- [ ] [Step 9: 股东结构](./step9-shareholder.md) — 十大流通股东 + 股东户数

### 阶段 5：市场结构
- [ ] [Step 10: 龙虎榜](./step10-dragon-tiger.md) — 龙虎榜详情 + 机构席位追踪
- [ ] [Step 11: 研报与盈利预测](./step11-research.md) — 个股研报 + 分析师盈利预测
- [ ] [Step 12: 概念板块](./step12-concept-board.md) — 列表/成份股/历史（项目当前只有行业板块）

## 全局决策

### AKShare 客户端约定（所有新方法遵守）
1. 新方法加在 `python/utils/akshare_client.py`，统一走 `_retry(3)` + `_cache` + limiter
2. limiter 选择：批量接口（无 symbol 参数）走 `_bulk_limiter`（5s），单股接口走 `_single_limiter`（0.5s）
3. 缓存 TTL 按数据特性定：
   - 实时行情/资金流：60s
   - 财报数据（按报告期）：24h
   - 历史数据（K线/分红/股东）：1h
   - 长期不变的（公司基本/行业分类）：7d
4. 双源降级：只在主数据源明确有同等替代品时实现（如 `stock_zh_a_spot_em` → `stock_zh_a_spot`），不要为每个新接口都硬找备源

### Python 计算层约定
1. `core/*.py` 新模块以纯函数为主，避免状态化
2. AKShare 返回的 DataFrame 在客户端方法里完成列名归一化（统一中文列名），core 层不再处理
3. core 层负责数据语义加工（如单位换算、缺失值处理、关键字段提取）
4. 不要在 Python 端用 stdout 输出（会污染 JSON-RPC 协议），日志走 stderr

### Python 桥接约定
1. method 命名 `akshare.<action>`，所有参数显式列出，不要 `**kwargs`
2. 错误返回 `{ "error": "msg" }`，不抛异常（异常会让 python-bridge 进程崩）
3. 大 DataFrame（>500 行）考虑分页或字段裁剪，避免 IPC 传输压力

### Agent 工具约定
1. 统一在 `electron/main/agents/tools/stock-analysis-tools.ts` 注册，文件超过 5 个新工具时考虑拆分
2. 工具命名遵循 `mcp__dogear-stock-analysis__<Action>`，Action 用 PascalCase 动词
3. 输入参数用 Zod schema 严格校验，market 字段枚举 `sh/sz/bj`
4. 错误情况返回 `{ isError: true, content: [{ type: "text", text: "错误说明" }] }`，不抛异常
5. 工具描述要写清楚：① 数据来源 ② 字段单位 ③ 限制（如"近 100 个交易日"）

### 全局接力棒（跨 step 共享的上下文）
- 当前 `akshare_client.py` 客户端方法签名模板：`def get_xxx(symbol: str, ...) -> pd.DataFrame`
- 当前 `python-bridge.ts` method 注册位置：搜索 `registerMethod('akshare.` 查找
- 当前 `stock-analysis-tools.ts` 工具注册位置：文件末尾 `registerTools([...])`
- 现有 limiter/cache 实例：`_bulk_limiter` / `_single_limiter` / `_cache`（不要新建）

## 完成总结

（所有 step 完成后填写：实际改动汇总、与原计划的偏差、未做的事项）
