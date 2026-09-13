---
step: 2
title: 主进程构成估算
status: pending
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
- [ ] `usage-extractor.ts` 加 `estimateTokens(text: string): number`（CJK ×1 + 其他 ×0.25）
- [ ] `extractPiContextSnapshot` 加可选参数 `composition?: Array<{ name: string; tokens: number }>`（未校准原值），函数内 Σtokens 按快照 totalTokens 等比缩放后写 `categories`；Σ=0 时留空数组
- [ ] `pi-session.ts` start() 末尾算一次并缓存到实例：提示词三段（agent.md = project+user 合计；skill 索引；人格纪律 = 其余 parts 合计）、工具定义（tools 序列化 JSON.stringify 估算；AgentHarnessTool 取其 schema/name/description 字段序列化，与发送口径近似即可）
- [ ] `pi-session.ts:854` 快照点：调 `this.adapter` 暴露的 session（或经 adapter 新增小方法）`buildContext()` 取 messages，按 user / assistant（含 thinking/tool_use 文本）/ tool_result 分桶估算，组装 composition 传入
- [ ] `usage-extractor.test.ts` 补用例：校准缩放正确、空 composition 留空、Σ=0 不除零

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
