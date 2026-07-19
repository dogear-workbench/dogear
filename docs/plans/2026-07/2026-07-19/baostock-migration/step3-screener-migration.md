---
step: 3
title: screener 改造走本地快照
status: pending
---

## 目标

改造 `python/core/screener.py`，把 `screen_stocks` 的数据源从 `ak.stock_zh_a_spot_em()` 换成 `snapshot.get_snapshot()`；同时新增/改造 `ListIndustries` 相关能力从 baostock 走。**agent 工具接口签名不变**（`ScreenStocks` / `ListIndustries` 的入参出参保持兼容），只换底层数据源。

## 依赖上下文（接力棒输入）

- Step 2 产出：`python/core/snapshot.py::get_snapshot()` 返回 DataFrame，含字段（step2 回填补全清单）：`code / code_name / industry / open / high / low / close / preclose / volume / amount / turn / pctChg / peTTM / pbMRQ / psTTM / pcfNcfTTM / tradestatus / isST / total_market_cap / float_market_cap / amplitude / volume_ratio`
- 现有代码入口：
  - `python/core/screener.py:19` `screen_stocks(conditions, request_id, limit)` —— 主入口，改造重点
  - 现有 `conditions` 字段：`industry / price_min|max / pe_min|max / pb_min|max / market_cap_min|max / change_percent_min|max / turnover_rate_min|max`
- 上层调用点（不改，只保证签名兼容）：
  - `electron/main/services/stock/python-bridge.ts` 的 `screenStocks` method
  - `electron/main/agents/tools/stock-analysis-tools.ts` 的 `ScreenStocks` 工具

## 计划改动

- [ ] `python/core/screener.py`：
  - [ ] 顶部 import：`from utils.akshare_client import get_all_a_stocks, get_stock_hist` → `from core.snapshot import get_snapshot` + `from utils.akshare_client import get_stock_hist`（K 线仍用 akshare，那个接口没挂）
  - [ ] `screen_stocks` 内 `df = get_all_a_stocks()` → `df = get_snapshot(request_id=request_id)`
  - [ ] 字段名映射调整（snapshot 用 baostock 原字段名，screener 现在的过滤逻辑是按 akshare 中文名写的）：
    - `最新价` → `close`
    - `涨跌幅` → `pctChg`
    - `市盈率-动态` → `peTTM`（选股场景 TTM 比动态更严谨，已在设计文档达成共识）
    - `市净率` → `pbMRQ`
    - `总市值` → `total_market_cap`（单位从"元"转"亿元"以匹配 conditions 语义：`market_cap_min/max` 传的是亿元，snapshot 存的是元 → 过滤时除 1e8）
    - `换手率` → `turn`
    - `行业` → `industry`
    - `代码` → `code`（注意 snapshot 的 code 是 `sh.600519` 带前缀，agent 侧原来接收的是裸码 `600519`，返回前要 strip 前缀）
    - `名称` → `code_name`
  - [ ] 技术指标筛选（`conditions.technical`）：现在是拿到候选后循环调 `get_stock_hist` 拉 K 线算指标，本步保持不动（K 线接口稳定）
  - [ ] 返回结果的 `market` 字段：从 baostock 前缀反推（`sh.` → 1，`sz.` → 0，`bj.` → 2）
- [ ] `python/main.py` 若有 `list_industries` 相关 JSON-RPC method，改走 `snapshot.get_snapshot()['industry'].unique()`；若无则新增
- [ ] `python/core/screener.py` 若已有 `list_industries` 函数同样改造；参考现有 `mcp__dogear-stock-analysis__ListIndustries` 工具描述保证返回字段（`name / change_percent / market_cap / turnover_rate / up_count / down_count`）的兼容 —— **注**：baostock 没有板块级 change_percent 等聚合字段，本步先用 snapshot 内该行业股票的均值算，回填时确认这样够不够
- [ ] 手动验证：
  - 调 `screen_stocks({"pe_max": 30, "pb_max": 5, "market_cap_min": 100})` 能返回结果
  - 调 `screen_stocks({"industry": "银行"})` 能按行业过滤
  - 通过 python-bridge → agent 工具调 `ScreenStocks` 端到端验证

## 验收标准

- Agent 侧调 `ScreenStocks` 能返回筛选结果，字段完整（包含 PE/PB/市值/行业）
- Agent 侧调 `ListIndustries` 能列出中文行业名
- 选股 SOP 端到端跑一遍（stock-picking skill 触发的完整对话）能走完，不因数据源问题中断

## 实施回填（做完后填）

### 实际改动
- 与计划差异：

### 给下一步的接力棒
- ListIndustries 返回字段清单（有哪些是靠 snapshot 聚合算出来的、哪些是 NaN）：
- 端到端跑通的选股场景 case：
- 已知限制 / 坑：
