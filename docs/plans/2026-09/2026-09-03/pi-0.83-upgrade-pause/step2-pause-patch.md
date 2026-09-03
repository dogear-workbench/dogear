---
step: 2
title: patch 透出 shouldStopAfterTurn
status: done
---

## 目标

在 Step 1 重建的 patch 上追加 4 行改动，把 loop 层已实现的 `shouldStopAfterTurn` 透出到 `AgentHarnessOptions`，并通过 TS 编译验证。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-upgrade-repatch.md] 已升 0.83.0，patch 文件 `patches/@earendil-works%2Fpi-agent-core@0.83.0.patch` 已含 Windows 6 处
- 当前关键文件状态：patch 目标 `dist/harness/agent-harness.js`、`dist/harness/types.d.ts` 与 0.82.1 byte-identical，下述行号有效
- 关键决策回顾：不改 pi 运行时逻辑，只透出选项；loop 层消费点在 `dist/agent-loop.js:151-158`（turn 结束后调用，返回 true → emit agent_end → run 干净收尾，steer 队列保留）

## 计划改动

- [ ] `bun patch @earendil-works/pi-agent-core@0.83.0` 重新打开编辑目录
- [ ] `dist/harness/types.d.ts`（约 :672）：`AgentHarnessOptionsBase` 的 `followUpMode?: QueueMode;` 之后加一行：

```ts
shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;
```

同时补类型导入：先看该文件头部现有 import，若已从 `"../types.ts"` import 其他类型则把 `ShouldStopAfterTurnContext` 并入，否则加一行 `import type { ShouldStopAfterTurnContext } from "../types.ts";`（该类型定义在包根 `dist/types.d.ts:96-107`）

- [ ] `dist/harness/agent-harness.js`（约 :136，constructor）：存字段

```js
this.shouldStopAfterTurn = options.shouldStopAfterTurn;
```

- [ ] `dist/harness/agent-harness.js`（约 :396，`createLoopConfig` 返回对象末尾、`getFollowUpMessages` 之后）：

```js
shouldStopAfterTurn: this.shouldStopAfterTurn,
```

- [ ] `bun patch --commit`，确认 patch 文件同时含 Windows 6 处 + 本 4 行
- [ ] 验证：`bun run build:electron` 编译过（.d.ts 生效）；`bun install` 重装后改动仍在

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① import 未单独加 `../types.ts` 行，而是并入现有 `../index.ts` import 行（index.d.ts `export * from "./types.ts"` re-export，与 QueueMode 同源，语义等价）；② 实际行号 constructor 落 :157、createLoopConfig 落 :409（计划估 :136/:396）；③ 重开编辑目录再 commit 使 patch 头部带 `.bun-tag-xxx` diff（bun 自动行为）
- 改动文件清单：patches/@earendil-works%2Fpi-agent-core@0.83.0.patch（新增 2 diff 块 4 行：types.d.ts import+选项、agent-harness.js :157 存字段+:409 透传）

### 给下一步的接力棒
- 关键签名 / 数据结构：`AgentHarnessOptions.shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>`；context = `{ message: AssistantMessage; toolResults: ToolResultMessage[]; context: AgentContext; newMessages: AgentMessage[] }`（包根 dist/types.d.ts:96-107）。返回 true → loop emit agent_end 干净收尾，steer/followUp 队列保留
- 契约：回调不得 throw/reject（上游 JSDoc：抛异常打断低层 loop）；回调内只读 pauseRequested 标志返回 boolean，副作用（广播 paused、清标志）放 settled 之后
- 下个 step 该从哪里继续：Step 3 在 adapter 构造 AgentHarnessOptions 时传 `shouldStopAfterTurn: () => this.pauseRequested`；sendMessage 分支 paused 优先于 isRunning，paused 走 prompt() 不能 steer；UI 文案「完成当前步骤后暂停」
- 待办或已知限制：验证过破坏性重装（rm 包 + bun install）后 patch 自动重新应用；0.84 迁移时本 patch 作废
