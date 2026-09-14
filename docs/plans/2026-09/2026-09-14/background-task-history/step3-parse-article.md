---
step: 3
title: PARSE_ARTICLE 接入与删解析历史
status: done
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
  - `lib/client.ts` 无需改动：client 是 tipc 动态客户端（`createClient<Router>`），`client.getParseHistory` 类型由 Router 推断，无显式方法声明；删 article.ts 路由后类型自然消失
  - agent-worker PARSE_ARTICLE 返回值实际无 `durationMs` 字段（依赖上下文描述有偏差），耗时在 recordParseRun 用 `endedAt - task.createdAt` 自行计算
  - 附加防御：submitTask promise 本身 reject 时（提交失败）同步 reportDone 清理运行注册表，防注册表泄漏
- 改动文件清单：
  - `electron/main/tipc/article.ts` — 新增 parseTaskName / resolveParseHistoryStatus / buildParseSummary / recordParseRun；submitAiParseTask 提交前 reportRunning、submitTask 传入终态回调（非终态直接 return，终态调 recordParseRun）；删 getParseHistory 路由
  - `app/data-center/page.tsx` — 删 ParseHistoryPanel import、解析历史 TabsTrigger、解析历史 TabsContent（五 tab → 四 tab）
  - 删除 `app/data-center/parse-history-panel.tsx`
- 验证：`bun run build:electron` 通过；`bun run build:renderer` 通过（替代长驻 dev:renderer）；grep getParseHistory / parse-history-panel 源码引用清零（剩余均为 docs 历史文档）；dist 产物已更新；运行时验证（解析文章后执行历史出现条目）无法无人值守执行，跳过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `recordParseRun(task: AgentTask, taskName: string, status: TaskStatus, result: any, error?: string)` — article.ts 内部函数，终态组装 RunHistoryEntry（source 'parse-article' / triggerReason 'condition' / 无 tokens）→ appendHistoryEntry → reportDone，均 try/catch
  - 状态映射：CANCELLED → cancelled；FAILED → failed；COMPLETED + (error 参数 / result.error / result.parseStatus==='failed') → failed；其余 completed
  - 任务名：`文章解析 · ${platform || '通用'}`；summary 三段：URL / 解析状态+articleSaved+耗时 / trigger（result.error 有值时附第四段错误首因）
  - agent-worker PARSE_ARTICLE 正常完成返回 `{ articleId, articleSaved, scriptUpdated, parseStatus }`（'ai_enhanced' | 'quality_warning'），失败返回 `{ articleId, articleSaved: false, parseStatus: 'failed', error }`；取消时（CANCELLED）result 可能为空，summary 字段显示 '-'
- 下个 step 该从哪里继续：Step 4 协作任务接入（task-service.ts 的 interruptTask / rejectTask / reportTaskResult 状态迁移处写历史，rejected 映射 failed）
- 待办或已知限制：
  - `docs/codebase-map/data-center.md` 仍提到 parse-history-panel.tsx，属文档过时，未动（不在本 step 范围）
  - PARSE_ARTICLE 的 CANCELLED 终态实际不可达（agent-manager 无入口对 PARSE_ARTICLE 调 cancelTask），映射逻辑已就绪以防未来接入
