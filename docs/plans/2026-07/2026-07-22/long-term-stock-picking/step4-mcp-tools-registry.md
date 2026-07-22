---
step: 4
title: MCP 工具定义 + 注册表更新 + 删除旧工具
status: pending
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

## 实施回填（做完后填）

### 实际改动
（旧工具实际所在文件、是否合并到 stock-picking-tools.ts、schema 上的调整等）

### 改动文件清单
（新增/修改/删除的文件）

### 给下一步的接力棒
（Step 5 Skill 文档要引用新的工具名 + schema + 描述，本 step 落地版本的工具名/参数细节；旧工具的注册状态；MCP server 层的 breaking changes 等）
