---
step: 2
title: 主进程构成估算
status: done
---

## 目标
CTX 快照写入 `categories`（提示词细分/工具定义/消息分桶，按真实 totalTokens 校准），随现有 JSONL → latestContext 管道到前端。

## 依赖上下文（接力棒输入）
- 设计文档：`../../usage-context-composition-and-pricing-design.md` §1 上下文构成
- 现状：`electron/main/agents/pi-session/usage-extractor.ts:64` `extractPiContextSnapshot(message, turnIndex, resolveWindow)` 返回快照，`categories: []` 恒空；调用点 `pi-session.ts:854`
- 提示词拼装：`pi-session.ts:553-574` `promptParts = [projectClaudeMd, userClaudeMd, skillIndexText, coreProfileText, groupContextText, ...APPEND]` → `systemPrompt`
- tools 数组：`pi-session.ts:599` 附近 `tools: AgentHarnessTool[]`（builtin + toPiTools(toolDefs)）
- adapter 持有 pi-agent-core `Session`，`session.buildContext()` 返回 `{ messages: AgentMessage[], ... }`
- AgentMessage 形状见 `node_modules/@earendil-works/pi-agent-core/dist/harness/messages.d.ts`（convertToLlm 输入）

## 计划改动
- [x] `usage-extractor.ts` 加 `estimateTokens(text: string): number`（CJK ×1 + 其他 ×0.25）
- [x] `extractPiContextSnapshot` 加可选参数 `composition?: Array<{ name: string; tokens: number }>`
- [x] `pi-session.ts` start() 末尾算一次并缓存到实例
- [x] `pi-session.ts:854` 快照点：调 `this.adapter` 暴露的 session
- [x] `usage-extractor.test.ts` 补用例：校准缩放正确、空 composition 留空、Σ=0 不除零（新增 6 用例，11 pass）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **异步时序修正（计划未提）**：buildContext 是 async，若整体异步化，agent_end 同步读 `currentRunContextTokens` 会拿到 undefined（丢 entry.lastContextTokens）。故快照点拆两段：`emitContextSnapshot` 同步记账 + fire-and-forget `emitContextSnapshotAsync` 异步构成估算；totalTokens 口径提为共享函数 `contextTotalTokens(usage)`（input+cacheRead+cacheWrite）
  2. 消息分桶函数 `estimateMessageBuckets` 落在 usage-extractor.ts（估算逻辑内聚 + 可测），pi-session 只组装；custom 系 role（bashExecution/custom/branchSummary/compactionSummary）按 convertToLlm 口径并入用户桶，`excludeFromContext` 跳过
  3. 提示词拼装重构为三分桶（agentMdText / skillIndexText / personaParts），systemPrompt 内容不变（join 顺序逐一核对一致）
  4. buildContext 抛错 → 本次 categories 留空，快照照常落盘；messages 为空时仍写静态四桶
- 改动文件清单：
  - `electron/main/agents/pi-session/usage-extractor.ts`：estimateTokens / contextTotalTokens / ContextCategoryDraft / calibrateCategories（残差并入最大桶，合计恒等 totalTokens）/ estimateMessageBuckets；extractPiContextSnapshot 加第 4 参
  - `electron/main/agents/pi-session/pi-session.ts`：提示词三分桶重构；staticContextComposition（start() 末尾缓存静态四桶：提示词·agent.md/提示词·skill 索引/提示词·人格纪律/工具定义，工具定义按 name+description+JSON(parameters) 序列化估算）；emitContextSnapshot 同步/异步拆分
  - `electron/main/agents/pi-session/pi-harness-adapter.ts`：存 session 引用 + getContextMessages()
  - `electron/main/agents/pi-session/usage-extractor.test.ts`：+6 用例

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `ContextSnapshot.categories: Array<{ name: string; tokens: number }>`，tokens 已校准，**Σ 恒等于 totalTokens**，前端直接渲染无需再算
  - name 规范（按 `·` 前缀分组）：`提示词·agent.md` / `提示词·skill 索引` / `提示词·人格纪律`（合并主行求和）、`工具定义`、`消息·用户` / `消息·助手` / `消息·工具结果`（合并主行求和）；正常数据恒 7 条，未知 name 容错
  - 落盘路径不变：usageContext 事件 → appendUsageContext → JSONL → latestContext
- 下个 step 该从哪里继续：step 3 前端 resolveContext 透传 categories，弹窗构成明细 + 费用行
- 待办或已知限制：
  - 工具定义估算未按 activeToolNames 过滤（近似口径，step 文档允许）
  - 快照含刚生成未进请求的当前 assistant 输出（占比失真 <3%，校准吸收）
  - 旧 CTX 快照 categories 为 [] → 前端判空不渲染构成块
