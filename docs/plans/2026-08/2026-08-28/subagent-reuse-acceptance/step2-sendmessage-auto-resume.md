---
step: 2
title: SendMessage 自动调起停机子会话
status: pending
---

## 目标

SendMessage 遇到停机的直派子会话（stopped，无论是否已交付）时自动调起并投递消息，不再返回 `target_inactive` 丢消息。

## 依赖上下文（接力棒输入）

- 设计文档：§架构 A.1；排除「中断续跑」提示词复用的原因：追问语境下「你因中断停止，请从中断处继续」是错误提示。
- 关键现状：
  - `delegation-bridge.ts:799-824`（deliverMessage）是**同步函数**：waiter 命中 → 直送；session 存活 → queued；否则返回 `'target_inactive'`。
  - `delegation-tools.ts:126-141`（SendMessage handler）是 async，`target_inactive` 时返回「对方暂时收不到，请稍后重试」文案——此处是自动调起的最佳挂点。
  - `delegation-bridge.ts:307-375`（resumeChild）：末尾 fire-and-forget 发 `buildResumePrompt`（delegation-resume.ts:50）。
  - 直派关系判断：工具层有 `opts.conversationId`（父会话），`bridge.getChildIdBySessionId(parentConvId, targetSessionId)` 可反查 childId。
- Step 1 产出：outputPath 空值兼容已完成，resumeChild 跳过空路径的 release/claim。

## 计划改动

- [ ] `electron/main/agents/delegation-bridge.ts` resumeChild 加可选参数 `wakeupMessage?: string`：提供时用它替代 `buildResumePrompt` 作为唤醒输入（消息体包 sender 标签的逻辑与 deliverMessage 的 queued 分支对齐，建议把 senderTag 拼装提为小函数复用）
- [ ] `delegation-bridge.ts` 新增 async 包装 `resumeChildAndDeliver(childId, deliverOpts)`（或直接在 deliverMessage 调用链上做，见下）：调起成功后投递消息，返回 queued 语义
- [ ] `electron/main/agents/tools/delegation-tools.ts` SendMessage handler：`target_inactive` 时先判断 `target.conv.contractMetadata?.parentSessionId === ownSessionId` 且子会话非 running → 调 bridge 自动调起 + 投递；成功返回「✅ 目标会话已停机，已自动调起并送达」类文案；失败（如 JSONL 丢失）走现有 errorResult
- [ ] 实现位置二选一（实施时定）：a) 工具层判断（推荐——deliverMessage 保持同步纯投递，调起是编排逻辑）；b) bridge 层做。若选 a，`deliverMessage` 不动，handler 里先 resumeChild 再 sendMessage
- [ ] 并发防护：两次快速 SendMessage 打同一停机会话，第一次触发调起后 session 已 attach，第二次走 queued 排队，无需额外锁（确认 resumeChild 的状态提交顺序无中间态可见窗口）
- [ ] 测试：delegation-resume.test.ts 加用例——stopped 已交付子会话收到 SendMessage 自动复活、唤醒消息为追问原文而非中断模板
- [ ] 跑 `bun test electron/main/agents/`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
