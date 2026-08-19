---
step: 2
title: 持久层删除
status: done
---

## 目标

删除 delegation-state.json 持久层（文件、落盘调用、启动恢复），重启恢复改为纯 conversation 补集（截断 10 条），旧状态文件启动静默清理。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-state-model.md] 状态模型已精简（running/stopped + terminalReason + delivered + consecutiveFails），快照字段已对齐
- 当前关键文件状态：
  - `electron/main/agents/delegation-persist.ts` — 整文件待删；其中 `conversationToSnapshot`（:57）被 `getChildrenByParent` 使用，需搬迁
  - `electron/main/agents/delegation-bridge.ts:164-198` — `persistChildStates` / `touchPersist` / `loadChildStates` 待删；touchPersist 调用点：:317、:398、:587、:639 附近（Step 1 改动后行号可能偏移，按符号 grep）
  - `electron/main/index.ts:483` — `.then((m) => m.loadChildStates())` 启动挂载点，待替换
  - `electron/main/agents/delegation-bridge.ts:648` — `getChildrenByParent` 补集合并逻辑（保留，加截断）
- 关键决策回顾：持久层增量价值（retryCount/终态区分/errorMessage）不撑复杂度，用户拍板整体删除；重启后主会话靠上下文记忆（delivery 消息在消息历史里）+ 共享区文件判定，工具描述会声明这一规则（Step 3）

## 计划改动

- [x] `delegation-persist.ts` — 删除整个文件；`conversationToSnapshot` 搬进 `delegation-bridge.ts`（改产出：status 恒 stopped、delivered 恒 false、lastError 恒 undefined）
- [x] `delegation-bridge.ts` — 删 `persistChildStates` / `touchPersist` / `loadChildStates` 及全部调用点；删 `PersistedChildState` 相关 import
- [x] `delegation-bridge.ts` — 新增 `cleanupLegacyStateFile()`：启动时检测 `getConfigDir()/delegation-state.json` 存在则 fs 删除（静默，失败只记日志），export 供 index.ts 调用
- [x] `electron/main/index.ts:483` — `m.loadChildStates()` 替换为 `m.cleanupLegacyStateFile()`
- [x] `delegation-bridge.ts` `getChildrenByParent` — 补集 `listByParent` 结果按 `updatedAt` 降序截断 10 条再转 snapshot（内存条目优先去重逻辑保留，截断只作用于补集部分）
- [x] 测试：`delegation-persist.test.ts` 删除；`delegation-regression.test.ts` — 删「delegation-state.json 每 child 恒一条」用例，补集截断用例改造为「补集超过 10 条时只返回最近 10 条」；`delegation-test-mocks.ts` 里 delegation-state.json 相关 mock（DOGEAR_CONFIG_DIR 指向、statePath）清理
- [x] grep `delegation-state` / `DELEGATION_STATE_FILE` / `loadChildStates` / `touchPersist` 全部残留清零（docs 除外的代码与测试）

## 验证

- `bun run build:electron` + `bun test` 全绿
- dev 启动：控制台无 delegation 相关报错；若 `.dogear/delegation-state.json` 存在，启动后消失
- `ListLinkedSessions`（重启后调用）：返回最近 10 条历史子会话，status 全为 stopped

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 无实质差异。计划提到的 touchPersist 调用点实为 4 处（settleTerminal / resumeChild / startChild / markChildDelivered），全部删除；index.ts 挂载点实际在 :536（计划写 483，Step 1 后行号偏移）
  - `delegation-test-mocks.ts` 的 DOGEAR_CONFIG_DIR 隔离 env 与 fs/os 导入一并移除（落盘不存在后无写入面；bridge 不两写盘，logger 无 logDir 不落盘）
  - 回归测试删「每 child 恒一条」用例后新增「补集超过 10 条只返回最近 10 条」用例（12 条历史会话验证 updatedAt 降序截断 + status 恒 stopped + delivered 恒 false）
  - `getChildrenByParent` doc 注释「持久层补集」措辞改为「conversation 补集」（原措辞指已删的 delegation 持久层，易混淆）
  - 额外清理：tsc 不清 dist，手动删除孤儿产物 dist/main/agents/delegation-persist.js
- 改动文件清单：electron/main/agents/delegation-bridge.ts（删 persist 段 + 4 处 touchPersist、新增 cleanupLegacyStateFile、conversationToSnapshot 迁入且改私有）、electron/main/agents/delegation-persist.ts（删）、electron/main/agents/delegation-persist.test.ts（删）、electron/main/agents/delegation-regression.test.ts（删文件读盘 helper + 第 3 用例、新增补集截断用例）、electron/main/agents/delegation-test-mocks.ts（删 DOGEAR_CONFIG_DIR env + fs/os 导入）、electron/main/index.ts（loadChildStates → cleanupLegacyStateFile）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `cleanupLegacyStateFile(): Promise<void>`（bridge export）：unlink getConfigDir()/delegation-state.json，ENOENT 静默，其余失败 logger.warn
  - `conversationToSnapshot(conv: ConversationIndex, profiles: SubAgentProfile[]): ChildStateSnapshot`（bridge 模块私有，仅 getChildrenByParent 用）：status 恒 stopped、delivered 恒 false、lastError 不设即 undefined
  - `getChildrenByParent`：内存优先去重 + 补集 updatedAt 降序截 10，行为不变
- 下个 step 该从哪里继续：step3（工具描述/渲染层改造，ListGroupFiles 按需读、交付判定文案声明「重启后靠上下文记忆+共享区」）
- 待办或已知限制：
  - grep 残留仅 cleanupLegacyStateFile 函数体内的 'delegation-state.json' 字面量（新代码本体，非残留）；DELEGATION_STATE_FILE/loadChildStates/touchPersist/persistChildStates/loadRestorableChildren/PersistedChildState 全部清零
  - docs/codebase-map.md 仍描述旧持久层（delegation-persist 条目、delegation-state.json 存储条目），step4 文档同步项统一处理
  - dev 启动验证（旧文件启动后消失、ListLinkedSessions 重启后返回 10 条）未在子会话环境执行，留给主会话 dev 冒烟
