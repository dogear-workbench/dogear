---
step: 5
title: 联调验收
status: pending
---

## 目标

用真实 OpenAI Key 跑一遍 GPT-5 系列端到端（主会话 + 至少一条后台任务），确认协议路由/能力目录查询/推理强度透传都按设计生效；同时验证 anthropic-sdk 路径和现有 pi anthropic-messages 路径没有回归。

## 依赖上下文（接力棒输入）

- **Step 1-4 产出汇总**：数据模型（`piWireApi`/`piModels`/`ModelSelection.tier: string`）、`provider.ts` 协议路由 + 目录查询、主会话与四条后台任务的 `thinkingLevel` 透传、设置页 UI 全部已实现并各自手测过局部功能。本步是**端到端**验收，不是重新测每一步的局部功能。
- **未决问题**（design.md）：
  1. 模型 `thinkingLevelMap` 里某档是 `null`（不支持）时，pi-agent-core 实际是报错还是静默降级/忽略——本步需要用真实 Key 观察一次并记录结论（写进本 step 的实施回填，供以后查）
  2. 模型清单去重校验是否需要更严格的处理——本步如果手测中发现体验问题，可以在这里顺手补，不需要单独立项

## 计划改动

- [ ] 准备一个真实 OpenAI API Key，在设置页新建/编辑一个 pi Profile：`piWireApi: openai-responses`，`piModels` 里加 `gpt-5`、`gpt-5-mini`（或当前可用的实际型号）
- [ ] 主会话验收：用这个 Profile 开一个新对话，设置 `ai.effort` 为非空档位（如 `high`），发一句需要推理的问题，确认：
  - 回复正常返回，没有协议层报错
  - （如果能观察到，比如加临时日志或抓包）确认请求带了 `reasoning_effort` 或等价参数
  - 换成 `ai.effort` 为空/`null`，确认不传该参数也能正常跑（对应 `thinkingLevel: 'off'`）
- [ ] 后台任务验收：至少挑一条链路（建议 GROUP_DIGEST，触发成本最低——保存一个新的组卡或编辑现有会话触发脏检查）把 `digestModelSelection` 指向这个 openai-responses Profile，确认任务能正常完成并落盘
- [ ] 回归验收（确保没有破坏现有路径）：
  - anthropic-sdk Profile 的对话：正常发消息、正常切 tier（`setModel` 快速路径），确认 Step 1 的 `as ModelTier` 类型收尾没有引入运行时 bug
  - 现有 pi Profile（`piWireApi` 缺省，即 `anthropic-messages`）：正常发消息，确认查目录逻辑对 Claude 模型 ID（如 `claude-opus-4-7`）能命中 `ANTHROPIC_MODELS` 并且不改变现有行为观感
- [ ] `bun run lint` 全量跑一遍，确认没有遗留的类型/lint 问题

## 实施回填（做完后填）

### 实际改动
-

### 未决问题结论
- `thinkingLevelMap` 边界行为：
- 模型清单去重校验是否需要加强：

### 给下一步的接力棒
（本步是最后一步，完成后回 plan.md 补「完成总结」）
