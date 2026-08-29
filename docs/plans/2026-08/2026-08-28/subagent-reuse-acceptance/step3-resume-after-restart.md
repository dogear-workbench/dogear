---
step: 3
title: ResumeSession 重启降级恢复
status: done
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

- [x] `electron/main/agents/delegation-bridge.ts` 新增 `rehydrateChildState(conv)`：从 conversation 记录重建 childState——workspaceId/groupId/contractMetadata（parentSessionId、task、expectedOutputPath、subAgentProfileId）、profileName 反查（settings.subAgent.profiles by id，delegation-bridge.ts:679 附近已有同款反查）、status='stopped'、delivered=false、不挂计时器
- [x] `delegation-bridge.ts` getChildSnapshot：内存 miss 时尝试从磁盘 conversation 合成（复用 conversationToSnapshot 的组装逻辑，注意返回结构对齐）——或保持工具层显式调 rehydrate，二选一实施时定（**选了后者：工具层显式 rehydrate，理由见实施回填**）
- [x] `delegation-tools.ts:410-455` ResumeSession：内存 miss → 走磁盘降级（确认直派关系后 rehydrate → 正常 resumeChild 流程）；conversation 也查不到才报「不存在」
- [x] 恢复后行为与进程内一致：re-claim outputPath（空值跳过，Step 1 已兼容）、重挂 timeout/idle 计时器
- [x] 测试：新 bridge 实例（模拟重启）+ 磁盘 conversation 记录 → ResumeSession 成功；无记录 → 报错路径不变
- [x] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 二选一选了「工具层显式 rehydrate」：getChildSnapshot 是同步纯内存查询，被 SendMessage/StopSession/ResumeSession 及多个测试依赖，改 async + 隐藏 IO 会波及所有调用方；且合成快照≠可调起——resumeChild 开头 `if (!c) return` 依赖 childStates 有 Internal 条目，光合成快照不塞条目则 ResumeSession 依然静默无效。工具层判断 + bridge 重建与 Step 2 的分层（判断在工具层、编排/重建在 bridge）一致。
  - 超出计划的两处同机制延伸（rehydrate 后 handler 行为与进程内一致）：SendMessage 自动调起分支在 snapshot miss 时也走 rehydrate（重启后自动调起生效，补上 Step 2 遗留 1 的空窗）；StopSession 同样（重启后返回「已是 stopped 状态，无需停止」而非「不在运行时跟踪中」）。
  - rehydrate 不广播状态事件：UI 列表由 getChildrenByParent 磁盘补集覆盖，rehydrate 无可见状态变化，resumeChild 复活时才广播 running。
- 改动文件清单：
  - `electron/main/agents/delegation-bridge.ts`：新增 `rehydrateChildState(workspaceId, conv)`（幂等，塞 childStates，返回 snapshot 或 null）
  - `electron/main/agents/tools/delegation-tools.ts`：ResumeSession / SendMessage / StopSession 三处判断链插入「内存 miss → rehydrate」一步；ResumeSession 的 null 兑底文案改为「会话 xxx 不存在」
  - `electron/main/agents/delegation-resume.test.ts`：+5 用例（重启后 ResumeSession 成功且新 sessionId 幂等、无记录报错、非 sub 记录不可重建、重启后 SendMessage 自动调起、重启后 StopSession 提示无需停止）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `bridge.rehydrateChildState(workspaceId: string, conv: ConversationIndex): Promise<ChildStateSnapshot | null>`——幂等；非 sub 或无 contractMetadata 返回 null；不挂计时器/不广播；delivered 恒 false（运行时视角）
  - 工具层判断链：`getChildSnapshot` miss → `rehydrateChildState(target.workspaceId, target.conv)` → 后续逻辑不变
  - 复活后 harness sessionId 会更新（attach 回写 conv.sessionId），旧 sessionId 从 getBySessionId 反查不到——重启后调起 → ListLinkedSessions 查新 sessionId，既有语义，未改
- 下个 step 该从哪里继续：按 plan.md 顺序（契约模板弹性化 / 提示词判断线）继续；Step 1 遗留的「通讯型交付与 buildResumePrompt 拼接矛盾」可在此一并处理（本步测试已验证 resumeChild 走原 buildResumePrompt 路径，wakeupMessage 机制已就位）
- 待办或已知限制：
  - 重启后 quota 降级链的 modelTried 从零开始（内存防重字段，重启清零是合理语义，未持久化）
  - delegation-bridge.ts 已超 900 行（本次 +20），历史超限，拆分不在本 step 范围
