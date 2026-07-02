---
step: 2
title: tipc 路由层
status: done
---

## 目标
在 `electron/main/tipc/digest.ts` 新增 `cancelAllGroupDigest` RPC，转发到服务层；确保前端能通过 tipc client 调用。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1] 新增了 `cancelAllGroupDigest(): Promise<{ cancelledQueued: number; cancelledCurrent: boolean }>`，从 `group-digest-trigger.js` 导出
- 当前关键文件状态：`digest.ts` 已 import `triggerScanAll, triggerByGroup, getGroupDigestActivity` from trigger.js，且已有 `cancelGroupDigest` 单任务取消路由（调 `getAgentManager().cancelTask(taskId)`）
- 关键决策回顾：tipc 路由自动暴露给前端 `client.cancelAllGroupDigest()`，无需手动维护类型（`@egoist/tipc` 类型推断）

## 计划改动
- [x] `electron/main/tipc/digest.ts` import 处加 `cancelAllGroupDigest`
- [x] 新增 RPC `cancelAllGroupDigest`，转发到服务层，返回 `{ success, cancelledQueued, cancelledCurrent }`
- [x] 检查 `types/electron-api.ts`：grep 无 digest 相关手工镜像，纯靠 tipc 类型推断，跳过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无
- 改动文件清单：`electron/main/tipc/digest.ts`

### 给下一步的接力棒
- 关键签名：前端调用 `await client.cancelAllGroupDigest()` → `{ success: true, cancelledQueued: number, cancelledCurrent: boolean } | { error: string }`
- 下个 step 该从哪里继续：`app/settings/memory/DigestsPanel.tsx` 加停止按钮调这个 RPC，重新开始按钮调已有的 `client.triggerGroupDigestScan()`
- 待办或已知限制：

