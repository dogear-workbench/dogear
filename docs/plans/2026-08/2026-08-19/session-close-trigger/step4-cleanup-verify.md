---
step: 4
title: 清理旧触发点 + 端到端验证
status: pending
---

## 目标

删除独立窗口旧触发调用避免双发，按行为矩阵逐项端到端验证，同步文档索引。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-manager-hook.md] `_destroySession` 已带 source 并在 natural 销毁后通知调度器，完整链路（销毁 → handleSessionClose → 过滤 → triggerContext → 精准/全量提炼）已闭环
- 关键现状（本会话已调查）：
  - `electron/main/index.ts:303-308` `createSessionWindow` 的 closed 事件里有旧触发：`if (!isQuitting && workspaceId) void import(...scheduler-service...).then((m) => m.getSchedulerService().handleSessionClose(workspaceId))`——签名已换，此调用现在应编译不过或语义失效，直接删除整段（保留 workspaceId 查询，后续 `sessionWindowClosed.send` 还用它）
  - 独立窗口关闭链：closed → `detachByWebContentsId` → `release` → `_destroySession`，已被新触发点覆盖，删旧调用后无双发
- 验证手段：`bun run dev` 起开发环境，定时计划设置页建/用带 `on_session_close` 的 group_digest 任务，观察执行历史（HistorySheet）条目的触发原因文案

## 计划改动

- [ ] `electron/main/index.ts` 删 303-308 的旧 `handleSessionClose` 调用段
- [ ] 端到端验证行为矩阵：
  - [ ] 主窗口关 tab（空闲会话，组不脏）→ 任务触发但组提炼跳过（step1 脏判定日志可见）
  - [ ] 主窗口关 tab（组脏）→ 精准提炼该组，历史条目 summary 为精准文案
  - [ ] 关 tab 时会话在跑 → 不触发；跑完 settled 后触发一次
  - [ ] 独立窗口关闭（空闲）→ 触发一次（无双发）
  - [ ] 删除会话 / `/clear` → 不触发
  - [ ] 应用退出 → 不触发
  - [ ] 其他工作区任务的 `on_session_close` 不被跨工作区触发
- [ ] doc-sync：更新 `docs/codebase-map.md`（scheduler-service、pi-session-manager、group-digest-trigger 的条目描述）
- [ ] plan.md 步骤索引全部打勾 + 末尾「完成总结」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
