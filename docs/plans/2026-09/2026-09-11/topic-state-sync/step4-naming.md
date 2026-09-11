---
step: 4
title: 话题命名联动
status: done
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
- 与计划差异：initialTitle 消费点选在 background-store `mergeIncrementAndSave` 内（计划允许 handler 或调用侧二选一）：统一入口覆盖所有增量合并路径、零新增依赖、agent-worker.ts 零改动；其余按计划落地，tipc/前端确认无需改动（组件在根目录 components/ 非 src/）
- 改动文件清单：electron/main/services/memory/background-store.ts（mergeIncrementAndSave 加 initialTitle 消费；resolvePendingTopicChange accept 分支联动 updateGroup）

### 给下一步的接力棒
- 关键签名 / 数据结构：两处新副作用均 try/catch 仅 console.warn（`[state-card]` 前缀）不阻塞卡写入/返回；initialTitle 生效条件 = trim 非空 && group.title 为空（幂等，生效后不再触发）；确认联动取 topicHistory 尾部（confirmPendingTopicChange 保证非空）
- 下个 step 该从哪里继续：group-digest-tools.ts:139 旧联动可安全删（状态卡链路已接管首命名+确认改名两个入口）；不碰 digest/review 模块删除本身
- 验收：lint 0 errors、build:electron 通过；抽查 background-store.ts 两处联动实现合格（幂等判定/尾部取值/容错风格均正确）；单文件 +19 行零越界
- 待办或已知限制：磁盘旧 prompt 屏蔽 initialTitle 约束（step1 caveat 仍在）；updateGroup 失败静默仅日志；GUI 验收可一并看 amber 卡确认后话题列表标题刷新
