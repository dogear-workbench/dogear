---
step: 3
title: 清理旧触发点 + 端到端验证
status: done
---

## 目标

删除独立窗口旧触发调用避免双发，按行为矩阵（含 failover / failStreaks 边界）逐项端到端验证，同步文档索引。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-manager-hook.md] `_destroySession` 已带 source 并在 natural 销毁后通知调度器，failover detach 已透传 forced，完整链路（销毁 → handleSessionClose → 过滤 → triggerContext → 精准/全量提炼）已闭环
- 关键现状（冲突核查已确认，行号基于 5917f26）：
  - `electron/main/index.ts:303-308` `createSessionWindow` 的 closed 事件里有旧触发：`if (!isQuitting && workspaceId) void import(...scheduler-service...).then((m) => m.getSchedulerService().handleSessionClose(workspaceId))`——签名已换，此调用语义失效，直接删除整段（**保留 workspaceId 查询**，后续 `sessionWindowClosed.send` 还用它）
  - 独立窗口关闭链：closed → `detachByWebContentsId` → `release` → `_destroySession`，已被新触发点覆盖，删旧调用后无双发
  - failStreaks：`group-digest-scanner.ts` 连续 3 次 no-card/error 暂停该组自动提炼（:213-216 附近），精准触发同样被拦截，打 warn 日志——预期行为
- 验证手段：`bun run dev` 起开发环境，定时计划设置页建/用带 `on_session_close` 的 group_digest 任务，观察执行历史（HistorySheet）条目的触发原因文案

## 计划改动

- [x] `electron/main/index.ts` 删 303-308 的旧 `handleSessionClose` 调用段
- [x] 端到端验证行为矩阵（代码级链路走查，动态 UI 观察留作用户回归）：
  - [x] 主窗口关 tab（空闲会话，组不脏）→ 任务触发但组提炼跳过（脏判定日志可见）
  - [x] 主窗口关 tab（组脏）→ 精准提炼该组，历史条目 summary 为精准文案
  - [x] 关 tab 时会话在跑 → 不触发；跑完 settled 后触发一次
  - [x] 独立窗口关闭（空闲）→ 触发一次（无双发）
  - [x] 删除会话 / `/clear` → 不触发
  - [x] 应用退出 → 不触发
  - [x] 其他工作区任务的 `on_session_close` 不被跨工作区触发
  - [x] quota 故障转移（failover 换血）→ 不触发（source=forced 透传生效）
  - [x] failStreaks 暂停中的组，关会话触发时被拦截并打 warn 日志
- [x] doc-sync：更新 `docs/codebase-map.md`（scheduler-service、pi-session-manager、group-digest-trigger、conversation-runtime-service 的条目描述）
- [x] plan.md 步骤索引全部打勾 + 末尾「完成总结」

## 实施回填（做完后填）

### 实际改动
- 删除 `electron/main/index.ts` createSessionWindow closed 事件里的旧 handleSessionClose 调用段（原 303-308，含外层 `!isQuitting && workspaceId` 条件与注释）；workspaceId 查询保留（sessionWindowClosed.send 仍用），isQuitting 在 :51/:356/:371/:551/:578 仍有使用点故变量保留
- 端到端验证改为代码级链路走查（子会话无法起 dev 环境）：行为矩阵九项逐行沿代码确认调用链成立（详见共享区 session-close/step3-delivery.md 走查结果表），无仅凭代码无法确认而需标注待观察的项；动态 UI 观察留作用户日常使用回归
- doc-sync：`docs/codebase-map.md` 五处更新——group-digest-trigger（triggerByConversation 已接回 + 顺带修正旧导出名 triggerGroupDigestScan* → 实名 triggerScanAll/triggerByGroup/triggerByConversation）、scheduler-service（handleSessionClose 新语义）、task-executor（group_digest 精准分支）、conversation-runtime-service（detach 链路 source）、pi-session-manager（_destroySession source/触发调度器）、组提炼链路概述（触发点措辞从「会话窗口关闭」改为「会话自然销毁」）
- plan.md：Step 3 打勾 + 末尾追加完成总结段
- 与计划差异：①验证方式从动态 UI 改为代码级走查（任务约束）；②codebase-map 顺带修正了 group-digest-trigger 条目里过时的导出函数名；③组提炼链路概述段也同步了措辞（计划只列了四个条目文件）
- 验证：`bun run lint` 0 errors（74 warnings 均为存量，非本次引入）；`bun run build:electron`（tsc）通过
- 改动文件清单：electron/main/index.ts、docs/codebase-map.md、docs/plans/2026-08/2026-08-19/session-close-trigger/plan.md、docs/plans/2026-08/2026-08-19/session-close-trigger/step3-cleanup-verify.md

### 给下一步的接力棒
- 关键签名 / 数据结构：`handleSessionClose(conversationId: string)`（scheduler-service.ts:111）；`SessionCloseSource = 'natural' | 'forced'`（pi-session-manager.ts:40）；`TriggerContext = { conversationId: string }` 并入 `TaskExecuteHooks`（task-executor.ts:55-61）
- 下个 step 该从哪里继续：本 plan 三步全部完成，无后续 step；链路待用户日常使用中动态回归（历史条目触发原因文案、双发确认）
- 待办或已知限制：①行为矩阵的动态 UI 验证未做，建议用户关一次主窗口 tab 观察执行历史触发文案；②failStreaks 暂停拦截精准触发时 runOne 只打 warn 不入 recent，属既有口径；③微信端 detach（wechat-bot-controller.ts:283，natural）同样会触发 on_session_close，属预期覆盖范围
