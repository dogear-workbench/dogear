---
step: 5
title: Transcript、组摘要与 Delegation 迁移
status: pending
---

## 目标

将会话逐字稿、组摘要、引用保真度和跨会话协作从 sdkSessionId / SDK JSONL 收敛到 Harness sessionId 与统一的 transcript adapter。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Conversation 的 `sessionId` 是新主会话唯一持久化标识；Harness repository 可以打开 session 并读取当前 branch 的 entries。
- 历史 adapter 已定义 Harness message / compaction 的展示转换，但 transcript 需要面向摘要和 source fidelity 的稳定、可追溯 UUID 口径。
- 当前 SDK transcript 链路集中于 `electron/main/services/memory/session-paths.ts`、`transcript-cleaner.ts`、`group-digest-scanner.ts`、`source-fidelity.ts` 和 `agents/tools/digest-tools.ts`。
- 当前 delegation 协议、bridge 和工具以 `sdkSessionId` 作为跨会话地址，集中于 `electron/main/agents/delegation-bridge.ts` 与 `electron/main/agents/tools/delegation-tools.ts`。
- 旧归档会话必须排除在 dirty scan、摘要、引用校验和 delegation 之外。
- 已知现状缺口：`pi-session.ts` 的 `getSdkSessionId()` 目前硬编码返回 `undefined`（注释仍是 Step 2A 之前"pi 无持久化 session_id"的过时描述，未随 Step 2A 引入的 Conversation `sessionId` 更新）。这导致当前所有走 pi 的主会话调用 `CreateSession` 派子会话时，`delegation-bridge.ts` 因 `parent.sdkSessionId` 恒为空而放弃写 `contractMetadata`（仅 warn 日志，不报错），协作溯源实际失效。本步骤需要在切换协议命名的同时修复这一点：Harness 会话创建后应让 `getSdkSessionId()`（或其更名后的等价方法）返回真实的 Harness `sessionId`。

## 计划改动

- [ ] 建立运行时中立且仅面向 Harness 的 transcript adapter：从当前 Harness branch 读取消息，生成组摘要所需的去噪文本、稳定 source UUID 和 mtime/version 信息。
- [ ] 确定 Harness entry/message 的 source UUID 策略：优先保留 Harness entry ID；若前端块需要更细粒度 UUID，建立可重复推导的映射，禁止每次读取随机生成。
- [ ] 将 CleanTranscript、ReadReferenceSession、source-fidelity 和 session 路径解析统一改调用该 adapter，删除它们对 SDK session JSONL 文件格式的假设。
- [ ] 修改 group-digest-scanner 及相关 trigger：只扫描非归档、拥有 Harness sessionId 的 main Conversation；mTime/脏判定读取 Harness session 文件或 repository 提供的元数据。
- [ ] 将 delegation 领域命名和协议中的 sdkSessionId 改为 sessionId；Conversation id 仍用于业务关联与权限校验。
- [ ] 调整 delegation bridge：Harness 会话创建后可立即获得 sessionId，不再等待 SDK `session_init`；CreateSession/CreateSessionBatch 同步返回可通信 sessionId。
- [ ] 迁移 SendMessage、WaitForMessage、ListLinkedSessions、StopSession 的 schema、提示词和错误文案，确保直接契约通道校验不被命名替换破坏。
- [ ] 更新引用会话、组背景和子会话摘要相关工具，确保其按 Harness transcript 正确读取父/兄弟会话。
- [ ] 执行 `bun run build:electron`，手动验证组摘要可处理新 pi 会话、source fidelity 可查证真实 UUID、创建子会话后可立即收发和停止。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- transcript adapter 的公开接口、UUID 与 mtime 口径：
- 已迁移的摘要/引用工具：
- delegation 的最终 sessionId 协议与同步创建行为：
- 已删除的 SDK transcript/delegation 依赖：
- 下个 step 入口：
- 待办或已知限制：
