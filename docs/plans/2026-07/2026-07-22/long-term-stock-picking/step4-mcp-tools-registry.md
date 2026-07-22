---
step: 4
title: MCP 工具定义 + 注册表更新 + 删除旧工具
status: done
---

## 目标

把 Step 2 + 3 的 TS 服务暴露成两个 MCP 工具 `PreheatLongTermPool` + `RankByLongTerm`；从 tool-registry 删除旧 `PreheatCandidatePool` + `RankCandidates`；删除旧的 preheat-service.ts + rank-service.ts + 旧 MCP 工具定义。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：
  - Step 2 的 `preheatLongTermPool(conditions, options)` 返回 `LongTermPreheatResult`
  - Step 3 的 `rankByLongTerm(input)` 返回 `RankByLongTermResult`
  - 具体接口签名以两步的接力棒回填为准
- **当前关键文件状态**（实施时先 grep 确认）：
  - 旧 `PreheatCandidatePool` / `RankCandidates` MCP 工具定义位置：查看 `electron/main/agents/tools/` 目录，可能在独立文件 `stock-picking-tools.ts` 或者混在 `stock-analysis-tools.ts` 里
  - `tool-registry.ts` 是工具注册中枢，`registerTools()` 调用点管元数据
  - MCP server ID：旧的是 `dogear-stock-picking`，新工具沿用同一个 server ID（保持"候选池预热"这个工具包名一致，用户设置页不用重新勾）
- **关键决策回顾**：
  - MCP server ID 复用（`dogear-stock-picking`），只换工具名和 schema
  - 工具描述里明确长期视角特征、`limit` 上限 100、耗时预算 3-5 分钟
  - **完全替换**：删旧不留（用户明确"完全替换"）

## 计划改动

### 步骤 1：确认旧工具位置

先 grep 找到旧工具定义：
```
grep -r "PreheatCandidatePool\|RankCandidates" electron/main/agents/tools/
```
找到后确认在哪个文件。plan.md 假设是 `stock-picking-tools.ts`，实际可能是别的文件。

### 步骤 2：修改（或新建）工具定义文件

在同一个文件里（保持模块聚合）：

**新增 `PreheatLongTermPool` MCP 工具**：
- input schema：`industries: string[]` (min 1) / `excludeNegativePe?: boolean` / `excludeSt?: boolean` / `limit?: number` (1-100) / `wantBatchSize?: number`
- description：明确"5 年长期视角，硬筛只吃行业 + 卫生条件、不看价格/PE、耗时 3-5 分钟、上限 100 只、agent 可自主派子会话或分批"
- handler：调 `preheatLongTermPool(...)`；若 `result.ok === false` 返回 `{ isError: true, content: [{ type: 'text', text: result.error }] }`；成功返回 markdown 展示表 + 结构化 JSON 代码块（对齐旧 PreheatCandidatePool 的返回样式，让 RankByLongTerm 能直接从上下文里取 candidates）

**新增 `RankByLongTerm` MCP 工具**：
- input schema：`candidates: object[]` / `weights?: { roeMean?, growth?, trend?, stability? }` / `top?: number` (1-100)
- description：明确"从 PreheatLongTermPool 结果的 JSON 代码块里取 candidates 传入，秒级重排，权重可反复调"
- handler：调 `rankByLongTerm(...)`，返回 markdown 表 + 简短说明（`weightsApplied` + notes）

### 步骤 3：修改 `tool-registry.ts`

- 删除 `PreheatCandidatePool` + `RankCandidates` 的注册元数据（`registerTools()` 调用里的两个条目）
- 加入 `PreheatLongTermPool` + `RankByLongTerm` 的元数据（category、description）

### 步骤 4：删除旧代码

删除以下文件：
- `electron/main/services/stock/preheat-service.ts`
- `electron/main/services/stock/rank-service.ts`

删除旧 MCP 工具定义（如果和新工具在同一个文件，只删旧的函数/常量；如果旧工具独占一个文件，可以整个文件删）

### 步骤 5：确认无残留引用

grep 一遍确认没有其他地方还在 import 已删除的东西：
```
grep -r "preheat-service\|rank-service\|PreheatCandidatePool\|RankCandidates" electron/ python/
```
不该有任何残留（skill 文档在 Step 5 才改，暂时的引用不算）。

### 步骤 6：主进程 build 验证

```bash
bun run build:electron
```
不应有类型错误。有的话回到相关文件修。

## 手工验证

启动 dev server 后：
1. 在设置页 → 代理编辑页 → 工具列表，确认能看到 `PreheatLongTermPool` + `RankByLongTerm`，不能看到 `PreheatCandidatePool` + `RankCandidates`
2. 在对话里让 agent 手动调一次 `PreheatLongTermPool`，观察是否正常返回

## 实施回填

### 实际改动
- 旧的 `PreheatCandidatePool` / `RankCandidates` 就在 `stock-picking-tools.ts` 里（同一个 MCP server `dogear-stock-picking`），Step 4 直接完全重写这一个文件，保留 server 名字不变
- MCP server 版本号从 `1.0.0` 升到 `2.0.0`（breaking change 语义）
- `tool-registry.ts` 的注册元数据由文件末尾 `registerTools([...])` 覆盖，无需单独改注册表
- `tool-packs.ts` 里 `stock-picking` 包的 description 从"硬筛候选池 + 财报/信号/公告标题全池预热"改为"5 年长期视角候选池预热（PreheatLongTermPool）+ 综合评分排序（RankByLongTerm）"，toolCount 保持 2
- 删除服务文件：`preheat-service.ts`（443 行）+ `scoring-service.ts`（293 行）；plan.md 里写的是 `rank-service.ts`，实际文件名是 `scoring-service.ts`
- schema 微调：`RankByLongTerm` 的 `top` 上限设为 50（原设想 100，考虑到长期视角一般只看头部十几只）；`weights` 4 字段均 `number ≥ 0`
- 无残留引用：`preheatCandidatePool` / `scoreAndRank` / `getEffectiveWeights` / `preheat-service` / `scoring-service` 在 electron/ 下已全无引用（仅 `long-term-types.ts` 注释里出现服务文件名，无代码影响）
- `.claude/skills/stock-picking/SKILL.md` 仍引用旧工具名，属 Step 5 范围

### 改动文件清单
- 修改（完全重写）：`electron/main/agents/tools/stock-picking-tools.ts`（288 行 → 206 行）
- 修改：`electron/main/services/tool-packs.ts`（description 更新）
- 删除：`electron/main/services/stock/preheat-service.ts`
- 删除：`electron/main/services/stock/scoring-service.ts`

### 给下一步的接力棒

**工具名 + MCP server**
| 工具名 | MCP server | 用途 |
|---|---|---|
| `PreheatLongTermPool` | `dogear-stock-picking` | 长期候选池预热（3-5 分钟） |
| `RankByLongTerm` | `dogear-stock-picking` | 候选池打分排序（秒级） |

**PreheatLongTermPool 参数**
- `industries: string[]` 必填 min 1（CSRC 分类名带前缀，如 `C27医药制造业`；先用 `ListIndustries` 查）
- `excludeNegativePe?: boolean` 默认 true
- `excludeSt?: boolean` 默认 true
- `limit?: number` 1-100，默认 50
- `wantBatchSize?: number` 1-20，默认 5

**RankByLongTerm 参数**
- `candidates: object[]` min 1（从 PreheatLongTermPool 返回 JSON 代码块的 `candidates` 字段原样复制）
- `weights?: { roeMean?, growth?, trend?, stability? }` 4 字段均 `≥0`，默认各 0.25，内部自动归一化
- `top?: number` 1-50，默认 15

**返回结构**
- PreheatLongTermPool 成功：header（硬筛/预检/insufficientYears/klineFailed/耗时/快照日）+ markdown 表 + `### 数据缺口` + `### 结构化数据（供 RankByLongTerm）` JSON 代码块
- PreheatLongTermPool 失败：`isError: true`，中文错误说明
- RankByLongTerm：markdown 排名表（含 4 维度 0-100 分 + 原始指标）+ `### 生效权重（weightsApplied）` JSON

**SKILL.md 需强调的调用约定**
1. PreheatLongTermPool 只传行业 + 卫生条件，不传价格/PE（长期视角）
2. RankByLongTerm 的 candidates 必须从上一步 JSON 代码块原样取，不要手工构造
3. `insufficientYears`（年报<3年）与 `failuresByCategory.financials`（技术失败）是两个独立计数，两者都会剔除
4. 趋势状态枚举：`strong_bull` / `consolidation` / `pullback` / `bear` / `insufficient`
5. 全维度归零时 rank 阶段会 throw，agent 需 catch 后告知用户

**耗时预算**
- PreheatLongTermPool：limit=50 约 3 分钟，limit=100 约 5 分钟
- RankByLongTerm：<1 秒
