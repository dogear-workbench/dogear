---
step: 4
title: 设置页接入 + 收尾 + 文档同步
status: done
---

## 目标

把组 digest 的 prompt 编辑入口替换到设置页（取代旧的会话级 digest-prompt 编辑器），分类样例文案微调，codebase-map.md 同步，端到端手测。

## 依赖上下文（接力棒输入）

- Step 1-3 已完成；后端 + UI 已全面组化
- 设置页位置：`app/settings/memory/SmartCategoryPanel.tsx`（智能分类面板）；提示词编辑分散在「会话摘要」Tab
- 现状关键事实：
  - 设置页「会话摘要」Tab 含 digest-prompt / review-prompt / categorize-prompt 各自编辑器
  - 组 digest prompt 文件 `<configDir>/group-digest-prompt.md`（Step 1 落地）
  - 旧 `<configDir>/digest-prompt.md` 可保留也可在迁移时删——倾向保留 archive，不主动删

## 计划改动

### 设置页

- [ ] 「会话摘要」Tab 内 digest-prompt 编辑器**替换**为 group-digest-prompt 编辑器
  - tipc 用 Step 2 已落地的 `getGroupDigestPrompt / setGroupDigestPrompt`
  - 旧 digest-prompt 编辑器删除
  - 文案：「组级 digest 提示词（每组一份摘要卡的生成提示）」

- [ ] 触发按钮文案与对接
  - 「立即重跑全部摘要」按钮：调 `triggerGroupDigestScan`（Step 2 落地）
  - 活动状态条接 `getGroupDigestActivity` 轮询

- [ ] `app/settings/memory/SmartCategoryPanel.tsx`
  - 文案微调：「分类对象：组（一个组 = 一个主题）」
  - sampleTitles 显示位置（如果有）改为「样例组」
  - 「立即重跑全部分类」描述里强调改为按组

- [ ] `categorize-prompt.md` / `review-prompt.md` 默认模板（在 Step 2 已改过）
  - 这里再 review 一遍设置页里展示的默认值是否一致

### 类型 & store 收尾

- [ ] 清理 Step 1-2 留的「兼容字段」/ as any 桥接
- [ ] `electron/main/types.ts` 镜像类型与 `types/` 同步

### Doc-sync

- [ ] 跑 doc-sync skill：
  - 更新 `.claude/rules/codebase-map.md`：
    - memory/ 新文件（group-digest-store / group-digest-scanner / group-digest-prompt / migration-p3 / group-digest-trigger）
    - 移除 memory/ 旧文件描述（digest-store / digest-scanner / digest-trigger / digest-prompt）
    - tools/group-digest-tools；transcript-tools（如 digest-tools 重命名）
    - task-types 新增 GROUP_DIGEST_SESSION；移除 DIGEST_SESSION 描述
    - 数据存储新增 `<configDir>/group-digest-prompt.md` 和 `digests/<groupId>.md`、`shared/_notes/` 目录
    - 移除 `_fragments/` / synthesis / 双层模型描述
    - 数据流：会话提炼链路改为「组 digest 单层链路」
  - 更新 `.claude/CLAUDE.md`（如有相关章节）

### 端到端手测清单

- [ ] 新建组 + 发几条消息 + 关会话 → 几秒后组卡 `<groupId>.md` 产生 → category 跑了 → dashboard 标 stale
- [ ] 在该组里再开一个会话 → 发消息 → 关会话 → 组卡 sourcesSeen 增长，summary/items 体现新会话内容 + 保留上次内容
- [ ] 在该组内某会话续聊 → 关会话 → 组卡更新（验证 mtime 增量识别正常）
- [ ] 派子会话（DelegateTo）→ SubmitDelivery 落 shared/ → 关父会话 → 组卡 keyOutputs 含子会话产出；子会话不出现在 sourcesSeen
- [ ] working agent 主动 WriteGroupFile 到 `_notes/` → 下次组 digest 提及该 note
- [ ] 设置页编辑 group-digest-prompt 保存 → 下次组 digest 应用新模板
- [ ] 把组拖到手动文件夹 / 移动到另一文件夹
- [ ] 组级删除：删除组 → 一并删除组内 conv / 共享区 / 组卡 / smart-category 引用 / 文件夹引用
- [ ] 删除单 conversation（非组的最后一个）→ 下次组 digest 触发时 sourcesSeen 去掉该 sessionId，items 中相关内容自然消失
- [ ] 启动迁移幂等：删 `<configDir>/<wsId>/digests/<groupId>.md`，重启 → 因 `_archive/` 已有旧 session 卡，**不再**自动重建（说明迁移幂等且不会重做）；想重建需手动触发
- [ ] dashboard 刷新：按组聚合呈现「近期做了哪些」

### 验证

- `bun run build` + `bun run lint` 全部通过
- 上述端到端清单全跑一遍并记录

## 完成后

- 在 `plan.md` 末尾增加「## 完成总结」：列改动文件清单、与原设计的偏差、未做的事
- 设计文档 §未决问题 1（触发时机）、§未决问题 2（手动文件夹）标注「Phase 3 已解决」

## 实施回填

### 实际改动

- **与计划差异**：
  - DigestsPanel 的组 digest prompt 编辑器 Step 2 就替换好了，Step 4 只做了确认（读到 `getGroupDigestPrompt / setGroupDigestPrompt`），未再改
  - SmartCategoryPanel 文案微调按计划做；额外把顶端加了一行「分类对象：会话组（一个组 = 一个主题）」提示，让入口点直观
  - 类型收尾：清理了 `CategorizeDecisionLog.conversationId` 等三处旧字段（types/smart-category.ts + electron/main/types.ts 同步），smart-category-store readIndex 的 conversationIds → groupIds 兼容代码删除（migration-p3 已保证）
  - tipc/category.ts `triggerCategorize` 入参改名为 `groupId / groupDigestPath`（此 IPC 目前无前端调用者，纯内部对齐）
  - 未引用的 `components/group-list/GroupList.tsx` 删除
  - codebase-map.md 大幅重写：memory / tools（新增 group-digest-tools、group-tools、delegation-tools；digest-tools 描述改为只剩 CleanTranscript）/ IPC（digest.ts 全套 group 路由）/ 数据存储（`<groupId>.md` / `_archive/` / `group-digest-prompt.md` / `groups/{groupId}/shared/`）/ 数据流（三段全新链路）/ stores（group-store 新增，conversation-store 说明加了 loadConversations 并行 + folder actions 改名）/ components（conversation-list Phase 3 组渲染 + group-list 新增 GroupCard）
  - 设计文档 §未决问题 1/3/7 已标注「Phase 3 已解决」

- **改动文件清单**：
  - `app/settings/memory/SmartCategoryPanel.tsx`
  - `types/smart-category.ts`
  - `electron/main/types.ts`
  - `electron/main/services/memory/smart-category-store.ts`
  - `electron/main/services/memory/smart-category-store.test.ts`
  - `electron/main/tipc/category.ts`
  - `components/group-list/GroupList.tsx`（删除）
  - `.claude/rules/codebase-map.md`
  - `docs/plans/2026-06/2026-06-30/phase-3-group-adapt-design.md`
  - `docs/plans/2026-06/2026-06-30/phase-3-group-adapt/plan.md`（加 完成总结）
  - `docs/plans/2026-06/2026-06-30/phase-3-group-adapt/step4-settings-and-polish.md`（本文件）

- **构建/lint**：`bun run build:electron` + `bun run lint` 全通（0 error，83 warnings 都是历史 `no-explicit-any`）

### 给下一步的接力棒

Phase 3 落地完成，无 Step 5。后续可能触发点：
- 端到端手测清单 10 项（本文件上方）待用户跑，若有回归/体验问题按项修
- 未决问题 2/4/5/6 保留：`_notes/` 引导措辞、session-store group 维度、GroupCard 子任务运行中徽章、review 提示词按组聚合模板打磨——等实际使用中暴露需求再做
- SmartCategoryPanel 头新增的「分类对象」提示行如果视觉太挤，改成 tooltip 亦可
