---
step: 3
title: LiveTail 包 agent-turn + 回归验证
status: done
---

## 目标

LiveTail 渲染结构对齐历史区（`<section class="agent-turn">` 包裹），恢复运行中用户消息的 sticky 吸附范围，并完成全量回归。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] 运行中 turn 的 user header 与流式回复都在 live；[step2] 重放路径 user header 不再丢失——本 step 改完后，运行中 turn 的 user 消息存在于 LiveTail 渲染区，需要容器恢复 sticky。
- 当前关键文件状态：`components/agent-chat/LiveTail.tsx`
  - `liveTail.map(...)` 直接渲染 `MessageItem`（Fragment 包裹，:53-73），StreamingIndicator 在 map 之后（:74）。
  - 历史区对照：`StableHistory.tsx:59` 每个 turn 是 `<section key={turn.turnId} className="agent-turn">`。
- CSS 事实（已 Electron 实证，两个最小 repro）：
  - sticky 元素吸附范围 = 包含块范围；user 消息在「只含自己高的矮 section」里 → 吸附范围塌缩为 0，完全不悬停（bug 现状）。
  - 裸放（无 section）时包含块 = 整个内容 div，能吸附但范围失真（跨 turn 过度吸附）。
  - 正确结构：user 消息所在 section 覆盖完整 turn（header + 回复）→ 吸附范围 = 本 turn。
- 关键决策回顾：`agent-turn` class 无 CSS 定义（纯标记），包上无副作用；StreamingIndicator 放 section **外**（turn 级指示器，不参与 sticky 包含块）；`TodoListBlock` 条件渲染保持在 section **内**（跟随消息位置）。

## 计划改动

- [ ] `LiveTail.tsx`：`liveTail.map(...)` 外层包 `<section className="agent-turn">`（StreamingIndicator、TodoListBlock 的相对位置按上面决策调整）
- [ ] 回归验证：
  - [ ] `bun test components/agent-chat/hooks/useTranscriptState.test.ts` 全绿
  - [ ] `bun test`（全量）+ `bun run lint` 通过
  - [ ] 手工：发送长任务（回复超一屏）→ 向上滚动 → 运行中用户消息吸顶，滚回底部释放
  - [ ] 手工：turn 完成后翻历史 → 各 turn 用户消息依次吸顶（回归原有功能）
  - [ ] 手工：运行中插话 → 旧 turn 提升完结、新消息成为新 turn header 且吸顶正常
  - [ ] 手工：子会话/外部启动会话运行中点开 → 任务消息可见且 sticky 正常（Step 2 生效的端到端确认）
  - [ ] 手工：搜索（Ctrl+F 跳转）、compact 折叠/展开、minimap 跳转、Fork、/clear、图片附件发送回归
  - [ ] 手工：微信 bot 消息实时到达与重放均正常显示

## 实施回填（做完后填）

### 实际改动
- 与计划差异：仅一处最小化补强——section 外加 `liveTail.length > 0` 守卫（AgentChat 无条件渲染 LiveTail，空闲态避免挂空 section，与历史区「section 只在有消息时存在」语义一致）。
- 改动文件清单：`components/agent-chat/LiveTail.tsx`（:58 守卫、:59 section 开、:61-80 消息体内缩、:83 闭合；StreamingIndicator 保持 section 后同级）。
- 测试：useTranscriptState.test.ts 13/13 绿；components/agent-chat/ 33/33 绿；tsc 无新增错误（20 个均为既有，stash 基线比对）；lint 0 error。

### 给下一步的接力棒
- 关键签名 / 数据结构：live 区 DOM = `section.agent-turn > Fragment(messageId) > [MessageItem, TodoListBlock?]`，StreamingIndicator 为 section 后兄弟节点；与 StableHistory.tsx:59 turn 结构对齐。
- 下个 step 该从哪里继续：本 step 为工作线最后一步代码改动，无后续 step；剩手工回归项待用户 Electron 内验证。
- 待办或已知限制：手工回归 6 项（长任务吸顶 / 历史吸顶 / 插话 / 子会话重放端到端 / 搜索等交互 / 微信 bot）待用户执行；step2 已知限制——attach 窗口下 stable 尾保留 run 前缀与重放产物重复（既有行为，未动）。
