---
step: 2
title: failover 提示改造
status: done
---

## 目标

failover 切换时的视觉体验干净：续跑提示不再像用户手打的机器指令，横幅单条可关闭，quota 失败不再先弹系统通知 + 红色 429 Alert 吓人。

## 依赖上下文（接力棒输入）

- 调查报告（共享区 `failover-investigation.md`）§3：
  - 续跑提示 `buildFailoverContinuePrompt`（`model-failover.ts:27-29`）经 sendMessage 持久化为普通 user 消息，前端在 `ContentBlockItem.tsx:363-379` user 分支与普通消息同款渲染
  - 横幅：`components/agent-chat/AgentChat.tsx:507-518`，amber 色带，store 侧 `conversation-store.ts:813-817` slice(-5) 最多堆 5 条，无关闭无过期，纯内存态
  - 失败噪音前置链：complete(failed) → 系统通知（`electron/main/tipc/agent.ts:66-103`）+ 红色 Alert 含 429 JSON 技术详情（`ContentBlockItem.tsx:334-360`），时序在 failoverNotice 之前
- Step 1 已完成：failoverNotice 现在会触发重连。

## 计划改动

- [x] **续跑提示标记**：已验证 pi harness 落盘链路不支持 metadata——pi-ai `UserMessage` 是封闭接口 `{role, content, timestamp}`（types.d.ts:274-278），`Session.appendMessage` 虽按原样序列化 message，但附额外字段违反类型契约且无类型安全 → 走哨兵前缀方案
  - `model-failover.ts` 新增 `FAILOVER_CONTINUE_SENTINEL = '[system:failover-continue]'`，`buildFailoverContinuePrompt` 输出带前缀文本
  - 前端识别不在 `ContentBlockItem.tsx`（其 user 分支实际是死路径）而在真实渲染路径 `MessageItem.tsx`：哨兵消息渲染为系统提示条（虚线边框 muted 样式，参照 compact boundary 色调），剥掉哨兵不显示；`isSdkInjectedUserMessage` 扩展纳入哨兵，自动获得不进 sticky 气泡 / 不算轮次头 / 不进 Minimap 的语义
  - 双端常量镜像：前端 `lib/failover-markers.ts` + model-failover.test.ts 一致性守护测试（electron rootDir 限制无法共享模块）
- [x] **横幅单条化**：`conversation-store.ts` pushFailoverNotice 改为同会话只保留最新一条；新增 `dismissFailoverNotice(conversationId, at)`（at 身份校验防旧计时器误杀新横幅）与 `failoverNoticeTtlMs` 状态（默认 60s，测试可调）；push 时 schedule 自动过期 setTimeout；`AgentChat.tsx` 横幅加 X 关闭按钮
- [x] **quota 失败降噪**：
  - 系统通知：`tipc/agent.ts` 广播钩子重构——complete(failed) 的通知延后到 `maybeFailoverMainSession` 返回后，返回 true（已接管）则跳过、false（未开启/链耗尽/编排失败）照发；success/cancelled/permissionRequest 通知时序不变（选了「延迟发送」方案，对编排零侵入）
  - 红色 Alert：`ContentBlockItem.tsx` error 分支提取为 `ErrorAlertBlock`，命中「isQuotaErrorText + hasFailoverTakeover（notice 在错误后 60s 窗口内）」时降级为一行 muted 摘要，不展开 429 JSON
  - 持久化判定依据：验证后不需要——history-adapter 不导出 errorMessage，重开会话的历史里本就无错误 Alert（空 assistant 消息），红色 Alert 只存在于内存 live tail，而该处 failoverNotice 内存态可用
- [x] **链耗尽保留报错**：maybeFailoverMainSession false → 通知照发（C1 链路）+ 无 notice → Alert 不降级（C2 链路），既有测试「transient / 开关关闭 / 链耗尽不触发」续过

## 验证

- 手动：构造 quota 错误（临时放宽判定）走一遍切换，确认无系统通知、无红色 Alert、只见单条横幅 + 系统条样式的续跑提示——**未做（计划允许跳过）**，建议实机回归时补验；逻辑层已由单测覆盖（哨兵一致性 / 横幅生命周期 / 接管窗口判定）
- lint / 既有测试 / build:renderer / build:electron：全部通过（详见实施回填）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 哨兵识别位置：计划写 `ContentBlockItem.tsx`，实际 user 消息渲染路径是 `MessageItem.tsx`（ContentBlockItem 的 `case 'user'` 在现有数据流中不会被创建——wechat-bot 路径直接建 Message，message_id 不物化文本），按意图而非字面实施
  2. 「持久化判定依据」（错误后紧跟哨兵续跑消息降级历史 Alert）验证后不需要：history-adapter 不导出 errorMessage，历史里没有错误 Alert 可降级；哨兵只服务于续跑提示自身的系统条渲染
  3. 横幅自动过期的 setTimeout 放在 store 的 pushFailoverNotice 里而非 AgentChat 组件（组件卸载/多窗口场景下行为一致，且可测）；TTL 做成 store 状态 `failoverNoticeTtlMs` 供测试注入
- 改动文件清单：
  - `electron/main/agents/model-failover.ts`：FAILOVER_CONTINUE_SENTINEL 常量 + buildFailoverContinuePrompt 加哨兵前缀
  - `electron/main/tipc/agent.ts`：广播钩子重构——failed 通知延后到 maybeFailoverMainSession 返回后决定发不发
  - `lib/failover-markers.ts`（新增）：哨兵/判额关键词/接管窗口的渲染层镜像纯函数
  - `lib/failover-markers.test.ts`（新增）：纯函数单测 7 例
  - `components/agent-chat/utils.ts`：isSdkInjectedUserMessage 纳入哨兵；getUserMessageSearchableText 排除哨兵消息
  - `components/agent-chat/MessageItem.tsx`：FailoverContinueNotice 系统提示条组件 + 哨兵分支前置
  - `components/agent-chat/ContentBlockItem.tsx`：error 分支提取为 ErrorAlertBlock，quota+接管时降级一行摘要
  - `stores/conversation-store.ts`：pushFailoverNotice 单条覆盖 + dismissFailoverNotice + failoverNoticeTtlMs + 自动过期，reset 同步
  - `components/agent-chat/AgentChat.tsx`：横幅 X 关闭按钮
  - `electron/main/agents/model-failover.test.ts`：哨兵断言 + 双端一致性守护测试
  - `stores/conversation-store.test.ts`：横幅单条覆盖/关闭/过期 3 例

### 验证结果
- `bun test` 全量：113 pass / 9 fail（基线 102/9 + 新增 11 全过；9 个失败均为既有 mock 污染模块级 SyntaxError，集合与 step1 基线一致）；usage-service 单文件仍 4 pass / 1 fail（既有 toolCallCount）
- `bun run lint`：0 errors / 74 warnings（= 基线）
- `bun run build:renderer`：✓ built in 28.77s
- `bun run build:electron`：✓（主进程改动需重启 Electron 生效）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `FAILOVER_CONTINUE_SENTINEL = '[system:failover-continue]'`（双端镜像：model-failover.ts / lib/failover-markers.ts，一致性由 model-failover.test.ts 守护）
  - `lib/failover-markers.ts`：`isQuotaErrorText(text)` / `isFailoverContinueMessage(content)` / `stripFailoverContinueSentinel(content)` / `hasFailoverTakeover(notices, errorTimestamp)`（60s 窗口 + 2s 容差）
  - store：`dismissFailoverNotice(conversationId, at)`、`failoverNoticeTtlMs`（push 时调度 setTimeout 自动 dismiss，at 身份校验）
  - 主进程：complete(failed) → `maybeFailoverMainSession(...).then((tookOver) => { if (!tookOver) 通知 })`
- 下个 step 该从哪里继续：
  - 症状 A（usage 三子问题：turnIndex 续号 / 0-token 失败快照 / lastContextSize 口径）见 plan 后续 step；改造 pi-session.ts 时注意 quota 失败轮的 emitRunFailure 空消息仍会在重开后渲染为空 assistant 消息（紧邻哨兵续跑条，观感可接受但未处理）
  - 实机回归清单：构造 quota 错误验证「无系统通知 + Alert 一行摘要 + 单条可关闭横幅 + 历史里系统条样式续跑提示」
- 待办或已知限制：
  - live tail 中错误 Alert 先红后降级的短暂闪现（notice 在 failover 编排完成后才到，约 1–3s）：要在主进程抑制错误事件本身才能消除，侵入性大未做
  - 存量旧会话里已持久化的无哨兵续跑消息仍按普通用户气泡渲染（不迁移）
  - 哨兵前缀会随提示文本进入 LLM 上下文（对模型无害，但若后续想隐藏需改 harness 消息构造层）
