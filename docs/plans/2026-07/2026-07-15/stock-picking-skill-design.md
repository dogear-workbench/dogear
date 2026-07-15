# 选股工作流 skill 设计

## 背景

Dogear 已有基础股票工具链（`stock-tools` / `stock-analysis-tools` / `stock-announcement-tools`），但**每次选股都要用户手把手引导 agent** 走完"圈候选 → 深挖 → 出报告"的流程。原始诉求（"科技板块选 3 只有近期利好的股票"）没有稳定 SOP，agent 每次调用工具的顺序、粒度、报告结构都不一样。

同时最近发现**东财数据源在本机路径下不稳定**（详见组共享区 `eastmoney-liveness-test-day2.md` + 历史会话 21a9c4e8）——从主进程 python 出去时会遇到 RST，从子会话出去时能通。真实使用路径踩雷概率高，工作流必须内建兜底。

## 目标

- 一份 `.claude/skills/stock-picking/SKILL.md`，agent 遇到"选股/圈股"类需求自动进流程
- 3 步 SOP，中间只在**两处**停下等用户
- 数据源分级兜底：候选池根基双源、其他单源、失败如实告知
- **先用起来，用完再迭代**——不为未来观察 SOP 埋伏笔，不做多余抽象

## 架构

### SOP 骨架（3 步分步引导）

```
[Step 1] 定条件（对话追问）
  Agent 追问硬条件（行业 / 市值 / PE 上限 / 排除ST）
  + 软条件（ROE 门槛 / 净利润增速门槛 / 是否只看盈利公司）
  明确告知："软条件会在粗筛阶段应用，不在初步候选池筛"

[Step 2] 一次跑完轻量圈选（≤15s）
  · 全A快照 + 板块列表 → 应用硬条件 → 候选池 A（15-25 只）
  · 逐股拉财报摘要（同花顺 0.5s 串行）→ 应用软条件 → 剩 10 只以内
  · 补技术信号（本地算）+ 公告标题（巨潮）
  → 输出【增强简表】，用户挑 3-5 只

[Step 3] 深挖 + 出报告（合并）
  · 对挑中的跑：K线 / CalcIndicators / GetFinancials / ReadAnnouncement 前 1-2 条 / CompareIndustry
  · 直接汇总 markdown 报告：技术面/基本面/催化剂三段
  · 明确标注"我推 / 我不推"及理由
  · 结尾附【数据缺口】表（哪只哪个维度没拿到 + 原因）
```

**两次用户交互点**：Step 1 追问 + Step 2 挑重点。

### 排除的方案

- **5 步 SOP**（原设计）：Step 2 用户"盲砍"缺依据，Step 4/5 分离无必要
- **一句话指令型**：黑盒，agent 判断偏了用户不知道
- **预设模板型**：策略写死难迭代
- **全面多源降级**：每个数据点配 2-3 个源，维护成本高，不符合"先用起来"
- **stock_yjbb_em 批量业绩接口**：东财源，封禁风险；改用 Step 2 内逐股同花顺补拉
- **Step 2 双源全挂后的逃生舱**：全挂时深挖接口也大概率挂，装模作样给假选项没意义

## 模块边界

### 新增

- `.claude/skills/stock-picking/SKILL.md` — skill 提示词，规定 SOP、失败降级姿势、报告结构、"不瞎造"铁律
- `python/utils/akshare_client.py:_try_sources()` — 通用降级 helper（按序尝试，第一个成功即返回，全失败抛 `DataSourceExhausted`）

### 改动

- `python/utils/akshare_client.py:get_all_a_stocks` — 加新浪备源（`stock_zh_a_spot`），备源触发时 DataFrame `attrs['_source'] = 'sina'`；备源缺失字段（PE/PB/流通市值）留 `NaN`
- `python/utils/akshare_client.py:get_industry_list` — 加同花顺备源（`stock_board_industry_summary_ths`）
- `python/main.py` — 抛 `DataSourceExhausted` 时 JSON-RPC 返回结构化 error（含尝试过的源和错误摘要）
- `electron/main/agents/tools/stock-analysis-tools.ts:ScreenStocks` — 捕获 `DataSourceExhausted`，工具层返回 `isError: true` + 明确文案；正常返回时把 `_source` 传到 markdown 输出的元信息一行

### 不动

- 其他 7 个 akshare 函数（雪球 xq 两个另议，本次不改）
- 现有工具的 zod schema、tool registry
- rate limiter / TTL cache（保留现状即可）

## 数据流

### 主路径（东财通）

```
用户输入 → Agent 走 SKILL.md 追问 → 
ScreenStocks(硬条件) → python.get_all_a_stocks() [东财] + get_industry_list() [东财] → 
过滤 → 逐股 get_financial_abstract() [同花顺 0.5s×N] → 
过滤 → DetectSignals(本地) + ListAnnouncements(巨潮) → 
输出增强表 → 用户挑 → 
CalcIndicators + GetFinancials + ReadAnnouncement + CompareIndustry → 
Agent 组装 markdown 报告
```

### 降级路径（东财挂）

```
python.get_all_a_stocks() 
  → 东财失败 → 走新浪 stock_zh_a_spot → 归一化 columns → 返回带 _source='sina' 的 DataFrame
ScreenStocks 输出 markdown 顶部加：
  "> 数据源：全A快照走了新浪备源（东财不可达），本次未按 PE 筛（备源不含此字段）"
Agent 在最终报告【数据缺口】表也如实标注
```

### 断路径（双源全挂）

```
python 抛 DataSourceExhausted(errors=[('eastmoney', '...'), ('sina', '...')])
→ TypeScript 工具捕获 → return { isError: true, content: '候选池数据当前不可用（东财+新浪都不通，通常几小时后恢复）。要不要稍后再试？' }
→ Agent 按此文案告诉用户，SOP 中止，不给逃生舱
```

## 错误处理 / 边界情况

三级失败处理：

| 层级 | 场景 | 处理 |
|---|---|---|
| 一级：候选池根基 | 主源挂 | 走备源，报告加降级说明 |
| 一级：候选池根基 | 双源全挂 | 中止 SOP，告诉用户稍后重试 |
| 二级：财报补拉 | 同花顺挂 | 跳过软条件筛，输出硬条件筛后的完整池 + 明说"未按 ROE 筛" |
| 三级：深挖细节 | 单只单维度挂 | 该维度标注"未获取"，其他维度继续；报告结尾统一列【数据缺口】表 |

**铁律**（写进 SKILL.md）：agent 报告里禁止用瞎猜内容填补未获取数据的段落。缺什么必须明确留白，不写"该公司盈利能力尚可"这种敷衍话。对齐记忆 `feedback-fidelity-no-fabrication`。

**限流约束**（对齐记忆 `feedback-stock-api-rate-limit`）：
- 所有 python 端调用继续走 `_bulk_limiter` (5s) / `_single_limiter` (0.5s)
- Step 2 内逐股财报补拉必须串行，最多 25 只 × 0.5s = 12.5s
- 全流程外部调用 <30 次，散布在 30-60s，安全区内
- 不为排查密集调压测

## 未决问题

- **候选池上限**：Step 2 硬条件筛后 15-25 只是感觉值，实际跑起来可能过多或过少；用完一次再定
- **用户不指定行业时怎么办**：Step 1 追问兜底策略——是坚持追问、还是默认全市场跑？倾向前者但没拍板
- **观察 SOP**：跟本 skill 是姊妹关系，起点是"已知一批股票代码"，跟踪变化+触发信号；**本次不做**，等圈选跑通后单独规划
- **雪球 xq_a_token 过期问题**：`stock_individual_basic_info_xq` / `stock_individual_spot_xq` 长期挂着；跟本 skill 无关（本 skill 用不到），但需要单独任务处理
- **`stock_board_industry_cons_ths`（同花顺行业成分股）在当前 akshare 版本被移除**：如果 Step 2 走同花顺备源要拿行业成分股，需要现场找替代或从全A快照按 industry 字段自筛；实施时确认
