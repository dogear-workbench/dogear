---
step: 6
title: 端到端手工验证
status: pending
---

## 目标

真实跑一次完整长期视角选股流程（Step 1 定条件 → Step 2 预热+评分 → Step 3 子会话深挖），验证：
- 工具实际行为与 SKILL.md 描述一致
- status 字段透传正确
- 4 维度打分逻辑符合预期
- 错误场景（无候选、预检全失败、维度归零）处理正确
- 子会话深挖报告结构对齐长期视角

## 依赖上下文（接力棒输入）

- **前置 step 产出**：Step 1-5 全部完成，`PreheatLongTermPool` + `RankByLongTerm` MCP 工具已注册，Skill 文档已重写
- **当前关键文件状态**：
  - dev server 已能启动，`bun run dev` 正常
  - 设置页工具包"候选池预热"仍然是开启状态（server ID 未换）
- **关键决策回顾**：
  - 本 step 不写代码，只手工跑 + 观察 + 记录问题
  - 发现问题回到对应 step 修补，回填到那个 step 的"实际改动"里
  - 无问题则填 plan.md 完成总结

## 计划验证项

### 场景 1：正常路径（科技三行业 + 均衡权重）

在一个真实对话里：
```
用户：帮我在科技股里选几只长期可以放心的
```

期望 agent 行为：
1. **Step 1**：按新 SOP 追问：行业细分（列出 C39/I65/I64/M75 等）+ 排除 ST + 排除亏损 + 权重偏好 + 数量。**不追问价格/PE**
2. **Step 2**：调 `PreheatLongTermPool(industries=[...], limit=50)`。3-5 分钟后返回。透传 status 段（total / afterPreflight / financialsFullYears / snapshotDate）。调 `RankByLongTerm` 出综合评分表。等用户挑
3. **Step 3**：用户挑 3 只后，agent 用 `CreateSessionBatch` 派 3 个子会话。每个子会话按新报告结构产出长期视角报告

**验证清单**：
- [ ] Agent 追问条件时**没有**问价格上限 / PE 上限（如问了 → Skill 文档没生效或 agent 走了旧记忆，回 Step 5 检查）
- [ ] `PreheatLongTermPool` 返回的 candidates 里能看到 `roeMean5y / netProfitCAGR5y / weeklyMA26 / yearPositionPct / trendState / netProfitDeclineYears` 字段
- [ ] `status.snapshotDate` 存在且是最近交易日
- [ ] `status.afterPreflight <= status.total`，`status.financialsFullYears + status.financialsPartialYears <= status.afterPreflight`
- [ ] `RankByLongTerm` 综合分 = 4 维度加权求和（手动挑 1-2 只算一下核对）
- [ ] 子会话报告结构对齐长期视角（有 5 年 ROE 趋势 / 周 K / 年内位置 / 近 1 年公告 段落，没有 KDJ 金叉 / 近 7 天信号 等旧字段）

### 场景 2：无候选路径

```
用户：帮我在"J66 货币金融服务"里找长期科技股（故意错配行业，或选 CSRC 里罕见的）
```

期望：`PreheatLongTermPool` 返回 total=0 或 afterPreflight=0 → agent **明确停下**告诉用户没候选，问是否换行业。

**验证清单**：
- [ ] Agent 没有编造股票（对齐铁律 1）
- [ ] 明确停在这一步，不硬着头皮跑评分

### 场景 3：维度归零路径

（可能自然发生：若某行业池子里所有候选周 K 都不到 100 期，trendScore 全池 null）

期望：`RankByLongTerm` 返回 `weightsApplied` 里 trend=0，其他 3 维按比例放大到和为 1，`notes` 里有说明。Agent 应该透传给用户"XX 维度全池缺失已归零，请注意评分口径"。

**验证清单**：
- [ ] 权重归零逻辑正确（对应维度权重为 0）
- [ ] 其他维度按比例放大（和为 1）
- [ ] Agent 透传了这个信息给用户

### 场景 4：权重换算再排一次

用户跑完场景 1 后说"换成质量为王的权重再看一版"。

期望：agent **不重新预热**，只调一次 `RankByLongTerm` 传新权重（如 `{ roeMean: 0.4, stability: 0.3, growth: 0.2, trend: 0.1 }`），秒级返回新排序。

**验证清单**：
- [ ] Agent 没有重新调 `PreheatLongTermPool`（对齐"换权重不用重复预热"）
- [ ] 新权重下评分表排序变化合理（ROE 高的股票排名上升）

### 场景 5：设置页工具列表检查

打开设置页 → 代理编辑页 → 工具列表：
- [ ] 能看到 `PreheatLongTermPool` + `RankByLongTerm`
- [ ] **看不到** `PreheatCandidatePool` + `RankCandidates`（旧工具已删）

## 如果发现问题

- **工具行为与预期不符**：回到 Step 2 / Step 3 修 service 层
- **工具描述/schema 有误**：回到 Step 4 修 MCP 工具定义
- **Agent 走了旧记忆或误解 SOP**：回到 Step 5 优化 SKILL.md 措辞
- **数据源本身问题**（baostock 挂 / 同花顺封）：不属于本次范围，记入未决问题

## 完成后动作

无问题则：
1. 更新 `plan.md` 末尾加「## 完成总结」段：实际改动汇总、与原计划偏差、遗留问题
2. 记忆里加一条 project memory（可选）：记录长期视角 SOP 已上线，用户偏好长期为默认

## 实施回填（做完后填）

### 验证结果
（场景 1-5 逐项标记通过/失败，失败项的问题描述 + 修复位置）

### 发现的偏差
（工具实际行为与 skill 描述的差异，如何调和的）

### 遗留问题
（本次不修的，留给未来迭代的）
