---
step: 3
title: PARSE_ARTICLE 接入与删解析历史
status: pending
---

## 目标
文章 AI 解析任务进入统一历史；删除数据中心「解析历史」tab 及其 IPC（`history.jsonl` 写入保留，agent 诊断数据源）。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 的 `RunHistorySource`、`background-activity-service`、`appendHistoryEntry` 带法
- 当前关键文件状态：
  - `electron/main/tipc/article.ts:103` — `void getAgentManager().submitTask(task).catch(...)`，无终态回调，需补
  - PARSE_ARTICLE payload：`articleId/articleDir/workspacePath/url/skillsDir/platform/trigger/modelSelection`
  - agent-worker 返回值：`{ articleId, articleSaved, parseStatus, durationMs, error? }`（无 usage，不带 tokens）
  - `app/data-center/page.tsx` — 五 tab（用量/定时计划/执行历史/解析历史/记忆），forceMount 逻辑在 scheduler tab
  - `app/data-center/parse-history-panel.tsx` — 待删
  - `lib/client.ts` — `getParseHistory` 方法待删（全仓唯一调用方是 parse-history-panel）
- 关键决策回顾：parse-article 不带 tokens；missed 概念不适用；写历史失败不影响解析本身（解析状态已有自己的 articleParseStatusChanged 链路）

## 计划改动
- [ ] `electron/main/tipc/article.ts` — submitTask 传入终态回调：提交前 `reportRunning(task.id, { source: 'parse-article', name: 文章解析 · {platform || '通用'} })`；终态（COMPLETED/FAILED/CANCELLED）写 `appendHistoryEntry`：`source: 'parse-article'`、planName 同注册名、status 映射（同 step2 规则；parseStatus 'failed' 或 result.error → failed）、summary = 结果文本（URL、解析状态 parseStatus、articleSaved、耗时 durationMs、trigger）、error、startedAt/endedAt、triggerReason: 'condition'；写完 reportDone；均 try/catch
- [ ] `electron/main/tipc/article.ts` — 删 `getParseHistory` 路由（约 :548）
- [ ] `lib/client.ts` — 删 `getParseHistory` 方法
- [ ] `app/data-center/page.tsx` — 删解析历史 tab（import、tab 项、面板渲染）
- [ ] 删 `app/data-center/parse-history-panel.tsx`
- [ ] `bun run build:electron` + `bun run dev:renderer` 无引用残留；解析一篇文章后执行历史出现条目

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
