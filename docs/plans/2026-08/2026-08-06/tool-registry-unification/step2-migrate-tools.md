---
step: 2
title: 改造工具文件
status: pending
---

## 目标
13 个工具文件：删 registerTools 手写元数据 + 删 createXxxTools SDK 死代码 + 加 registerToolGroup。

## 依赖上下文（接力棒输入）
- Step 1 产出：`tool-registry.ts` 已重写，导出 `registerToolGroup({ server, label, create })` 和 `ToolGroupRegistration`
- 工具文件 import 改为：`import { registerToolGroup } from './tool-registry.js'`

## 计划改动

每个工具文件统一做三件事：

### A. 删除 registerTools 调用
删掉文件顶部的 `import { registerTools } from './tool-registry.js'` 和 `registerTools([...])` 整块。

### B. 删除 SDK 死代码
删掉文件末尾的 `export function createXxxTools(...)` 函数（`toSdkServer` 包装，零调用方）。
同时删除 `import { toSdkServer } from '../pi/tool-adapter.js'` 中的 `toSdkServer`（保留 `defineTool` / `ToolDef`）。

### C. 文件末尾加 registerToolGroup
```ts
registerToolGroup({
  server: 'dogear-xxx',
  label: '中文名',
  create: createXxxToolDefs,
});
```

### 各文件具体值

memory-tools.ts 已在 Step 1 试点完成，可作为参照模板。

| 文件 | server | label | 工厂 | placeholder |
|------|--------|-------|------|------------|
| memory-tools.ts | dogear-memory | 记忆系统 | createMemoryToolDefs | `['']` ✅ 已完成 |
| article-tools.ts | dogear-article | 文章管理 | createArticleToolDefs | `['']` |
| stock-tools.ts | dogear-stock | 股票行情 | createStockToolDefs | 不传（无参） |
| stock-analysis-tools.ts | dogear-stock-analysis | 股票分析 | createStockAnalysisToolDefs | 不传（无参） |
| stock-announcement-tools.ts | dogear-stock-announcement | 公司公告 | createAnnouncementToolDefs | 不传（无参） |
| stock-picking-tools.ts | dogear-stock-picking | 候选池预热 | createStockPickingToolDefs | 不传（无参） |
| group-tools.ts | dogear-group | 会话组共享区 | createGroupToolDefs | `['', '']` |
| delegation-tools.ts | dogear-delegation | Agent 协作 | createDelegationToolDefs | `[{ role: 'main', workspaceId: '', groupId: '', conversationId: '' }]` |
| reference-tools.ts | dogear-reference | 跨会话引用 | createReferenceToolDefs | `[{ workspaceId: '', groupId: '', parentConversationId: '' }]` |
| review-tools.ts | dogear-memory-review | 首页报告 | createReviewToolDefs | `['', '']` |
| digest-tools.ts | dogear-memory-digest | 逐字稿清洗 | createDigestToolDefs | `['', '']` |
| group-digest-tools.ts | dogear-group-digest | 组卡管理 | createGroupDigestToolDefs | `['', '', '', []]` |
| category-tools.ts | dogear-smart-category | 智能分类 | createCategoryToolDefs | 不传（无参） |

### article-parse-tools.ts（特殊）
只做 A（删 registerTools 调用），不做 B 和 C。它走 SDK 独立体系（createSdkMcpServer），不在 pi 工具注册中心里。保留原有 createArticleParseMcpServer 函数不动。

### tool-adapter.ts
**不需要改动。** `toSdkServer` 函数已不在该文件中（之前的重构已删除），只保留 `ToolDef` / `defineTool` / `toPiTools` / `ToolResult`。

### 清理旧 import
所有文件中 `import { defineTool, toSdkServer, type ToolDef }` 改为 `import { defineTool, type ToolDef }`。

## 实施回填

### 实际改动
（做完后填）

### 给下一步的接力棒
（做完后填）
