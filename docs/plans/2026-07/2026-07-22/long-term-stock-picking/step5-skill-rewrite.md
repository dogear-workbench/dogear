---
step: 5
title: Skill 文档完全重写
status: pending
---

## 目标

完全重写 `C:/dogear/.claude/skills/stock-picking/SKILL.md`，替换成长期视角 SOP：新 3 步流程 + 新铁律 + 新示例对话 + 新边界与限制。旧的短期视角内容（KDJ 金叉、当天 PE、6 维度评分权重等）全部删除。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：Step 4 落地了 `PreheatLongTermPool` + `RankByLongTerm` 两个 MCP 工具，工具名/入参 schema/返回结构以 Step 4 接力棒为准
- **当前关键文件状态**：
  - `.claude/skills/stock-picking/SKILL.md` 现有版本是完整的短期视角 SOP，可参考骨架（3 步 SOP + 铁律 + 数据源分级兜底表 + 边界与限制 + 示例对话）但内容全换
  - 设计文档 [../long-term-stock-picking-design.md](../long-term-stock-picking-design.md) 段 6 有新 SOP 的完整结构
- **关键决策回顾**：
  - 硬条件（必问）：行业/领域 / 排除 ST / 排除亏损（删掉价格、PE、市值上限）
  - 软条件（选问）：长期评分权重偏好 / 产出数量
  - 权重键：`roeMean` / `growth` / `trend` / `stability`（不是旧的 6 键）
  - 新铁律 3 条（原 2 条 + "禁止当天数据当评分维度"）
  - 深挖阶段报告结构对齐长期视角（5 年 ROE 趋势 / CAGR / 周 K MA26/52 / 年内位置 / 近 1 年公告 / 业绩下滑年份）

## 计划改动

### 完全重写 `.claude/skills/stock-picking/SKILL.md`

按以下结构组织（可以直接引用 design.md 段 6 的草案完善）：

#### 开头介绍段
- 更新描述：从"3 步 SOP"改成"长期视角 3 步 SOP"
- 强调"数据源分级兜底 + 缺数据必须留白"（这两条纪律不变）

#### 新范式介绍段（替换旧的"新范式：预热 + 评分"段）
- 强调工具已从 `PreheatCandidatePool + RankCandidates` 换为 `PreheatLongTermPool + RankByLongTerm`
- 强调"5 年长期视角，不看当天参数"
- 保留"用户需要在设置页开启工具包"的提示

#### 铁律段（3 条）
1. **缺数据必须明确留白**（不变）
2. **`status.total = 0` 或 `afterPreflight = 0` 时明确停止**（更严格）
3. **禁止用当天数据当选股依据的评分维度**——KDJ 金叉、当天涨跌幅、当天 PE 只能作为深挖阶段的辅助信息，不能作为评分依据

#### 3 步 SOP 段

**Step 1：定条件（对话追问）**
- 硬条件（必问）：
  - 行业/领域（CSRC 分类名，不确定先 `ListIndustries` 查真实值域）
  - 是否排除 ST（默认 true）
  - 是否排除亏损（默认 true）
- 软条件（选问）：
  - 长期评分权重偏好（质量为王 / 成长为王 / 趋势 + 估值平衡 / 均衡 → 对应 `roeMean` / `growth` / `trend` / `stability` 4 键权重）
  - 最终产出数量（默认 3-5 只）
- **明确删除**：价格上限 / PE 上限 / 市值范围（明确告诉用户"长期视角不看这些"）
- 追问模板重写

**Step 2：预热 + 评分**
- 调 `PreheatLongTermPool`（3-5 分钟，agent 自主判断是否派子会话跑）
- 处理 status：
  - `total = 0` → 按铁律 2 停下问用户是否放宽
  - `afterPreflight = 0` → 明确告知"候选池全部预检失败，可能行业/数据源问题"
  - `financialsFullYears / financialsPartialYears` 透传给用户看池子构成
  - 若 `financialsPartialYears > financialsFullYears` → 提示"多数候选只有 3-4 年数据，长期评分可能不够扎实"
- 调 `RankByLongTerm` 秒级排序 → 综合评分简表
- 若某维度归零（`weightsApplied` 里某键为 0）→ 透传给用户"XX 维度全池缺失已归零"
- 用户挑 3-5 只 或 换权重再排

**Step 3：子会话并行深挖**
- 用 `CreateSessionBatch` 一次派 N 个子会话（对齐现有）
- 每个子会话 task 描述明确带上：长期评分表里的数据（`roeMean5y` / `CAGR` / `trendState` / `yearPositionPct` / `netProfitDeclineYears` 等）
- 子会话职责（对齐长期视角）：
  1. **长期基本面**：`GetFinancials(periods=20)` 拿完整财报 → 逐年展示 ROE / 净利 / 营收趋势；CAGR 分解；毛利/净利率变化
  2. **长期技术面**：
     - `GetKLineData(period='weekly', limit=250)` + `CalcIndicators(indicators=['MA'], params={MA:{N:[26,52]}})` 周 K 均线
     - `GetKLineData(period='monthly', limit=60)` 月 K（5 年月 K = 60 期）看更长趋势
     - 年内价格位置（已在候选数据里）
  3. **催化剂**：`ListAnnouncements(since='近 1 年')` 取标题挑重要 1-2 条 `ReadAnnouncement` 读全文（改成 1 年不是 30 天）
  4. **风险提示**：业绩下滑年份、长期趋势拐点、行业景气度对比
- 报告结构模板（更新）：
  ```markdown
  ### <代码> <名称>

  **推 / 观望 / 不推**（三选一 + 一句话理由）

  #### 长期基本面
  - 5 年 ROE 趋势：XX% → XX% → XX% → XX% → XX%
  - 净利 CAGR：X% / 营收 CAGR：X%
  - 稳定性：ROE 变异系数 X，业绩下滑 X 年
  - 缺哪项留白

  #### 长期技术面
  - 周 K 状态：strong_bull / consolidation / pullback / bear
  - MA26/52 相对关系 + 斜率
  - 年内位置：XX%（0=年内最低 / 100=年内最高）
  - 月 K 长期趋势

  #### 长期催化剂
  近 1 年重要公告要点（1-2 条）；无则写"近 1 年无重要公告"

  #### 风险提示
  近 5 年业绩下滑年份 / 长期趋势拐点 / 行业相对表现

  #### 综合评分背景
  引用 Step 2 RankByLongTerm 该股的综合分和各维度分
  ```

#### 综合评分权重段
- 4 维度默认均衡各 25%
- 分位数在候选池内部排序（不是全市场）
- 全池归零重分配说明
- 常见预设组合参考（质量 / 成长 / 均衡）

#### 子会话并行边界段
- 数据源缓存加持仍然有效（K 线 JSONL / 财报缓存 / 公告 hash 缓存）
- 唯一并发瓶颈：`ReadAnnouncement` 首次拉 PDF

#### 数据源分级兜底表段（更新）
| 层级 | 场景 | 处理姿势 |
|---|---|---|
| A 中止 | PreheatLongTermPool 返回 ok=false 或 total=0 或 afterPreflight=0 | 直接告诉用户，问是否放宽行业 |
| B 单只剔除 | status.preflightFailed / insufficientYears / klineFailed 里的股票 | 池子里不出现，透传剔除数量 |
| C 单只降级 | growthDowngrade / trendState='insufficient' | 报告里明确该只该维度是降级算的 |
| D 全池归零 | RankByLongTerm 返回 weightsApplied 里某维度为 0 | 提示用户"XX 维度全池缺失已归零" |
| E 快照时效 | 调用 < 17:30 拿到前一交易日快照 | 透传 status.snapshotDate 让用户知道 |

#### 边界与限制段（更新）
- 5 年窗口 → 上市 <3 年的公司被剔除
- 周 K 250 期 → 新股不满会 trend 降级
- 硬筛无价格/PE/市值 → 用户想过滤"太贵"的股票只能事后剔
- 耗时 3-5 分钟 → agent 自主判断是否派子会话（>10 分钟或主上下文 >100k 建议派）
- 单次预算：预热 3-5 分钟 + 评分 <1s + 5 个子会话并行深挖 60-90s

#### 示例对话片段段（重写）
参照 design.md 段 6 末尾的示例，重写一个长期视角完整示例。

## 手工验证

Step 5 完成后：
1. 人工阅读 SKILL.md，检查：
   - 完全没有 "PreheatCandidatePool" / "RankCandidates" / "signals" / "催化剂 10%" 等旧字段的残留
   - 所有铁律、SOP 步骤、边界都对齐长期视角
   - 示例对话完整可执行
2. 重启一次对话，让 agent 说"你从科技股里选几只我看看"，观察是否按新 SOP 追问条件

## 实施回填（做完后填）

### 实际改动
（对 design.md 段 6 草案的调整、示例对话的具体内容等）

### 改动文件清单
（`SKILL.md`）

### 给下一步的接力棒
（Step 6 端到端验证需要按本 step 定稿的 SOP 跑一遍，验证 skill 描述与工具实际行为一致）
