---
step: 3
title: ResumeSession 重启降级恢复
status: pending
---

## 目标

应用重启后（内存 childStates 清空），ResumeSession 不再报「不在本进程运行时跟踪中」——降级用磁盘 contractMetadata 重建跟踪并恢复。

## 依赖上下文（接力棒输入）

- 设计文档：§架构 A.2。
- 关键现状：
  - `delegation-tools.ts:410-455`（ResumeSession handler）校验链：直派关系（磁盘 contractMetadata，已有）→ `getChildIdBySessionId(...) ?? target.conv.id`（childId 已有磁盘降级）→ `getChildSnapshot(childId)` 内存 miss 即报错——**这是本步要改的点**。
  - `delegation-bridge.ts:307-309` resumeChild 开头 `const c = childStates.get(childId); if (!c || c.status === 'running') return;`——内存 miss 时**静默 return**，所以必须先重建 childState 再进 resumeChild。
  - `delegation-bridge.ts:628-648` conversationToSnapshot：重启后从 conversation 记录合成快照（delivered 恒 false，运行时视角设计，维持）。
- Step 2 产出：resumeChild 支持 wakeupMessage（本步恢复仍用「从中断处续跑」语义，走原 buildResumePrompt 路径即可）。

## 计划改动

- [ ] `electron/main/agents/delegation-bridge.ts` 新增 `rehydrateChildState(conv)`：从 conversation 记录重建 childState——workspaceId/groupId/contractMetadata（parentSessionId、task、expectedOutputPath、subAgentProfileId）、profileName 反查（settings.subAgent.profiles by id，delegation-bridge.ts:679 附近已有同款反查）、status='stopped'、delivered=false、不挂计时器
- [ ] `delegation-bridge.ts` getChildSnapshot：内存 miss 时尝试从磁盘 conversation 合成（复用 conversationToSnapshot 的组装逻辑，注意返回结构对齐）——或保持工具层显式调 rehydrate，二选一实施时定
- [ ] `delegation-tools.ts:410-455` ResumeSession：内存 miss → 走磁盘降级（确认直派关系后 rehydrate → 正常 resumeChild 流程）；conversation 也查不到才报「不存在」
- [ ] 恢复后行为与进程内一致：re-claim outputPath（空值跳过，Step 1 已兼容）、重挂 timeout/idle 计时器
- [ ] 测试：新 bridge 实例（模拟重启）+ 磁盘 conversation 记录 → ResumeSession 成功；无记录 → 报错路径不变
- [ ] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
