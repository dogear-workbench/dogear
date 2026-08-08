---
step: 1
title: ToolDef 加 shortDescription 字段
status: done
---

## 目标

在 `ToolDef` 数据结构中新增 `shortDescription` 字段，修改 `defineTool` 签名，为全部 53 个 `defineTool` 调用补写一句话精简描述，并透传到 `ToolInfo` / `getAllToolGroups()` 供前端使用。

## 依赖上下文（接力棒输入）

- 当前 `ToolDef` 定义在 `electron/main/agents/pi/tool-adapter.ts:10`
- `defineTool` 辅助函数在同文件 `:22`，当前签名：`defineTool(name, description, schema, handler)`
- `ToolInfo` 定义在 `electron/main/agents/tools/tool-registry.ts:12`，当前字段：`{ name, description }`
- `getAllToolGroups()` 在同文件 `:48`，从 ToolDef 提取 name + description 映射到 ToolInfo
- 前端 `AbilityTab.tsx:17` 的 `ToolInfo` 接口需同步加字段（但前端改动在 Step 2）

## 计划改动

### 1. 改 ToolDef + defineTool 签名

- [ ] `electron/main/agents/pi/tool-adapter.ts:10` — `ToolDef` 接口加 `shortDescription: string`
- [ ] 同文件 `:22` — `defineTool` 签名改为 `(name, shortDescription, description, schema, handler)`，返回对象加 `shortDescription`
- [ ] 同文件 `:28` `toPiTools()` — 不需要改（shortDescription 不传给 pi/agent，只给设置页展示）

### 2. 改 ToolInfo + getAllToolGroups

- [ ] `electron/main/agents/tools/tool-registry.ts:12` — `ToolInfo` 接口加 `shortDescription: string`
- [ ] 同文件 `:53` — `getAllToolGroups()` 的 `defs.map` 加 `shortDescription: d.shortDescription`

### 3. 为 53 个 defineTool 调用补 shortDescription

按文件分批改（每个 `defineTool` 第一个参数 `name` 后面插入 `shortDescription` 字符串）：

- [ ] `tools/article-tools.ts`（2 个）：ReadArticle、ListArticles
- [ ] `tools/category-tools.ts`（5 个）：ListCategories、SaveCategoryJoin、SaveCategoryNew、SaveCategoryMerge、PruneCategoryTags
- [ ] `tools/delegation-tools.ts`（6 个）：CreateSession、CreateSessionBatch、SendMessage、WaitForMessage、ListLinkedSessions、StopSession
- [ ] `tools/digest-tools.ts`（1 个）：CleanTranscript
- [ ] `tools/group-digest-tools.ts`（3 个）：ReadGroupDigest、SaveGroupDigest、（第三个）
- [ ] `tools/group-tools.ts`（3 个）：ListGroupFiles、ReadGroupFile、WriteGroupFile
- [ ] `tools/memory-tools.ts`（5 个）：RecallMemory、SaveMemory、ForgetMemory、GetCoreProfile、UpdateCoreProfile
- [ ] `tools/reference-tools.ts`（3 个）：ReadReferenceSession、ReadGroupBackground、ListSiblingSessions
- [ ] `tools/review-tools.ts`（5 个）：ListDigests、ReadDigest、TraceSource、ReadReport、WriteReport
- [ ] `tools/stock-tools.ts`（6 个）：SearchStock、GetStockQuote、GetKLineData、GetTimeline、GetWatchlist、ModifyWatchlist
- [ ] `tools/stock-analysis-tools.ts`（10 个）：CalcIndicators、ScreenStocks、ListIndustries、GetFinancials、CompareIndustry、DetectSignals、EvalFormula、SimpleBacktest、等
- [ ] `tools/stock-announcement-tools.ts`（2 个）：ListAnnouncements、ReadAnnouncement
- [ ] `tools/stock-picking-tools.ts`（2 个）
- [ ] `pi-session/search-tools.ts`（2 个）：Glob、Grep
- [ ] `pi-session/skill-loader.ts`（1 个）：Skill 工具

### shortDescription 编写原则

- 一句话中文，≤20 字
- 说「做什么」，不说「怎么调 / 返回什么 / 什么时候用」
- 面向用户（非 agent），避免技术黑话
- 示例：
  - `SearchStock` → "搜索 A 股股票"
  - `GetStockQuote` → "获取实时行情"
  - `CalcIndicators` → "计算技术指标（MA/MACD/KDJ 等）"
  - `CreateSession` → "派出子会话执行任务"
  - `RecallMemory` → "按关键词查询历史记忆"

## 实施回填（做完后填）

### 实际改动

- 17 个文件，56 个 defineTool 调用（step 预估 53，实际多出 GetFundFlow / GetNorthboundHolding / SaveGroupBackground）
- `tool-adapter.ts`：ToolDef 接口 + defineTool 签名改为 `(name, shortDescription, description, schema, handler)`
- `tool-registry.ts`：ToolInfo 接口 + getAllToolGroups() 透传 shortDescription
- 15 个工具文件：每个 defineTool 调用补 shortDescription 字段
- toPiTools() 未改（shortDescription 不传给 pi/agent）
- lint: 0 errors, 76 warnings（已有的 no-explicit-any）

### 给下一步的接力棒
- `ToolInfo` 现在有 `{ name, shortDescription, description }` 三个字段
- 前端 `client.getRegisteredTools()` 返回的数据已包含 shortDescription
- AbilityTab.tsx 前端接口 `ToolInfo`（:17）需同步加 `shortDescription` 字段
- defineTool 签名是 `(name, shortDescription, description, schema, handler)`
