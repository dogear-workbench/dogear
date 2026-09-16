---
step: 1
title: 后端 digest 服务与 IPC
status: done
---

## 目标
归档动作时预计算话题 digest 落盘，`getArchivedTopicDigest` IPC 可读取，缺失时懒构建回写。

## 依赖上下文（接力棒输入）
- 无前置 step。设计依据：`docs/plans/2026-09/2026-09-16/archive-tab-design.md`「数据流」与「提取规则」。
- 当前关键文件状态：
  - `electron/main/tipc/group.ts` 的 `archiveTopic`（约 L71）：先关运行时再 `groupService.archiveGroup`，digest 预计算挂在 archiveGroup 成功之后。
  - `electron/main/services/auto-archive-service.ts`：自动归档直接调 `groupService.archiveGroup`——预计算应放在 group-service 归档路径内（或由两处共同调用的下层函数），保证手动/自动都触发。
  - `buildSessionHistory(workspaceId, sessionId)` 在 `electron/main/agents/pi-session/history-adapter.ts`，返回前端格式 Message[]（含 contentBlocks、isMeta、isCompactSummary 等）。
  - 会话索引：`conversation-service.getByWorkspaceId(wsId, { includeArchived: true })`；主/子判定看 `contractMetadata.createdBy === 'agent'` + `parentSessionId` 是否在同组（参考前端 `lib/conversation-sort.ts` 的 buildConversationTree 语义，后端实现等价判定）。
  - 组目录：`groups/<groupId>/`（group-shared-service 在用），digest.json 放这里。
- 关键决策回顾：子会话不进 digest（不构建其 turns）；主会话无 sessionId（从未发消息）→ turns 为空数组仍保留该 session 条目；结论拼接取「最后一个含非空 text 块的 assistant 消息」的全部 text 块。

## 计划改动
- [ ] 新建 `electron/main/services/topic-digest-service.ts`：
  - 注入消息判定（等价前端 isSdkInjectedUserMessage / isInjectedUserMessage / isHeader，tag 集合见 plan.md 全局决策）
  - `buildTopicDigest(wsId, groupId)`：取组内会话 → 判主会话（created_at 升序）→ 逐个 buildSessionHistory → 提取 turns → 组装 digest 结构
  - `writeTopicDigest`（落盘 groups/<groupId>/digest.json）
  - `readOrBuildTopicDigest(wsId, groupId)`：读文件，缺失/损坏则构建并回写
- [ ] `group-service.ts` 的 archiveGroup 成功路径（或其调用的共同下层）接入 digest 预计算；失败只 log 警告不阻塞归档（懒构建兜底）
- [ ] `electron/main/tipc/group.ts` 新增 `getArchivedTopicDigest(workspaceId, groupId)` → readOrBuildTopicDigest
- [ ] 确认 `topicLifecycleService.deleteTopic` 的组目录清理会带走 digest.json（读代码确认即可，理论上无需改动）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - input 在后端剥离注入块（referenced_* / quoted_snippet / sender / command / local-command-stdout / 跨工作区提示行）——Step 3 直接 MarkdownRenderer 渲染不显示 XML 原文，设计语义即「真人原话」
  - 空文本纯图片 user 消息不算轮头（「图片不进 digest」推论）
  - 计划描述 HistoryMessage「含 isMeta / isCompactSummary」不准确：两者是前端本地乐观态标记不落盘；isCompactBoundary 仅在 compaction 映射 assistant 消息上
- 改动文件清单：
  - 新建 `electron/main/services/topic-digest-service.ts`（~180 行）：isInjectedUserContent / stripInjectedBlocks / extractTurns / pickMainConversations / buildTopicDigest / writeTopicDigest / readOrBuildTopicDigest / precacheTopicDigest
  - `electron/main/services/group-service.ts:137`：archiveGroup 成功分支动态 import 接入 precacheTopicDigest（手动/自动归档共用路径；失败仅告警）
  - `electron/main/tipc/group.ts:121`：新增 getArchivedTopicDigest({ workspaceId, groupId }) → { digest, error }
  - deleteTopic → cleanupEmptyTopic → fs.rm 组目录，digest.json 天然带走，无需改动（只读确认）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `client.getArchivedTopicDigest({ workspaceId, groupId })` → `{ digest: TopicDigest | null, error?: string }`
  - `TopicDigest { version: 1; archivedAt: number; sessions: DigestSession[] }`；`DigestSession { conversationId; title; turns }`；`DigestTurn { input; inputAt; conclusion: string | null; concludedAt: number | null }`
  - input 已剥离注入块（真人原话）；conclusion=null 的轮显示灰字「（无文字回复）」；turns=[] 的主会话显示「（无对话内容）」
  - 主/子判定：contractMetadata.createdBy==='agent' 且 parentSessionId 在同组 sessionId 集合 → 子会话不进 digest
- 下个 step 该从哪里继续：Step 2 前端哨兵 tab + 左列表；主进程已编译，开发环境直接生效
- 待办或已知限制：注入 tag / 引用块格式变更时 topic-digest-service.ts 正则需与前端 utils.ts / useSendMessage.ts 同步（文件头注释已标注）；归档瞬间懒构建与预计算可能并发构建一次（safeJsonWrite 文件锁不互踩）
