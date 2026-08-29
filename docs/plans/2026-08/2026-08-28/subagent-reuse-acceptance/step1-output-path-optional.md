---
step: 1
title: CreateSession outputPath 可选化
status: done
---

## 目标

outputPath 从必填改为可选：不填 = 通讯型交付（答案在 SendMessage 正文）。这是契约弹性化（Step 4）的机制前提。

## 依赖上下文（接力棒输入）

- 设计文档：[../2026-08-28-subagent-reuse-and-acceptance-design.md](../2026-08-28-subagent-reuse-and-acceptance-design.md) §架构 A.3
- 关键现状：`delegation-tools.ts:273` outputPath 为 `z.string().min(1)` 必填；`delegation-bridge.ts:489-503`（startChild）把 outputPath 写进 contractMetadata 并 `claimOutputPath`；`delegation-bridge.ts:616-623`（markChildDelivered）交付时 `releaseOutputPath`；`delegation-bridge.ts:334-338`（resumeChild）复活时 release + re-claim。

## 计划改动

- [x] `electron/main/agents/tools/delegation-tools.ts:273`：schema 改 `z.string().min(1).optional()`，描述改为「子会话交付文件写入共享区的相对路径；可省略——省略时为通讯型交付（答案直接放交付消息正文），适合问答、验证类任务」
- [x] `electron/main/agents/delegation-bridge.ts` startChild：`expectedOutputPath` 允许 undefined 写入 contractMetadata；outputPath 为空时跳过 `claimOutputPath`（检查 groupSharedService.claimOutputPath 对空串的行为，空值短路最稳）
- [x] `delegation-bridge.ts` markChildDelivered：outputPath 为空时跳过 `releaseOutputPath`
- [x] `delegation-bridge.ts` resumeChild：outputPath 为空时跳过 release/re-claim 对（避免 `outputPath "" 已被占用` 类误判）
- [x] 检查 `getChildSnapshot` / `conversationToSnapshot` 序列化对空 outputPath 的兼容（JSON 序列化 undefined 字段自然消失，确认消费端无 `c.outputPath.length` 类空指针）
- [x] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 配套改动 `types.ts` DelegateSpec.outputPath 改 optional（schema optional 后类型链必需）；`ChildStateSnapshot.outputPath` 保持 string（快照层空串表示无，`conversationToSnapshot` 已有 `?? ''`）。
  - `delegation-tools.ts` CreateSession 成功消息模板条件化：无 outputPath 时显示「→ 通讯型交付（答案直接放交付消息正文）」而非「建议交付路径 undefined」。
  - `CreateSessionBatch` 的 outputPath 保持必填不动（批量场景均为产出文件场景，previewClaim 依赖非空路径）。
  - `onSessionComplete` / `stopChild` / startChild 回滚分支的 `releaseOutputPath` 未加守卫：空串 key 在 pathClaims 中无 holder，release 本身是 no-op（已核实 group-shared-service.ts 实现）；仅在会产生误判的 claim 路径短路。
  - 新增用例：delegation-regression.test.ts「通讯型交付（无 outputPath）：创建、交付、停止后复活全流程空路径不误判」。
- 改动文件清单：
  - electron/main/types.ts（DelegateSpec.outputPath 可选）
  - electron/main/agents/tools/delegation-tools.ts（CreateSession schema + 成功消息）
  - electron/main/agents/delegation-bridge.ts（startChild claim 短路 / markChildDelivered 跳过 release / resumeChild 跳过 release+re-claim）
  - electron/main/agents/delegation-regression.test.ts（新增通讯型交付用例）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `DelegateSpec.outputPath?: string`（types.ts:233）；缺省 = 通讯型交付
  - `ChildStateSnapshot.outputPath: string` 不变，空串 = 通讯型交付；`conversationToSnapshot` 持续用 `?? ''` 归一
  - contractMetadata.expectedOutputPath（?: string）不填时 JSON 序列化自然消失；`conversation-runtime-service.ts:104` 读侧已有兑底 `'（未指定；直接通过 dogear__SendMessage 交付）'`
  - CreateSessionBatch items[].outputPath 仍为必填 `z.string().min(1)`
- 下个 step 该从哪里继续：契约模板弹性化（session-append-templates.ts subAgentContractFor）——目前 outputPath 为空时契约仍硬编码「用 dogear__SaveSharedNote 把完整交付内容写到共享区这个路径」，与 runtime-service 兑底文本拼在一起会自相矛盾，需按通讯型/文件型分叉
- 待办或已知限制：
  - `buildResumePrompt(reason, '')` 对通讯型子会话会渲染出「若共享区文件  已有部分内容」的无效提示（无害但不优雅），同样归入契约/提示词弹性化 step 处理
  - delegation-test-mocks 的 `claimOutputPath` mock 是无条件成功，测试对「空路径跳过 claim」只有流程级验证；空串误判 file_exists 的行为已在源码层面核实（safeResolve('') == sharedDir，fs.access 命中目录）
