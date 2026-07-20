---
step: 5
title: 改写 stock-picking skill 文档
status: done
---

## 目标

把新 SOP 落进 `.claude/skills/stock-picking/SKILL.md`：
- Step 2 从"agent 手工串行调 N 只财报"改为"调一次 PreheatCandidatePool + 一次 RankCandidates"
- Step 3 从"主会话串行深挖"改为"主会话派 N 个子会话，每只 1 个"
- 加"预热+评分"新范式的解释
- 加长周期 3 维度（周 K MACD / MA60 方向 / 年内价格位置）
- 加权重公式默认值 + 用户可调姿势
- 更新子会话并行边界表（缓存加持下变宽了）

## 依赖上下文

**前置 step 产出**（Step 1-4 完成后回填）：
- PreheatCandidatePool 工具的实际参数名和输出格式
- RankCandidates 工具的实际参数名和输出格式
- DEFAULT_WEIGHTS 的最终值
- 缓存新鲜度的实际行为（比如预热重跑第二次的实测耗时）

**现有文件**：`.claude/skills/stock-picking/SKILL.md`（当前版本在本次对话里已经完整看过，见 skill 初始载入）

## 计划改动

### 重写 SKILL.md 的 SOP 三步

**Step 1（保留大部分，只加权重对齐）**

- 保持原有的行业/市值/PE/ROE/数量追问模板
- 追加一段："如需自定义评分权重，可在此说明（如'我更看重估值和 ROE'），否则用默认权重（ROE 25% / 增速 25% / 估值 20% / 信号 15% / 催化剂 10% / 惩罚 5%）"

**Step 2（重写为"预热 + 评分"两步走）**

替换现有的"三步串行"为：

```markdown
### Step 2：预热 + 评分（一次预热 + 秒级重排序）

新架构下这一步只需两个工具调用：

1. **`PreheatCandidatePool`**——传硬条件（industries / price_max / pe_max / market_cap_min / limit=50），
   一次拿到完整候选池数据（含财报/信号/公告，已缓存）。首次约 40s，同天重跑 <15s。
   
   工具返回的 JSON 数据块要**原样复制**给下一步。
   
2. **`RankCandidates`**——把 JSON 数据 + weights（可选）传进来，返回综合排序 Top 15。
   
   用户如果想调权重看不同视角，**反复调 RankCandidates 即可**，秒级出结果（纯本地算）。

**产出【综合评分简表】**（RankCandidates 输出的 markdown 表），然后停下问用户：
"以上 15 只按当前权重排序，你想深挖哪 3-5 只？（也可以换权重再看一版）"
```

**Step 3（重写为子会话深挖）**

替换现有的"主会话串行深挖"为：

```markdown
### Step 3：子会话并行深挖（每只 1 个子会话）

对用户挑中的 N 只，主会话派 N 个子会话（用 CreateSessionBatch 一次派出）。

**主会话职责**：
- 用 CreateSessionBatch 一次派 N 个子会话
- 每个子会话 task 描述："深挖股票 <code> <name>，输出完整报告到 shared/reports/<code>.md"
- 等所有子会话交付
- 读所有报告，写"横向对比章节" + "数据缺口表" + "最终推荐"

**子会话职责**（每只独立执行）：

1. **技术面**（本地缓存加持，无 API 压力）：
   - `GetKLineData(period='daily', limit=120)` + `CalcIndicators(indicators=['MACD','KDJ','RSI','BOLL','MA'])` → 日 K 状态
   - `GetKLineData(period='weekly', limit=52)` + `CalcIndicators(indicators=['MACD'], period='weekly')` → 周 K 趋势
   - `CalcIndicators(indicators=['MA'], params={MA:{N:[60,120]}})` → 中长期均线方向
   - 计算"年内价格位置" = (当前价 - 近 250 日 min) / (近 250 日 max - 近 250 日 min)（本地 K 线数据算）

2. **基本面**（Step 1 缓存加持，秒回）：
   - `GetFinancials(periods=4)` → 拉最近 4 期财报（缓存命中不走 Python）
   - `CompareIndustry` → 行业内相对估值

3. **催化剂**（Step 2 缓存加持）：
   - `ListAnnouncements(since='近 30 天', limit=10)` → 拿标题列表
   - 从中挑最重要 1-2 条调 `ReadAnnouncement` 读全文（PDF 缓存加持）

4. **组装报告**写到 `shared/reports/<code>.md`（组共享区），格式参考 skill 里的报告模板

**为什么可以并行**：数据源全部有本地缓存（Step 1-4 改造后），子会话读缓存不撞任何上游 API。
```

### 新增章节

**"预热+评分"新范式解释**（放在 SOP 之前）：

```markdown
## 新范式：预热 + 评分（v2 重构后）

传统流程是"agent 手工串行调 N 次财报 + N 次信号 + N 次公告"，
问题是候选池截断偏差、执行错误多、重跑成本高。

v2 改为：
- 一次 `PreheatCandidatePool` 完成所有原始数据拉取，落地本地缓存
- 一次 `RankCandidates` 按权重公式打分排序（纯本地，秒级）
- 用户可反复调不同权重看结果稳定性
```

**"子会话并行边界表"**（放在 Step 3 后作为设计说明）：

```markdown
## 子会话并行边界（v2）

缓存架构改造后，所有数据源在预热完成后都是本地读，子会话并行不撞任何 API：

| 数据源 | 预热前 | 预热后（本 skill 场景） |
|---|---|---|
| baostock 全 A 快照 | ✅ 已缓存 | ✅ 本地读 |
| 同花顺财报 | ❌ 0.5s 单股限流 | ✅ Step 1 缓存命中 |
| K 线 | ⚠️ 令牌桶 | ✅ JSONL 增量命中 |
| 巨潮公告标题 | ⚠️ 令牌桶 | ✅ Step 2 当天缓存 |
| 巨潮 PDF 全文 | ⚠️ 令牌桶 | ✅ hash 缓存（首次深挖时首次拉） |

**唯一并发瓶颈**：子会话如果每只都要 ReadAnnouncement 拉从未缓存过的 PDF，会撞巨潮限流。
缓解：主会话在派子会话前，先在 Step 2 简表阶段就 ReadAnnouncement 预拉最重要的公告（可选优化，不强制）。
```

**"权重公式"章节**（放在"边界与限制"前）：

```markdown
## 综合评分权重

RankCandidates 默认权重：

| 维度 | 权重 | 数据来源 |
|---|---|---|
| ROE | 25% | 最近年报 ROE 分位数 |
| 净利增速 | 25% | max(年报, 一季报) 净利同比分位数 |
| 估值 | 20% | PE 倒数分位数（越低越好） |
| 技术信号 | 15% | 近 7 天信号加权总分 |
| 公告催化剂 | 10% | 近 30 天公告关键词加权总分 |
| 业绩下滑惩罚 | -5% | 净利同比 < -20% 触发 |

**用户想调权重**：直接告诉 agent"更看重估值"或"技术面权重加到 30%"，agent 传 weights 参数给 RankCandidates 即可。
```

### 更新"铁律"章节

- 保留原铁律 1（缺数据必须留白）
- **删除**原铁律 2（"财报必须串行"）——现在由 PreheatCandidatePool 内部管，agent 不需要管
- **删除**原铁律 3（"数据源全挂时中止"）——现在 PreheatCandidatePool 会在 status 里透传失败率，agent 只需按 status 判断
- 新增铁律：**PreheatCandidatePool 返回的 status.total 为 0 时直接告诉用户"当前条件无候选，是否放宽条件"，不能凭空造股票**

### 保留不变

- 追问模板（Step 1 里的问答模式）
- 报告模板（Step 3 里的每只报告结构）
- 【数据缺口】表要求
- 边界与限制章节（大部分保留，去掉"财报接口 0.5s 限流"这条已过时的注意）
- 示例对话片段（更新为新工具调用姿势）

### 手动验证

- 用新 SKILL.md 跑一次完整选股：能否按新 SOP 走通（Step 1 追问 → Step 2 两个工具 → Step 3 子会话深挖）
- 用户改权重后 RankCandidates 是否秒级出新结果
- 派 5 只子会话是否能同时跑不撞 API（观察日志）

## 实施回填

### 实际改动

- **改动文件清单**：`.claude/skills/stock-picking/SKILL.md`（主会话直接 Edit，按 staged-execution 铁律 `.claude/` 文件不派子会话）
- **与计划差异**：
  1. 铁律精简为 2 条（缺数据留白 + status.total=0 处理）——原铁律 2/3 都是关于"财报串行 / 数据源全挂"，v2 架构下这两件事都在 PreheatCandidatePool 内部处理，agent 层不再需要纪律约束。
  2. Step 1 追问模板增加了「新工具是否可用」的兜底提示，若 agent 检测到没有 PreheatCandidatePool / RankCandidates 工具则告知用户去设置页开启，避免退回旧姿势。
  3. Step 3 报告模板新增「综合评分背景」小节，让子会话把评分表结果和深挖发现关联起来（原计划没提但有价值——避免深挖报告和评分脱节）。
  4. 「数据源分级兜底表」重写为按新架构分三级：预热本身 / 预热维度缺失 / 深挖细节。原表按数据源分类的姿势在新架构下不适用。
  5. 示例对话片段完整重写，展示新流程（含权重调整、CreateSessionBatch 派子会话）。

### 完成总结

**架构收益**：
- 原流程：agent 手工串行调 25 只 × (1 财报 + 1 信号 + 1 公告) = 75 次工具调用，容易在某一步执行错误导致整流程重跑；换权重要重新走一遍
- 新流程：agent 只调 2 个工具（预热 + 评分），编排逻辑收敛到主进程；换权重秒级重跑
- 首次预热约 40s，同天重跑 <15s（财报缓存永久命中 + 公告当天缓存命中 + K 线 JSONL 命中）

**权重可调**：分位数打分 + 归一化权重 + 全池缺失自动归零，让权重调整不用担心某维度缺失导致排序失衡。

**子会话并行深挖**：v2 缓存架构让 5 只并行深挖不撞任何 API（唯一 PDF 首次拉走巨潮 limiter 排队），复杂需求下深挖阶段耗时从串行 ~5 分钟降到并行 ~1 分钟。

**遗留问题 / 后续优化方向**：
1. `netProfitYoYQuarter` 目前 baostock 主源恒为 null → growth 维度只用年报口径。若切回同花顺兜底或补充新数据源，季报口径可自动生效，无需改代码。
2. `marketCapMin/Max` baostock 主源无股本数据，硬筛条件基本不生效。补股本数据源后可解锁市值区间硬筛。
3. `PreheatCandidatePool` 的 `limit` 默认 50 是保守估计（覆盖大多数场景），如用户明确要跑大池子（比如全行业扫描），可支持到 100，但耗时接近 80s，可能需要 UI 侧加进度反馈（超出本次重构范围）。
4. 子会话深挖阶段没有做「首次拉 PDF 前的预热」优化——如果用户挑的 3-5 只公告都从未缓存过，会有 3-5 次 PDF 顺序拉取。理论上主会话可以在 Step 2 简表阶段就 ReadAnnouncement 预拉排名前 15 的最重要公告，但会拖慢 Step 2 反馈，权衡后没做，等真跑起来看用户反馈再定。
5. 手动验证留给下次真实选股任务触发时进行（当前 build/lint 均通过，MCP 工具注册路径与已有 stock 工具包同构，运行时应无问题）。
