---
step: 3
title: 开启会话触发与注入
status: done
---

## 目标
新会话开启时判 staleness：轻度滞后同步抽取（封顶 ~10s）注入新鲜状态；重度滞后标注后异步抽；新鲜直接注入。systemPrompt 注入模板落地。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-extract.md] STATE_EXTRACT 任务可通过 submitTask 同步等待（需确认 task 完成信号可 await，参考 `whenGroupDigestIdle()` 的等待模式 `group-digest-trigger.ts`）
- 现状：`pi-session.ts:335 start()` 同步 await 链；`:393-397 needGroupContext → buildGroupContextPrompt()`（`group-context-builder.ts:14-38`，现只拼组标题+共享区说明）；会话创建唯一入口 `conversation-runtime-service.ts:66 attachConversation`
- 注入是 systemPrompt 拼装，会话开启后不变——本轮注入质量即全部（设计决策：无轮次同步、无 steer 补达）

## 计划改动
- [x] `group-context-builder.ts` 重写 `buildGroupContextPrompt`：
  - 读状态卡（topic 生效版 + 六类条目，带来源与 ts）
  - 从 conversations.json 派生"最近未提炼会话"标题列表（纯代码零模型）
  - 模板（对齐设计文档）：【话题背景】（确立时间+来源）→【当前状态】（提炼至 X · 落后 N）→【最近未提炼会话】→【指引】（拿最新调 ReadGroupBackground、深挖用 ReadReferenceSession、关键决策先与用户确认）
  - 条目裁剪：每类最多 8 条（按 ts 取最近），总长度超限时先砍 completed
  - 状态卡为空 → 只注入"未初始化 + 标题列表"，不造背景
- [x] 触发编排（新文件或并入 group-context-builder 同层 service）：
  - `getStaleConversations` 判定：0 个 → 直接注入；≤2 个 → submitTask(STATE_EXTRACT) 同步等待，Promise.race 封顶 10s，超时/失败降级；>2 个 → 注入旧状态 + 严重滞后标注 + 后台 fire-and-forget 抽取
  - 挂点在 start() 的 needGroupContext 分支（await 链上，pi-session.ts:393 附近）
  - 抽取去重：in-flight 按组去重（参考 group-digest-trigger 的 key 模式），避免并发触发重复抽
- [x] 验证：开新会话抓 systemPrompt 日志确认注入内容；制造轻度/重度滞后两种场景验证降级路径；确认会话开启延迟可接受
- [x] `bun run build:electron` + lint

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 触发编排拆为独立新文件 `electron/main/services/memory/state-extract-trigger.ts`（而非并入 group-context-builder）：与 group-digest-trigger.ts 同层同模式（submitTask 编排 + in-flight 按组去重 + 动态 import agent-manager 避环），且 builder 保持纯拼装可单测；
  2. 触发仅主会话（`!isSubAgent`）：子会话派遣链路不等抽取（最多 10s），注入侧 staleness 标注自会兕底；
  3. 注入侧独立重查 staleness（编排与拼装解耦，不传参）：同步抽取完成后 stale 自然归零；超时/异步/失败时 stale>0 自动带滞后标注，无需 outcome 传递；
  4. 提交等待内置 120s 终态兑底（unref timer）：防 agent-manager 丢回调导致 in-flight 条目永久泄漏；
  5. 损坏卡（parse 为 null）等同无卡走未初始化分支（鲁棒性验证覆盖）。
- 改动文件清单：
  - `electron/main/services/memory/state-extract-trigger.ts` 新增（触发编排，~160 行）
  - `electron/main/agents/group-context-builder.ts` 重写（状态卡注入段 + 裁剪 + 标题列表派生，~250 行）
  - `electron/main/agents/pi-session/pi-session.ts` needGroupContext 分支加触发（2 行 + import）

### 给下一步的接力棒
- 关键签名：
  - `triggerStateExtractForSessionStart(wsId, groupId): Promise<{outcome: 'fresh'|'synced'|'sync-failed'|'sync-timeout'|'async'|'async-inflight', staleCount}>`（永不抛错）
  - `buildGroupContextPrompt(wsId, groupId): Promise<string>`（失败返回空串；状态段内部再兜一层 try/catch 只丢状态段）
  - 裁剪常量在 group-context-builder.ts 顶部：每类 ≤8 / 状态段 ≤2400 字 / 未提炼列表 ≤5 行
- 下个 step 该从哪里继续：Step 4 TopicPanel/confirm 入口用 `readTopicStateCard` + `resolvePendingTopicChange`；Step 5 按钮用 `appendUserEntry`；两者改完后移除 readGroupBackground/saveGroupBackground 兼容出口（见 step1 交付）
- 待办或已知限制：
  - 轻度阈值 LIGHT_STALE_MAX=2 与 SYNC_WAIT_MS=10s 写死在 state-extract-trigger.ts，无设置项
  - 无卡首次触发若 main 会话 >2 会走异步（不阻塞开局），下次开启才注入新鲜卡——预期行为
  - 「确立于」用版本链首条 ts，来源显示末条（生效版）来源

### 验证记录
- `bun run build:electron` 0 error；`bun run lint` 0 error / 102 warning（全为存量，本次 3 文件 0 warning）
- 临时 bun 脚本（bun.plugin 拦截 electron named import + monkey-patch AgentManager.submitTask，对真实工作区 db291a2d 数据，background.md 备份/还原）38 项断言全过：
  - 无卡：全量 stale 同步抽取 + 未初始化注入（含真实标题列表、不造背景）
  - 新鲜：fresh 零任务提交；模板含确立时间/用户确认/来源短标/提炼至，无滞后部分
  - 轻度：payload 恰含 1 个滞后会话；hang mock 下 10s 超时（实测 10012ms）降级旧卡+滞后标注；并发双触发复用 in-flight 不重复提交；降级注入保留【话题背景】
  - 重度（8 main 组）：async 立即返回（<2s）+ ⚠ 重度滞后标注 + 另有 8 个未提炼 + 列表 5 行+合并行；二次触发 async-inflight 去重
  - 裁剪：每类 12 条取最近 8；超预算先砍 completed（留计数行）；其余五类 ≤8；状态段实测 2470 字符在预算内
  - 损坏卡（非法 frontmatter）：解析为 null → 未初始化分支优雅降级
- 真实注入文案已人工审核（fresh / 损坏卡 / 无卡三形态）
