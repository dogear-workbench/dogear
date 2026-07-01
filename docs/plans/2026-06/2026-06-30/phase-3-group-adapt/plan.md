# Phase 3 实施计划：旧功能全面适配会话组

**设计文档**：[../phase-3-group-adapt-design.md](../phase-3-group-adapt-design.md)

**目标**：digest / smart-category / review / dashboard / 手动文件夹 / ConversationList 全部从「会话粒度」升级到「组粒度」，让组成为用户面的统一主体。

**架构思路**：
- **单层组 digest**：每组一份组卡 `digests/<groupId>.md`，agent 处理逻辑与现在的会话提炼一致（读 transcript → 写卡），只是输入多了「上次组卡 + 共享区清单 + _notes/」
- **增量节省**：组卡记录 `sourcesSeen[]`，只对 mtime 变化的会话调 CleanTranscript；没动的会话其信息已在已有组卡里
- **无中间 fragment 层**：组卡本身就是「上次提炼结果」，下一次拿过来增量更新即可
- 子会话不参与组 digest（靠 SubmitDelivery 信息汇入父会话）
- working agent 可主动写 `_notes/` 阶段总结，组 digest 优先利用
- smart-category 对象从 conversation 改 group；anchorTags 不重做
- review 一份 dashboard.md，仅消费组卡；items.sources 支持多源回溯
- UI 全部以组为一级单位；手动文件夹装 groupId
- 旧数据启动幂等迁移：旧 `<sessionId>.md` 直接重命名为 `<groupId>.md`（单会话组 1:1），0 LLM 浪费

**涉及模块**：
- 服务层：`memory/group-digest-*`（新增） / `memory/migration-p3.ts`（新增） / `memory/smart-category-*` / `memory/review-*` / `conversation-tree-service.ts`
- **删除**：`memory/digest-store.ts` / `memory/digest-scanner.ts` / `memory/digest-trigger.ts` / `memory/digest-prompt.ts`（被 group-digest-* 替代）
- Agent：`agents/agent-worker.ts` / `agents/task-types.ts` / `agents/tools/{group-digest,digest,category,review}-tools.ts`
- IPC：`tipc/conversations.ts` / `tipc/category.ts` / `tipc/digest.ts`
- 类型：`types/smart-category.ts` / `electron/main/types.ts`
- UI：`components/ConversationList.tsx` / `components/conversation-list/*` / `components/group-list/*` / `app/settings/memory/*`
- Store：`stores/smart-category-store.ts`
- 启动：`electron/main/index.ts`

## 步骤索引

- [x] [Step 1: 数据层 + 启动幂等迁移](./step1-data-and-migration.md) — 新增 group-digest-store/scanner/prompt；migration-p3 直接重命名旧卡为组卡
- [x] [Step 2: 触发链 + Agent 任务 + MCP 工具改造](./step2-trigger-and-tools.md) — 替换 digest-trigger 为 group-digest-trigger；新 GROUP_DIGEST_SESSION 任务；MCP 工具入参全改 groupId
- [x] [Step 3: ConversationList 全面以组为主体](./step3-ui-rework.md) — Smart/Time/Manual 三 section 统一组渲染；手动文件夹装 groupId；操作上移
- [x] [Step 4: 设置页接入 + 收尾 + 文档同步](./step4-settings-and-polish.md) — 组 digest prompt 编辑入口、doc-sync、端到端手测

## 全局决策

**命名约定**
- 「组 digest」/「组卡」= 每组一份的 digest 卡，文件 `<configDir>/workspaces/<wsId>/digests/<groupId>.md`
- **不存在「fragment」概念**——旧 session 卡迁完即删（或 archive）
- 新提示词文件 `<configDir>/group-digest-prompt.md`（替代旧 `digest-prompt.md`，旧文件迁移时保留）

**组卡 schema**
```ts
GroupDigestCard {
  groupId, title, createdAt, updatedAt,
  sourcesSeen: Array<{ sessionId, conversationId, mtime }>,  // 脏判定 + 反查
  summary,
  items: Array<{ kind, text, sources: Array<{sessionId, uuid}> }>,
  keyOutputs: Array<{ path, oneLine, sessionId? }>,
  tags?: DigestTags,
}
```

**脏判定规则**（写在 group-digest-scanner.ts）
- 无组卡 → dirty
- 当前 main 会话 sessionId 不在 sourcesSeen → dirty（新会话加入）
- 当前 main 会话 mtime > sourcesSeen 中记录的 mtime → dirty（会话有新消息）
- sourcesSeen 中 sessionId 不在当前 main 会话集合 → dirty（会话被删除/移出组）

**任务类型**
- 新增 `GROUP_DIGEST_SESSION`，payload `{ workspaceId, workspacePath, groupId, dirtyConversations: Array<{conversationId, sessionId, mtime}>, hasExistingCard, modelSelection? }`
- 旧 `DIGEST_SESSION` 整体删除（或保留类型常量但不再被引用）

**模型选择**
- 组 digest 复用 `settings.digestModelSelection`（不新增配置项；旧 digest 配置语义自然延伸到组）

**子会话过滤**
- group-digest-scanner 只看 `role !== 'sub'` 的 conversation

**迁移幂等**
- 所有迁移函数二次执行时检测既有产物存在即跳过
- 启动时机：`app.whenReady()` 后、其他业务初始化前

**Step 间不打破**
- Step 1：旧 listDigests / dashboard 数据仍能读（migration 已经把旧 session 卡 1:1 改名成组卡，schema 也已升级）；旧触发器先停摆但不删（Step 2 才删）
- Step 2 完成：新触发链全通，dashboard/category 切换到组粒度；旧文件正式删除
- Step 3 完成：UI 统一
- Step 4 完成：用户能从设置编辑组 digest prompt

---

## 完成总结

Phase 3 落地 Digest / Category / Review / Dashboard / 手动文件夹 / ConversationList 从「会话」升级到「组」的全链路，功能已开发完成。端到端手测清单待用户跑一遍。

### 主要改动文件（Step 4 部分）

- `app/settings/memory/SmartCategoryPanel.tsx` — 文案微调「分类对象：会话组」；activity 显示 groupId；空态提示改「组卡」；重跑确认文案改「按组」
- `types/smart-category.ts` + `electron/main/types.ts` — 移除 `CategorizeDecisionLog.conversationId` / `CategorizeRecentEntry.conversationId` / `CategorizeActivity.current.conversationId` 三处旧字段
- `electron/main/services/memory/smart-category-store.ts` — 移除 readIndex 的 conversationIds → groupIds 兼容代码（migration-p3 保证）
- `electron/main/services/memory/smart-category-store.test.ts` — 用例改用 pushGroup / removeGroupEverywhere / groupId
- `electron/main/tipc/category.ts` — `triggerCategorize` IPC 入参 `conversationId/digestPath` → `groupId/groupDigestPath`
- `components/group-list/GroupList.tsx` — 已不被引用，删除
- `.claude/rules/codebase-map.md` — memory / tools / IPC / 数据存储 / 数据流 / stores / components 各段大幅重写
- `docs/plans/2026-06/2026-06-30/phase-3-group-adapt-design.md` — 未决问题 1/3/7 标注「Phase 3 已解决」

### 与原设计的偏差

- 未决问题 2（`_notes/` 引导措辞）、4（session-store group 维度）、5（GroupCard 子任务运行中徽章）、6（review 提示词按组聚合模板打磨）未在 Phase 3 处理——按 Step 4 计划这些属于「可推迟到看到实际使用问题再做」
- Step 3 GroupCard 未加双击「聚焦组内最近活跃会话」——保留单击展开/选中即可，避免手势冲突
- Step 3 conversation-store 未新增 groupsById 索引——现有 filter 已够快

### 端到端手测清单（待用户跑）

见 step4-settings-and-polish.md「端到端手测清单」章节共 10 条。核心：新建组 + 发消息 + 关会话 → 组卡产生 → category 跑 → dashboard 标 stale；组内加会话增量提炼；子会话 SubmitDelivery 汇入组卡 keyOutputs；启动迁移幂等（重启不重做已迁移）。

### 未做的事

- 端到端手测由用户执行
- Phase 3 设计的「working agent 主动写 `_notes/`」相关的 system prompt 引导词未落地（未决问题 2）——待用户见实际使用问题时补
