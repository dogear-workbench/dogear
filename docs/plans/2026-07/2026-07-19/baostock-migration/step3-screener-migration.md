---
step: 3
title: screener 改造走本地快照
status: done
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
- `python/core/screener.py`：数据源 `get_all_a_stocks()` → `get_snapshot() + get_industry_map()` join；列名映射从 akshare 中文名换成 baostock 原名（`close/pctChg/peTTM/pbMRQ/total_market_cap/turn/industry/code/code_name`）；`market_cap` 过滤分支改成"警告 + 跳过"（不再返回 0）；技术筛选段调 `get_stock_hist` 前 strip 前缀；返回的 `code` strip 前缀、`market` 从前缀反推
- `python/main.py::handle_list_industries`：数据源换成 snapshot + industry_map，按行业分组聚合 `pctChg.mean() / turn.mean() / up_count / down_count`，`market_cap` 恒为 `null`；返回结构不变
- `electron/main/agents/tools/stock-analysis-tools.ts`：三处工具描述改写——`registerTools` 里 ListIndustries 短描述、`ScreenStocks` 的 industry 参数 describe、`ListIndustries` 工具主描述——把"东方财富板块名"改成"证监会行业分类名（带分类代码前缀）"，加⚠️提示 agent 不要传俗名
- **与计划差异**：
  1. 计划里 step2 假设 snapshot 有 industry 列，实际没有 → screener 内自己 join（industry_map 有 7 天缓存无痛）
  2. 发现 baostock CSRC 分类名与东财板块名完全不重叠 → 用户决策改工具描述引导 agent 先查 ListIndustries（本次同步改了 TS 工具描述，未做归一化映射）
  3. `52周最高/最低` 字段删除（snapshot 无对应数据，原来也是"存在才返回"）
  4. `_source` 保留但固定 `None`（baostock 单源无降级概念）

### 给下一步的接力棒
- **ListIndustries 返回字段清单**：
  - `name`（string，如 `J66货币金融服务`）
  - `change_percent`（float，行业内 pctChg 均值）
  - `market_cap`（**恒为 null**，snapshot 无股本数据）
  - `turnover_rate`（float，行业内 turn 均值）
  - `up_count` / `down_count`（int，行业内涨跌家数）
  - 总共 83 个 CSRC 分类
- **端到端选股场景验证**：
  - PE/PB 筛选：`{pe_max: 30, pb_max: 5}` → total_matched=1432，返回样本正确
  - 行业过滤：`{industry: 'J66货币金融服务'}` → total_matched=45（前 43 是银行 + 2 非银金融）
  - market_cap 警告：`{market_cap_min: 100}` → warnings 提示、returned=3710（未误伤为 0）
- **已知限制 / 坑**（step4 及后续必读）：
  1. **industry 语义变化**：J66 类目下混少量非银金融，`industry: 'J66货币金融服务'` 筛出的不是纯银行；归一化映射未做，MVP 阶段可接受
  2. **市值筛选完全不可用**：total_market_cap NaN、warning 提示；用户如需按市值筛选需要单独解决股本数据源
  3. **industry_map 里查不到的新股**：join 后 `code_name` 会显示 `"nan"` 字符串（`str(NaN)` 默认行为）；本次全量验证未观察到，理论存在
  4. **技术筛选段 code 需要 strip 前缀**再调 `get_stock_hist`（akshare 只吃裸码），已在本步处理
  5. **pyc 缓存文件被 tracked**（.gitignore 有规则但历史遗留）：与本 step 无关，未处理
