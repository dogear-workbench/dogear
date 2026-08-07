---
step: 4
title: 命名修正
status: done
---

## 目标
修正注入到系统提示词里的工具名称，从 SDK 风格的 `mcp__server__*` 改为 pi 实际使用的裸名。

## 依赖上下文（接力棒输入）
- Step 1-3 已完成，工具注册中心统一，设置页数据流打通

## 计划改动

### `electron/main/agents/tool-pack-guide.ts`

旧：
```ts
lines.push('- 记忆系统（`mcp__dogear-memory__*`）：跨会话保存/查询偏好和反馈');
...
lines.push(`- ${pack.label}（\`mcp__${pack.mcpServerName}__*\`）：${pack.description}`);
```

新：去掉 `mcp__server__*` 前缀写法。两种选法：

**选 A（推荐）：用 server 名做分类说明**
```ts
lines.push('- 记忆系统（RecallMemory / SaveMemory / ForgetMemory）：跨会话保存/查询偏好和反馈');
```
对于可选工具包，列具体工具名需要从 ToolPackMeta 获取。但 ToolPackMeta 目前只有 toolCount 没有工具名列表。

**选 B：用 server 分组说明**
```ts
lines.push('- 记忆系统（dogear-memory 工具组）：跨会话保存/查询偏好和反馈');
```
更简洁，但不告诉 agent 具体工具名。

**推荐选 B**：因为 tool-pack-guide 的定位是「类目导览」，不是工具清单。agent 调工具时看的是工具 schema（在上下文里），这里只需要告诉它有哪些类目。`dogear-memory` 作为分类标识，让 agent 知道这是一个工具组即可。

最终文本：
```
- 记忆系统（dogear-memory 工具组）：跨会话保存/查询偏好和反馈
- 股票行情（dogear-stock 工具组）：实时报价、K线历史...
```

### `electron/main/services/stock-analysis-skills-service.ts:30`

旧：
```ts
本技能描述使用 `mcp__dogear-stock-analysis__*` 工具进行股票分析时的推荐流程。
```

新：
```ts
本技能描述使用股票分析工具（dogear-stock-analysis 工具组）进行股票分析时的推荐流程。
```

### 其他 mcp__ 引用（不改）
- `agent-worker.ts:262-279` — PARSE_ARTICLE 的 SDK 任务，确实用 mcp__ 前缀，不动
- `transcript-adapter.ts:30` — 逐字稿清洗兼容旧 SDK 历史，不动
- `tool-packs.ts` 注释 — 只是注释

### 已知技术债：AgentsTab.tsx 的 `mcp__server__*` 通配符

`app/settings/AgentsTab.tsx` 中的 `deriveToolGroupSelection` / `expandToolGroupSelection` 仍用 `mcp__${server}__*` 通配符来读写自定义 agent 定义文件的 tools 字段。

**当前影响**：不影响运行时——pi-session 用 `toolPackMap` 做实际工具过滤，不消费 agent.tools 白名单。仅影响设置页 UI 的分组勾选展示。

**不在本计划修复**：该通配符机制的改造依赖第二阶段「设置页重组」的 Tab 结构调整，留到后续处理。

## 实施回填

### 实际改动
- `tool-pack-guide.ts`：3 处 mcp__ 前缀改为「工具组」表述
- `stock-analysis-skills-service.ts`：技能描述中的 mcp__ 引用改为工具组表述，同时去掊 SDK Tool Search 过时描述
- `AgentsTab.tsx` 的通配符机制标记为已知技术债，不在本步骤范围

### 完成
本计划全部 4 步完成。代码编译通过，lint 无新增 error。
