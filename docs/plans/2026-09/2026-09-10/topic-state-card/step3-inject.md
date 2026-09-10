---
step: 3
title: 开启会话触发与注入
status: pending
---

## 目标
新会话开启时判 staleness：轻度滞后同步抽取（封顶 ~10s）注入新鲜状态；重度滞后标注后异步抽；新鲜直接注入。systemPrompt 注入模板落地。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-extract.md] STATE_EXTRACT 任务可通过 submitTask 同步等待（需确认 task 完成信号可 await，参考 `whenGroupDigestIdle()` 的等待模式 `group-digest-trigger.ts`）
- 现状：`pi-session.ts:335 start()` 同步 await 链；`:393-397 needGroupContext → buildGroupContextPrompt()`（`group-context-builder.ts:14-38`，现只拼组标题+共享区说明）；会话创建唯一入口 `conversation-runtime-service.ts:66 attachConversation`
- 注入是 systemPrompt 拼装，会话开启后不变——本轮注入质量即全部（设计决策：无轮次同步、无 steer 补达）

## 计划改动
- [ ] `group-context-builder.ts` 重写 `buildGroupContextPrompt`：
  - 读状态卡（topic 生效版 + 六类条目，带来源与 ts）
  - 从 conversations.json 派生"最近未提炼会话"标题列表（纯代码零模型）
  - 模板（对齐设计文档）：【话题背景】（确立时间+来源）→【当前状态】（提炼至 X · 落后 N）→【最近未提炼会话】→【指引】（拿最新调 ReadGroupBackground、深挖用 ReadReferenceSession、关键决策先与用户确认）
  - 条目裁剪：每类最多 8 条（按 ts 取最近），总长度超限时先砍 completed
  - 状态卡为空 → 只注入"未初始化 + 标题列表"，不造背景
- [ ] 触发编排（新文件或并入 group-context-builder 同层 service）：
  - `getStaleConversations` 判定：0 个 → 直接注入；≤2 个 → submitTask(STATE_EXTRACT) 同步等待，Promise.race 封顶 10s，超时/失败降级；>2 个 → 注入旧状态 + 严重滞后标注 + 后台 fire-and-forget 抽取
  - 挂点在 start() 的 needGroupContext 分支（await 链上，pi-session.ts:393 附近）
  - 抽取去重：in-flight 按组去重（参考 group-digest-trigger 的 key 模式），避免并发触发重复抽
- [ ] 验证：开新会话抓 systemPrompt 日志确认注入内容；制造轻度/重度滞后两种场景验证降级路径；确认会话开启延迟可接受
- [ ] `bun run build:electron` + lint

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
