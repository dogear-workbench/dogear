# 升级 pi 0.83.0 + pause 功能（patch 透出 + 产品接入）实施计划

**目标**：把 @earendil-works/pi-agent-core + pi-ai 从 0.82.1 升到 0.83.0，重做 Windows 路径 patch 并新增 pause 透出 patch，在 PiSession/IPC/前端接入「turn 边界暂停」能力。

**架构思路**：升级本身几乎零成本（0.83.0 与 0.82.1 的 harness 文件 byte-identical，仅 proxy.js 3 处无关差异）；pause 不改 pi 运行时逻辑，只把上游已实现的 `AgentLoopConfig.shouldStopAfterTurn`（loop 层完整实现，harness 未透出）通过 dist patch 透出到 `AgentHarnessOptions`，产品语义由 dogear 侧状态机实现。排除了升级 0.84.x（运行时全是 stub）和 bare Agent 自建 harness（成本高且作废风险大）。

**涉及模块**：`package.json`（依赖 + patchedDependencies）、`patches/@earendil-works%2Fpi-agent-core@0.83.0.patch`、`electron/main/agents/pi-session/pi-harness-adapter.ts`、`electron/main/agents/pi-session/pi-session.ts`、IPC 路由（pause 请求 + sessionState）、前端会话输入区/状态展示组件。

## 步骤索引

- [x] [Step 1: 升级 0.83.0 并重做 Windows patch](./step1-upgrade-repatch.md) — 改依赖版本，bun patch 流程重做 6 处路径归一
- [ ] [Step 2: patch 透出 shouldStopAfterTurn](./step2-pause-patch.md) — 同一 patch 追加 4 行，把 pause 钩子接到 harness 选项
- [ ] [Step 3: PiSession 暂停状态机与 IPC](./step3-session-pause-integration.md) — adapter 暴露 pause 控制，pi-session 加 paused 状态与恢复分支
- [ ] [Step 4: 前端暂停交互与回归](./step4-ui-and-regression.md) — 暂停按钮、暂停态展示、全量回归

## 全局决策

1. **pause 是 turn 粒度**：不打断正在执行的工具；当前 turn（assistant 消息 + 其全部工具调用）正常完成后 harness 干净收尾（agent_end / settled / session 落盘）。UI 文案必须表述为「完成当前步骤后暂停」。
2. **paused 是独立会话状态**（非 running 非 idle）：`settled` 回调触发时若 pauseRequested 为 true → 广播 paused；此后 `sendMessage()` 必须走 `prompt()` 分支 —— **不能走 steer**（暂停后 harness 已 idle，`steer()` 会抛 `invalid_state`）。分支顺序：paused 优先于 isRunning 判断。
3. **恢复语义**：paused 时用户发送消息 = 清 pauseRequested + `prompt()`。暂停前的 steer 队列由 harness 保留（只有 abort 清空），新 run 启动时会先 drain 旧插话再拼 prompt 消息（`agent-loop.js:83` 行为），顺序天然正确：暂停前插话 → 恢复消息。
4. **patch 合一**：Windows 路径归一（6 处，从旧 patch 原样复用，因目标文件 byte-identical）+ pause 透出（4 行）合入同一个 patch 文件，锁 0.83.0。bun patch 头部带 hash，禁止手改版本号，必须走 `bun patch` 流程。
5. **本 patch 与 pause 方案在 0.84 迁移后作废**：新 harness（main 分支）无 shouldStopAfterTurn，迁移时 pause 要重新设计（见会话组共享区 pi-0.84-migration-research.md B 节末）。写代码时 pause 逻辑集中放 adapter/session，不要散落。
6. 调研依据：共享区 `pi-interjection-research.md`（插话/abort 机制）、`pi-upgrade-research.md`（升级与 patch 方案，本 plan 的 patch 行号出处）。
