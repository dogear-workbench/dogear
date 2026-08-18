---
step: 4
title: 前端状态展示 + 回归走查 + 文档同步
status: in_progress
---

## 目标

新状态值（hang/interrupted）与复活过程的 UI 可见；全链路回归验收；文档同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-persistence-tools.md] 全链路已通，前端类型已含新 ChildStatus 值（Step 1 同步过）
- 本步焦点：前端消费端展示 + 整体验收 + 收尾

## 计划改动

- [x] 前端 childStatus 消费端（执行时 grep `childStatusChanged` / `ChildStatus` 在 `components/` 与 `stores/` 的消费点，逐个补新值处理）：消费点全集为 AgentChat.tsx / ConversationRow.tsx / conversation-store.ts 三处
  - [x] 子会话状态徽标/角标：`hang` → 「无进展中断」（样式同 failed）、`interrupted` → 「重启中断」（可点击/提示可用 ResumeSession 调起——若状态组件无交互位，仅展示文案即可）
  - [x] 复活过程：状态从 failed 回 running 时 `deliveriesAwaitChanged` 已有广播，确认 UI 计数正确刷新
  - [x] `stores/` 中若有 ChildStatus 的 exhaustive switch/映射表，补新值防 fallback 兜底成错误样式（conversation-store 的 applyChildSnapshot 为通用 upsert 无 status 分支，无需补）
- [ ] 回归走查清单（dev 环境逐条过；代码可 script 化项已补测，见「实施回填」覆盖映射）：
  - [ ] 正常态：派遣 → 运行（idle 无误杀：长任务/长工具 10 分钟+ 活着）→ 交付 → 主会话收到
  - [ ] 瞬时失败：断网/改错 key 派遣 → failed → 自动复活（会话列表可见状态回 running）→ 成功交付，主会话全程只收到最终交付
  - [ ] 连续失败：MAX_RETRY 耗尽 → 主会话收到结构化通知（attempts/modelTried 正确）
  - [ ] quota 降级：profile 配两家供应商，一家 key 限流 → 自动降级复活，modelTried 含两家
  - [ ] 手动停止：StopSession → 不复活 → 通知 cancelled
  - [ ] 重启恢复：跑一半重启 → interrupted → ResumeSession 调起 → 接着干
  - [x] 老链路无回归：CreateSessionBatch、outputPath claim 冲突、abortWaitsForParent（前端中断等待按钮）（delegation-regression.test.ts 覆盖前两者；outputPath claim 冲突回滚逻辑在 startChild 既有路径未动，mock claim 恒 ok 无法 script 化冲突分支，随 dev 走查确认）
  - [x] delegation-state.json 不无限增长：done 条目保留合理（下版本再清理可接受，记录到已知限制）（delegation-regression.test.ts：每 child 恒一条 + 终态条目保留；已写入 codebase-map 已知说明）
- [x] `docs/codebase-map.md` 同步：delegation-bridge 职责描述更新（调度站：检测/重调/降级/持久化）、delegation-tools 新增 ResumeSession、delegation-state.json 存储
- [ ] 记忆更新：`delegation-dispatcher-design` 主题补实施结果（主会话后续安排）

## 验收路径

见回归走查清单——全部通过即本计划完成。

## 实施回填（做完后填）

### 实际改动

代码部分（本步完成；dev 走查由主会话/用户安排）：
- `components/conversation-list/ConversationRow.tsx`：interrupted 的 title 补 ResumeSession 调起提示；行首图标 interrupted 从红 CircleAlert 改为灰 Ban（同 cancelled，非错误语义）；hang 走既有 CircleAlert 红色 fallback
- `components/agent-chat/AgentChat.tsx`：子会话状态 banner 在 interrupted 时追加一行「父会话中可用 dogear__ResumeSession 调起续跑」；Step 1 已补的 childStatusLabels/Styles 覆盖全部 8 值
- `stores/conversation-store.ts`：无改动（applyChildSnapshot 为通用 upsert，无 ChildStatus exhaustive switch，不存在 fallback 兜底成错误样式的风险）
- 复活计数刷新链路确认：resumeChild 同时广播 childStatusChanged(running) + deliveriesAwaitChanged（delegation-bridge.ts:392-393）；前端 awaitCount 从 childrenByParent derive（AgentChat.tsx:149-163），applyChildSnapshot 更新后计数自动刷新，无需新订阅
- 新增 `electron/main/agents/delegation-regression.test.ts`（3 用例）：CreateSessionBatch 老链路（previewClaim + 同父批量 startChild 两个互不干扰）/ abortWaitsForParent（waiter resolve null + 子会话 cancelled + 其他父会话隔离）/ delegation-state.json 每 child 恒一条（failed→resume→done 多次状态变化后无重复条目、终态条目保留）
- `docs/codebase-map.md`：新增 delegation-bridge 调度站条目（四层职责）+ delegation-idle/terminal/resume/persist/lifecycle 纯逻辑层条目；delegation-tools 补 dogear__ResumeSession；conversation-service 补 listByParent；数据存储补 delegation-state.json

回归清单覆盖映射（script 级已测 vs 待 dev 手动）：
- 瞬时失败自动复活 → delegation-resume.test.ts「transient failed 自动复活原会话」（已测）；真实断网/错 key 场景待 dev
- 连续失败 MAX_RETRY 耗尽 → delegation-resume.test.ts「连续 failed 超过 MAX_RETRY 后通知」（已测）
- quota 降级 → delegation-resume.test.ts「quota 错误降级到异供应商」（已测）；真实限流待 dev
- 手动停止 cancelled → delegation-resume.test.ts「stopChild(cancelled) 不自动复活」（已测）
- 重启恢复 interrupted → delegation-persist.test.ts「loadChildStates 把 running 恢复为 interrupted」（已测）；ResumeSession 端到端调起待 dev
- 正常态全链路（派遣→运行→交付→主会话收到）与 idle 无误杀（10 分钟+长任务）→ 待 dev（idle 逻辑本身已由 delegation-idle.test.ts 覆盖）
- 老链路 CreateSessionBatch / abortWaitsForParent / state.json 不增长 → delegation-regression.test.ts（已测）
- 验收：`bun test electron/main/agents/` 42 pass 0 fail；`bun run lint` 0 errors；`bun run build:electron` 通过；前端 `bunx tsc --noEmit` 12 错误与基线一致零新增

- 与计划差异：无实质差异；outputPath claim 冲突分支因 mock 恒 ok 无法 script 化，归入 dev 走查
- 改动文件清单：components/conversation-list/ConversationRow.tsx、components/agent-chat/AgentChat.tsx、electron/main/agents/delegation-regression.test.ts（新增）、docs/codebase-map.md

### 给下一步的接力棒
- 代码部分全部完成；剩余：dev 环境手动回归走查（清单见上）+ 记忆主题更新 + plan.md 总回填（主会话安排）
- 已知限制：delegation-state.json 终态条目不自动清理（条目数与子会话数一一对应不膨胀，但历史越积越多；下版本可按 finishedAt 清理）
- 完成总结写回 plan.md（实际改动汇总、与原计划偏差）
