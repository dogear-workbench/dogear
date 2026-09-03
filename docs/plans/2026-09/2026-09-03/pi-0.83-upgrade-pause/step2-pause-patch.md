---
step: 2
title: patch 透出 shouldStopAfterTurn
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
