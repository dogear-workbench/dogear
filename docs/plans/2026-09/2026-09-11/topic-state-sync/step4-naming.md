---
step: 4
title: 话题命名联动
status: pending
---

## 目标
话题命名从 SaveGroupDigest 迁入状态卡链路：首次命名（title 空）抽取直接生效；后续改名走 topicChange 确认并联动 updateGroup(title)。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-schema-prompt.md] increment 有 initialTitle 可选字段，提示词已引导产出
- 当前关键文件状态：`electron/main/services/memory/background-store.ts` — confirmTopicChange 现只更新卡内 topicHistory/pendingTopicChanges；`electron/main/services/group-service.ts:112` updateGroup(workspaceId, groupId, { title })；旧联动在 `electron/main/agents/tools/group-digest-tools.ts:139`（Step 5 将删）
- 关键决策回顾：initialTitle 仅 group.title 为空/未定义时生效一次（同 autoUpdateTitleFromFirstMessage「仅默认时执行」逻辑）；会话标题永不联动；topicChange 需用户原话带 quote + 用户确认

## 计划改动
- [ ] 抽取合并路径（agent-worker STATE_EXTRACT handler 或 background-store mergeIncrementAndSave 调用侧）：increment.initialTitle 存在且 group.title 为空 → updateGroup(title) 生效
- [ ] `background-store.ts` confirmTopicChange：确认生效后联动 updateGroup(workspaceId, groupId, { title: 新topic })（try/catch 不阻塞卡更新，同旧联动容错风格）
- [ ] 检查 tipc confirmTopicChange 路由与前端 TopicStateCardSection 确认按钮路径无需改动（联动在主进程内部）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
