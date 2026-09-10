---
step: 3
title: UI 等待中状态与收尾
status: done
---

## 目标

前端正确呈现「等待子会话交付中」中间态，清理测试残留，同步文档索引。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-remove-suspension.md] 挂起机制已删，主会话派单后 run settled、靠注入唤醒
- 关键决策：等待态不落新 store 字段优先——先看 childStates 快照（delegation-bridge 已向 UI 广播子会话状态）能否派生「当前会话有 running 直属子会话」，能派生就不加冗余状态
- 判定规则：run settled（会话非 running/paused）∧ 存在 running 直属子会话 → 展示「等待子会话交付中」；UI 上输入框按 idle 会话正常开放（这正是本 feature 的目的：等待期可正常聊天）
- 「等待中」是派生展示态，不阻塞任何操作（用户可继续发消息、可停止会话）

## 计划改动

- [x] 定位会话状态展示点（chat header / 状态徽章 / ChatInputArea 附近），加「等待子会话交付中」展示；数据源优先派生自子会话快照广播
- [x] 清理 `delegation-*.test.ts` 中 waiter/WaitForMessage 相关用例（`waitForMessage` resolve 行为、`abortMessageWaits` 兜底等），保留 settleTerminal/复活/降级/no_delivery 用例（step2 已改写为注入断言，本步 grep 确认零残留，零改动）
- [x] 手动回归：插话即时性、交付唤醒、终态通知、主会话未打开时 target_inactive 不崩溃（无人值守环境转为全量测试 + 上线人工回归清单，见共享区 step3-delivery.md 第五节）
- [x] doc-sync 更新 codebase-map（delegation 等待机制描述、工具清单变化）
- [x] plan.md 末尾补「完成总结」（主会话完成）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 判定数据源结论：完全派生，**未新增 store 字段**。`isWaitingForChildren = !isLoading && !isRunningInStore && !isPausedInStore && awaitCount > 0`（AgentChat.tsx:140）；running 子会话数来自既有 `childrenByParent[conversationId]` 快照（childStatusChanged 增量 + refreshAllChildren 冷启动），settled 来自 sessionStateChanged 广播
  - **paused 必须显式排除**：后端 paused=true 时 running 恒 false，但「用户主动暂停」≠「run settled」，只查 running 集合会在暂停会话上误显示等待态
  - 计划外顺手修复 step2 残留 bug：AgentChat.tsx `handleAbortWait` 仍读已删的 `result.abortedWaits`（恒 undefined，toast 显示「已中断 undefined 个等待」）→ 改为只报 `cancelledChildren`
  - 测试清理项零改动（step2 已清干净，grep 确认）
  - 手动回归无法真机执行 → 全量 bun test 299 pass / 0 fail + 上线人工回归清单（7 项，共享区 step3-delivery.md）
- 改动文件清单：`components/agent-chat/AgentChat.tsx`、`LiveTail.tsx`（透传）、`StreamingIndicator.tsx`（等待态分支 + Hourglass + 计数文案 + 中断等待按钮）、`ChatInputArea.tsx`（状态行「等待子会话交付中 · 可继续对话」，输入框行为零改动）、`docs/codebase-map.md`

### 给下一步的接力棒
- 关键签名 / 数据结构：等待态判定唯一入口 `AgentChat.tsx` 的 `isWaitingForChildren`；展示点两处（StreamingIndicator 消息流底部 + ChatInputArea 状态行），prop 名 `awaitingDelivery`
- 下个 step 该从哪里继续：本计划最后一步，无后续 step
- 待办或已知限制：
  - task-queue 生命周期与新等待机制交互（step2 遗留，待用户决策）：执行会话派单后结束回合 → 队列兜底置 review 提前发「任务待审核」通知，续跑轮在 review 态运行且 ReportTaskResult 被「无需重复申报」拦截；根治需队列「存在 running 直属子会话不结算」语义
  - 存量会话调用已删工具名会收到 unknown tool 错误（框架侧已确认安全不挂起），真实模型适应表现待上线观察，差则补同名占位劝退工具
  - 主会话 running 且子会话也在跑时仍显示旧文案「等待 N 个子会话交付…」（旧 isAwaiting 分支保留），与新 settled 等待态并存，文案统一可后续迭代
