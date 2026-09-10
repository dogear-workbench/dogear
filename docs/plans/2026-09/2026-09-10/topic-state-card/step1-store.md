---
step: 1
title: 状态卡数据模型与存储层
status: done
---

## 目标
background-store.ts 重构为条目化状态卡的完整存储层：schema 定义、旧格式迁移、代码合并函数（append/去重/条目迁移/topic 版本链/sourcesSeen），供后续抽取任务、注入、按钮共用。

## 依赖上下文（接力棒输入）
- 无前置 step。
- 现状：`electron/main/services/memory/background-store.ts` — YAML frontmatter `{groupId, updatedAt, topic, progress, keyDecisionsJson, openQuestionsJson}` + 中文正文四节；`saveGroupBackground`（:84）整文件覆盖写，`broadcastGroupDataChanged` 在写后调用。
- 参考：`group-digest-store.ts:21-53` 的 GroupDigestCard frontmatter 模式与 `mergeSourcesSeen`（:279）——sourcesSeen 的既有实现样例。

## 计划改动
- [x] 定义状态卡 schema（frontmatter + 正文结构）：
  - frontmatter：`{groupId, updatedAt, sourcesSeenJson, pendingTopicChangesJson}`
  - 正文 topic 版本链：`## 话题背景` 下逐条 `{text, source, ts}`，末位生效
  - 条目区六类：`## 当前状态` 下 `### 已完成/进行中/已拍板/阻碍/下一步/待议`，每条 `- text ⟵ source (ts)`（渲染格式对齐组卡 items 的写法，便于人工 diff）
- [x] 条目 TypeScript 类型 + 解析/序列化函数（读写纯代码）
- [x] 合并函数（核心）：`mergeIncrement(card, increment)` — 按 zod 增量结构逐类 append；处理条目迁移（增量声明"X 完成"时把对应 inProgress 条目移到 completed）；同来源同 text 去重
- [x] topic 变更合并：source 含用户原话判据 → 直接追加版本链；否则进 pendingTopicChanges
- [x] 旧格式迁移：read 时检测无 sourcesSeenJson → 把 progress/keyDecisions/openQuestions 转 legacy 条目，topic 进版本链首条
- [x] 追加 API：`appendUserEntry(groupId, category, text)`（Step 5 按钮用）、`getStaleConversations(groupId)`（对比 sourcesSeen vs conversations.json + 会话 JSONL mtime/大小，复用 `group-digest-scanner.ts:33 isGroupDirty` 的模式）
- [x] 所有写路径保留 `broadcastGroupDataChanged` 调用
- [x] `bun run build:electron` + `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 拆成两个文件：纯数据层 `state-card.ts`（类型/schema/解析/合并）+ IO 层 `background-store.ts`（读写/广播/staleness/兼容出口），单文件会超 400 行
  - `mergeIncrementAndSave(wsId, groupId, increment, opts)` 组合了「读卡→mergeSourcesSeen→mergeIncrement→落盘→广播」，Step 2 handler 一次调用完成写路径
  - `resolvePendingTopicChange(wsId, groupId, index, accept)` 备好，Step 4 confirmTopicChange 直接调
  - 兼容出口形态：`GroupBackground` 类型 + `readGroupBackground`（新卡→旧视图）+ `saveGroupBackground`（旧 4 字段入参→内部合并进新卡）都保留原签名，三个消费者（reference-tools / tipc/group / group-digest-tools）零改动编译通过
  - staleness 判定用 mtime（复用 `GroupDigestSourceSeen` + `mergeSourcesSeen`），未存 size——JSONL append-only mtime 单调，计划里的「大小」维度省去以换取类型与合并函数直接复用
  - 条目 id 不落盘：`sha1(JSON.stringify([text, source, ts])).slice(0,12)`，解析时重算，跨轮次稳定
- 改动文件清单：
  - `electron/main/services/memory/state-card.ts`（新增）
  - `electron/main/services/memory/background-store.ts`（重写）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 增量 schema：`StateIncrementSchema` = `{topicChange?{text,quote?,uuid?}, completed[], inProgress[], decisions[], blockers[], nextSteps[], openQuestions[]}`（各为 `{text,uuid}[]`）+ `resolved: string[]`（被完成条目的 id，对应 step2 的 emit_state_increment）
  - topicChange 分流：`quote` 非空（用户原话证据）→ 直接生效版本链；为空 → `pendingTopicChanges` 待确认
  - `getStaleConversations(wsId, groupId): {conversationId, sessionId, mtime}[]`——注意第一参数是 wsId（与计划签名 `getStaleConversations(groupId)` 的差异）
  - 上次提炼位置：条目渲染格式 `- text ⟵ source (ts)` 不含读取偏移；「上次位置」靠 sourcesSeen 的 mtime + readSessionBranchEntries 自行推算（step2 输入组装用）
  - step5 按钮：`appendUserEntry(wsId, groupId, category, text)`，空文本 throw
- 下个 step 该从哪里继续：step2 在 handler 里对每个 dirty 会话组装 prompt（新增 entry + 该会话旧条目，含 id 供 resolved 引用），runOnce 输出经 `StateIncrementSchema.parse` → `mergeIncrementAndSave`
- 待办或已知限制：
  - `dogear__SaveGroupBackground`（group-digest-tools）仍写旧 4 字段，经兼容实现合并进新卡，条目标 legacy 无 uuid；step4 适配后应移除该工具
  - fm JSON 读取沿袭 `raw.replace(/\\"/g, '"')` 的粗糙 unescape（与组卡一致），条目 text 含 `\\"` 序列的极端场景可能解析异常
  - `withConversationTransaction` 约束本 step 不适用（状态卡写路径不碰 conversations.json）
