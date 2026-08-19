---
step: 2
title: 持久层删除
status: pending
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

- [ ] `delegation-persist.ts` — 删除整个文件；`conversationToSnapshot` 搬进 `delegation-bridge.ts`（改产出：status 恒 stopped、delivered 恒 false、lastError 恒 undefined）
- [ ] `delegation-bridge.ts` — 删 `persistChildStates` / `touchPersist` / `loadChildStates` 及全部调用点；删 `PersistedChildState` 相关 import
- [ ] `delegation-bridge.ts` — 新增 `cleanupLegacyStateFile()`：启动时检测 `getConfigDir()/delegation-state.json` 存在则 fs 删除（静默，失败只记日志），export 供 index.ts 调用
- [ ] `electron/main/index.ts:483` — `m.loadChildStates()` 替换为 `m.cleanupLegacyStateFile()`
- [ ] `delegation-bridge.ts` `getChildrenByParent` — 补集 `listByParent` 结果按 `updatedAt` 降序截断 10 条再转 snapshot（内存条目优先去重逻辑保留，截断只作用于补集部分）
- [ ] 测试：`delegation-persist.test.ts` 删除；`delegation-regression.test.ts` — 删「delegation-state.json 每 child 恒一条」用例，补集截断用例改造为「补集超过 10 条时只返回最近 10 条」；`delegation-test-mocks.ts` 里 delegation-state.json 相关 mock（DOGEAR_CONFIG_DIR 指向、statePath）清理
- [ ] grep `delegation-state` / `DELEGATION_STATE_FILE` / `loadChildStates` / `touchPersist` 全部残留清零（docs 除外的代码与测试）

## 验证

- `bun run build:electron` + `bun test` 全绿
- dev 启动：控制台无 delegation 相关报错；若 `.dogear/delegation-state.json` 存在，启动后消失
- `ListLinkedSessions`（重启后调用）：返回最近 10 条历史子会话，status 全为 stopped

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
