# Phase 3：旧功能全面适配会话组 设计

## 背景

Phase 1 落地了 groups.json + 共享区 + 组卡片 UI，Phase 2 落地了主子会话委派与子会话实体。但 digest / smart-category / review 三套自动派生机制仍按**会话粒度**（sdkSessionId / conversationId）运作，与组架构不一致——一组内多个会话各自有独立 digest 卡，分类挂在 conversation 上，dashboard 也按 session 聚合。这导致：

1. 同一组讨论被切碎成多张孤立卡，丢失「这组讨论的整体共识/产出」
2. 智能分类按 conversation 粒度太细，「一组 = 一主题」的天然语义没法利用
3. 用户面的「主体单元」在 UI 不同位置不一致——GroupCard 用组，ManualSection/SmartSection/TimeSection 仍用 conversation

Phase 3 把三套机制 + 手动文件夹/智能分类/dashboard 全面升级到组粒度，让**组成为用户面的统一主体**。

## 目标

- digest **由会话级直接升级为组级**：每组一份组卡，agent 处理逻辑与现在一样（读 transcript → 写卡），只是输入扩展为「上次组卡 + 本次变动会话的 transcript + 共享区清单」
- 增量节省：组卡记录 `sourcesSeen[]`（每条 = 一个会话上次被消化时的 mtime），只有 mtime 变化的会话才需要重新 CleanTranscript
- working agent 在阶段完成时可主动写阶段总结到共享区 `_notes/`，组 digest 优先利用
- smart-category 对象从 conversation 改为 group
- review/dashboard 按组聚合
- ConversationList 所有视图统一以组为一级单位
- 手动文件夹装组（不再装 conversation）
- 旧数据自动幂等迁移，0 LLM 浪费，无用户感知中断

## 架构

### 核心：单层组 digest + 增量输入

```
digests/<groupId>.md          ← 唯一的组卡，对外/对内 API 都是它
shared/_notes/<*>.md          ← working agent 自主写的阶段总结（可选输入）
```

**没有 fragment 中间层**——agent 处理逻辑与现在的会话提炼完全一致，只是输入多了：
- 已存在的组卡（上次 agent 写的，作为基础）
- 本次脏的几个会话的 CleanTranscript 输出（变动会话才喂新 transcript）
- 共享区文件清单 + `_notes/` 清单

**组卡 schema**

```ts
GroupDigestCard {
  groupId: string,
  title: string,
  createdAt: string,
  updatedAt: string,
  sourcesSeen: Array<{
    sessionId: string,        // role='main' 会话的 sdkSessionId
    conversationId: string,   // 便于反查
    mtime: number,            // JSONL 上次被消化时的 mtime（脏判定依据）
  }>,
  summary: string,
  items: Array<{
    kind: '决策' | '想法' | '注意' | '搁置',
    text: string,
    sources: Array<{ sessionId: string, uuid: string }>,  // 多源回溯（item 可来自多个会话）
  }>,
  keyOutputs: Array<{
    path: string,             // 共享区相对路径
    oneLine: string,
    sessionId?: string,       // 出处（若来自某子会话 SubmitDelivery）
  }>,
  tags?: DigestTags,          // 供 smart-category 阈值匹配
}
```

**脏判定**：

```
isGroupDirty(groupCard | null, currentMainConversations: Array<{sessionId, mtime}>): boolean
- 无 groupCard → dirty
- currentMainConversations 有 sessionId 不在 sourcesSeen → dirty（新会话加入）
- currentMainConversations 中任一 mtime > sourcesSeen 对应 mtime → dirty（会话有新消息）
- sourcesSeen 中 sessionId 不在 currentMainConversations → dirty（会话被删除/移出组）
```

**触发时只 CleanTranscript dirty 的会话**——没动的会话其信息已在已有组卡里，不重读。

### Working agent 主动写 _notes（补给路径）

- 共享区约定子目录 `shared/_notes/`
- 所有会话的 system prompt 注入引导：感觉「某阶段告一段落 / 上下文用量较大」时，调 `WriteGroupFile` 写阶段总结到 `_notes/<YYYY-MM-DD-HHmm>-<phase>.md`
- 文件 frontmatter 可带 `summary` 一行供 manifest 使用
- 组 digest prompt 明确「**优先利用** `_notes/` 下的用户和 agent 自主总结；CleanTranscript 输出作为补充/校验。若 `_notes/` 已覆盖某段关键内容，items.sources 可直接引用 `_notes/` 文件名 + 对应会话 sessionId，不需重复提炼」
- 非强制——agent 不写 `_notes/` 也行，组 digest 兜底从 transcript 提

### 子会话归并

- digest-scanner 过滤 `role='sub'`——子会话**不出现在 sourcesSeen 里**
- 子会话的「自我总结」由 SubmitDelivery 的 `summary` + `outputPath` 指向的产出物承载，这两样已在共享区/父会话拿得到
- 父会话 transcript 提炼时把 SubmitDelivery 信息和 outputPath 自然包含进去
- 长跑型子会话仍可通过 `WriteGroupFile` 走 `_notes/` 机制
- 失败/取消的子会话：父会话 transcript 提一句即可
- 用户点进子会话观察的能力不受影响

### smart-category 升级

- `SmartCategory.conversationIds[]` → `groupIds[]`
- `SaveCategory` 入参 `conversationId` → `groupId`
- `chainCategorize` 改在「**组卡 saved**」后 fire（每组一次）
- `matchByThreshold` 输入 tags 用**组卡的 tags**
- `ListCategories` 的 `sampleTitles`：从 `groupIds.slice(-3)` 拿 group → `deriveGroupTitle(group, conversations)` fallback 链
- `anchorTags` 不重做——它是「分类语义特征」而非「成员特征」
- `recentDecisions` 环形日志保留（旧 conversationId 字段仅展示用，不再消费）

### review / dashboard 适配

- `dashboard.md` 仍**一工作区一份**
- `review-tools` 入参全部从 sessionId 改 groupId：
  - `ListDigests` 列**组卡**：行格式 `- ${groupId} · ${createdAt} · ${title} · ${sessionCount}会话`
  - `ReadDigest({ groupId })` 读组卡
  - `TraceSource({ sessionId, uuid })` 不变——agent 从组卡 items.sources 里挑 sessionId+uuid 调
- `review-scanner.isReportStale`：用「最新**组卡** createdAt vs report.updatedAt」
- `review-prompt` 调整：「近期做了哪些」按组聚合
- 「记忆 SaveMemory」分流**不强制按组对齐**

### UI：组成为统一主体

**ConversationList 改造**
- 所有 Section 统一以**组**为一级单位
- GroupCard 现有结构沿用：折叠时显示组 header（标题/最后活动时间/⏳N 角标），展开时平铺组内 `role='main'` 会话
- **双层操作并存**：
  - 组卡片 header：组级操作（重命名组 / 删除组 / 添加到文件夹）
  - 展开后 ConversationRow：**保留所有现有操作**（引用 / 重命名 / 删除 / 编辑）
- **视图切换** ViewTabs 改为：手动文件夹 / 智能分类 / 时间。view='group' 不再独立

**手动文件夹升级装 group**
- `conversation-tree-service` 的 `children[folderId]` 装 `groupId`
- IPC 改名+入参换：
  - `addConversationToFolder` → `addGroupToFolder({ workspaceId, groupId, folderId })`
  - `removeConversationFromFolder` → `removeGroupFromFolder(...)`
  - `moveConversationBetweenFolders` → `moveGroupBetweenFolders(...)`
- 文件夹支持组多引用
- ContextMenu：组卡片 header 提供「添加到文件夹 / 移动到文件夹」；conversation 行不再有

**session-store / tabs**
- tabs 仍按 conversationId 索引（**不改**）
- 点击组卡片 header 默认聚焦组内最后活跃的主会话

### 触发节奏总览

```
事件                   →  动作
─────────────────────────────────────────────────
某会话 JSONL 更新       →  groupDigestTrigger.triggerByConversation(convId)
                           → 找 conversation.groupId
                           → isGroupDirty → 提交 GROUP_DIGEST_SESSION 任务
                             agent: ReadGroupDigest + CleanTranscript(dirty) + ListGroupFiles
                             → SaveGroupDigest（带新 sourcesSeen）
                           → onSaved → chainCategorize(groupId)
                                     → review-scanner 下次扫描标 stale

启动延迟 8s            →  triggerScanAll：扫所有 group → dirty 的提交任务

夜间 03:00              →  同上

关会话                 →  triggerByConversation(convId)
```

## 模块边界

### 新增
- `electron/main/services/memory/group-digest-store.ts` — 组卡读写 + schema 校验
- `electron/main/services/memory/group-digest-scanner.ts` — `isGroupDirty / findDirtyGroups / findDirtyConversationsInGroup` 纯函数
- `electron/main/services/memory/group-digest-prompt.ts` — 组 digest prompt 模板 + 加载/保存
- `electron/main/services/memory/group-digest-trigger.ts` — 串行编排（替代旧 digest-trigger）+ 活动采集
- `electron/main/services/memory/migration-p3.ts` — 启动幂等迁移
- `electron/main/agents/tools/group-digest-tools.ts` — MCP 工具：ReadGroupDigest + SaveGroupDigest

### 修改
- `electron/main/agents/agent-worker.ts` — 新增 `handleGroupDigestTask`（旧 handleDigestSessionTask 可删除或改造）
- `electron/main/agents/task-types.ts` — 新增 `GROUP_DIGEST_SESSION`；旧 `DIGEST_SESSION` 可标 deprecated 或直接删
- `electron/main/agents/tools/digest-tools.ts` — `CleanTranscript` 保留并独立成单纯工具（被组 digest 任务用）；旧 `ReadExistingDigest / SaveDigest` 删除（被 ReadGroupDigest / SaveGroupDigest 替代）
- `electron/main/agents/tools/category-tools.ts` — 入参 conversationId → groupId；sampleTitles 取 group title
- `electron/main/agents/tools/review-tools.ts` — `ListDigests / ReadDigest` 入参改 groupId；列/读组卡
- `electron/main/services/memory/digest-store.ts` — **删除**（数据迁移完后整体被 group-digest-store 替代）
- `electron/main/services/memory/digest-scanner.ts` — **删除**
- `electron/main/services/memory/digest-trigger.ts` — **删除**（被 group-digest-trigger 替代）
- `electron/main/services/memory/digest-prompt.ts` — **删除**（被 group-digest-prompt 替代）
- `electron/main/services/memory/smart-category-store.ts` — conversationIds → groupIds + 函数重命名
- `electron/main/services/memory/smart-category-engine.ts` — 字段重命名
- `electron/main/services/memory/category-trigger.ts` — 入参 conversationId → groupId
- `electron/main/services/memory/categorize-prompt.ts` — 模板文案
- `electron/main/services/memory/review-scanner.ts` — 改用组卡 createdAt
- `electron/main/services/memory/review-prompt.ts` — 模板文案
- `electron/main/services/conversation-tree-service.ts` — children 装 groupId
- `electron/main/services/group-shared-service.ts` — 约定 `_notes/` 子目录 + manifest（filename + summary 描述）
- `electron/main/services/group-service.ts` — 删组时联动清理组卡 + smart-category 引用 + 文件夹引用
- `electron/main/agents/query-based-session.ts` — system prompt 加 `_notes/` 引导段落
- `electron/main/tipc/conversations.ts` — folder IPC 改名换 groupId
- `electron/main/tipc/category.ts` — 入参对齐 groupId
- `electron/main/tipc/digest.ts` — RPC 改 group 维度（getReport/list/trigger 全按 group）
- `electron/main/index.ts` — 启动迁移钩子接入
- 类型：`types/smart-category.ts` / `electron/main/types.ts`（镜像）
- UI：`components/ConversationList.tsx` / `components/conversation-list/*` / `components/group-list/GroupCard.tsx`
- Store：`stores/smart-category-store.ts`
- 设置页：`app/settings/memory/SmartCategoryPanel.tsx` + 「会话摘要」Tab

### 不动
- session-store tabs 仍按 conversationId
- conversation-service 数据结构不变（已有 groupId 字段）
- 系统提示词注入框架（Phase 1）
- 共享区物理目录 / 共享区 MCP 工具集（Phase 1，新增 `_notes/` 约定）
- 委派工具集（Phase 2）

## 数据流

### 组 digest 完整链路

```
关会话事件
  → tipc/agent.ts:closeSession → 抓 convId → 延迟 3s
  → groupDigestTrigger.triggerByConversation(convId)
    → 找 conversation.groupId
    → 计算 dirtyConversations[]（mtime > sourcesSeen mtime 的 main 会话）
    → 提交 GROUP_DIGEST_SESSION 任务
       payload: { workspaceId, workspacePath, groupId, dirtyConversations, hasExistingCard }
      agent-worker.handleGroupDigestTask:
        - 按 modelSelection 重建凭证
        - 拼 system prompt：组 digest prompt + 上下文（groupId / 当前 sourcesSeen 列表 / 共享区文件清单 + 描述 / _notes/ 清单）
        - 提供 MCP servers: group-digest（ReadGroupDigest / SaveGroupDigest）+ memory-digest（CleanTranscript）+ group（ReadGroupFile / ListGroupFiles，Phase 1 已有）
        - agent 流程：
          if hasExistingCard: ReadGroupDigest(groupId) 看已有
          foreach dirtyConv: CleanTranscript(sdkSessionId) 看新材料
          ListGroupFiles 看共享区，按需 ReadGroupFile（特别 _notes/）
          整合 → SaveGroupDigest(groupId, title, summary, items, keyOutputs, tags?)
            ↑ 工具自动用 task payload 的 dirtyConversations 更新 sourcesSeen（合并已有 sourcesSeen，覆盖 dirty 的 mtime）
        - AbortController 接 cancelTask
    → onSaved 回调
      → chainCategorize(workspaceId, groupId, groupDigestPath)
      → review-scanner 下次扫描标 stale
```

### 启动迁移

```
app ready
  → migration-p3.run(configDir)
    foreach workspace:
      foreach 旧 `digests/<sessionId>.md`:
        定位对应 conversation：
          - 若 conversation 存在且 role='main' 且 group 内只有它一个 main 会话 且 <groupId>.md 不存在:
              直接重命名/移动为 `digests/<groupId>.md`
              schema 升级：补 groupId / sourcesSeen[1 项含当前 mtime] / items[].sources 包装单源
          - 若 group 内有多 main 会话（罕见）或 <groupId>.md 已存在:
              丢弃（agent 下次自然组 digest 重建——可选 archive 到 _archive/ 保留备查）
          - 若找不到 conversation 或是 sub:
              丢弃（或移到 _archive/）
      smart-categories.json:
        conversationIds[] → groupIds[]（按 conversation.groupId 映射，去重；找不到的剔除）
        字段重命名
      conversation-tree.json:
        children[].conversationId → groupId（按 conversation.groupId 映射，去重）
        migrateRootScatter 清理散落
```

迁移幂等：第二次执行检测到 `<groupId>.md` 已存在 或字段已是新名 → 跳过。

## 错误处理 / 边界情况

- **组 digest 任务失败**：组卡不写入，下次启动扫描仍标 dirty，自然重试
- **agent SaveGroupDigest 输出格式错误**：工具校验失败 → 工具返回 error → agent 重试一次；仍失败则放弃，组卡保持上次状态
- **删除组**：联动删除 `<groupId>.md` + 共享区目录 + smart-categories.json 中的 groupId 引用 + conversation-tree.json 中的 groupId 引用
- **删除单 conversation（非组的最后一个）**：组卡的 sourcesSeen 中移除该 sessionId → 组卡标 dirty → 下次 trigger 时 agent 会看到 sourcesSeen 不匹配从而重整合（去掉被删会话相关内容）
- **删除单 conversation（组的最后一个）**：提示用户「这是组内最后一个会话，删除会一并删除组」
- **某会话 JSONL 被外部删除**：CleanTranscript 失败 → 该 dirty conv 从输入中跳过；agent 仍能基于已有组卡 + 其他 dirty conv 写更新；记日志告警
- **`_notes/` 文件冲突**：WriteGroupFile 按时间戳命名几乎不冲突；冲突时直接覆盖（agent 责任）
- **跨工作区组**：不存在——组属于工作区
- **TraceSource 找不到原 transcript**：sessionId 对应 JSONL 已被清理 → 工具返回「源已不可用」，不臆造

## 未决问题（实施时补）

1. **组 digest 任务的模型选择**：复用 `settings.digestModelSelection` 还是新增 `settings.groupDigestModelSelection`？倾向**复用**（少一个配置项，原 digest 配置语义自然延伸），实施时确认
   > **Phase 3 已解决**：按倾向落地，复用 `settings.digestModelSelection`（DigestsPanel 里仍显示「提炼模型」）。GroupDigestSessionPayload 用统一 `modelSelection?` 字段，三级 fallback：payload.modelSelection ?? settings.digestModelSelection ?? settings.defaultModelSelection。
2. **`_notes/` 引导提示词的具体写法**：在所有会话 system prompt 注入「提示而非命令」的措辞，避免 agent 过度主动写
3. **迁移时多会话组的处理**：旧数据应该几乎都是 1:1 单会话组，但保险起见——多会话组的处理是「丢弃所有旧卡等重建」还是「拼接 items 凑一份临时组卡」？倾向**丢弃 + 标 dirty 让下次自然重建**，实施时确认
   > **Phase 3 已解决**：migration-p3 按 1:1 单会话组直接重命名 `<sessionId>.md → <groupId>.md`；对已经出现的多会话组情况（若存在），只保留其中一份 session 卡（第一个匹配），其余 session 卡进 `_archive/`；组下次会话有变更时自然被 group-digest-scanner 判 dirty → 重跑覆盖。
4. **session-store tabs 是否需要 group 维度**：当前按 conversationId 即可；若未来出现「整组打开」需求再扩展
5. **GroupCard 内 ChildConversationRow 的位置**：当前缩进在父行下；组卡 header 是否要显示「⏳N 子任务运行中」聚合徽章？倾向加，实施时定
6. **review 提示词「按组聚合」的具体模板**：实施时打磨，先给最朴素版「- 组X (createdAt): summary」
7. **smart-category UI 「样例」展示**：sampleTitles 是否换成 sampleGroupTitles 显示？UI 文案变化，实施时定
   > **Phase 3 已解决**：category-tools 的 ListCategories 返回中带 sampleGroupTitles（deriveGroupTitle 从组内主会话推导）；SmartCategoryPanel 头部加了「分类对象：会话组」提示；当前分类列表按 `category.groupIds.length` 计数并展示。
