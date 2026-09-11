---
step: 2
title: 队列结算改申报制
status: pending
---

## 目标
删除队列「一轮=任务完成」兜底；review 只由申报产生；轮结束时无 running 直属子会话且未申报 → interrupted + 申报引导。

## 依赖上下文（接力棒输入）
- 设计：`../delegation-lifecycle-fix-design.md` 架构第 1 条
- 现状机制：task-queue.ts:237-259——executeOne await 一次 sendMessage 后，success → extractResultSummary（:50，文本尾部截断冒充 result）→ completeTask（task-store.ts:260 running→review）+ notifyTask；task-queue.ts:241 无条件 detachAttachment
- 双写防护：task-queue.ts:252 只认 review 态；task-tools.ts:172-175 申报侧「无需重复申报」拦截
- 反查数据源：delegation-bridge `getChildrenByParent`（:613）合并磁盘 conversation（contractMetadata.parentSessionId），可查「execId 有无 running 直属子会话」
- 既有兜底保留：2h 无消息 interrupt（:285-299）、forcedRelease、recoverAndStartTaskQueue（:376）

## 计划改动
- [ ] task-queue.ts：删 executeOne 的 completeTask 兜底写回（:249-259 一带）及其 result 提取调用
- [ ] task-queue.ts：轮结束处置改为——bridge 反查存在 running 直属子会话 → 不结算（等下次注入续跑）；不存在且任务未申报（status 仍 running）→ interruptedTask + REPORT_RESULT_HINT 引导句；已申报（review）→ 仅收尾
- [ ] 验证 detached 时机与 Step 1 保活的配合：队列 detach 后 bridge hold 仍在，会话不死
- [ ] 验证路径：执行会话派单后回合结束 → 任务保持 running（不再假 review）；全部 step 完成、执行会话申报 → review 且 result 为申报摘要；轮结束未申报无子会话 → interrupted + 引导，之后补申报 → review

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
