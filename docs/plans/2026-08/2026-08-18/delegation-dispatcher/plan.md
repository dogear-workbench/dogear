# 子会话调度站（Delegation Dispatcher）实施计划

**目标**：把 delegation-bridge 从「一次性派遣运行时」升级为持久调度站——子会话死亡秒级唤醒等待方、自动复活重调（含跨供应商降级）、重启后派遣关系不失忆。

**设计文档**：[../delegation-dispatcher-design.md](../delegation-dispatcher-design.md)（背景、架构权衡、排除选项见此，本文只管怎么落地）

**架构思路**：全部在主进程事件驱动（PiSession 事件 + setTimeout），零轮询零新进程。检测/重调/降级在代码层，主会话只收结构化通知做高层决策。

**涉及模块**：
- `electron/main/agents/delegation-bridge.ts`（核心改造）
- `electron/main/agents/tools/delegation-tools.ts`（工具层）
- `electron/main/types.ts` + `types/delegation.ts`（类型波及）
- 前端 childStatus 消费组件（新状态值展示）
- 新增存储：`.dogear/delegation-state.json`

## 步骤索引

- [x] [Step 1: 检测层——终态联动 + 滑动 idle 计时](./step1-detection.md) — 子会话死亡秒级唤醒等待中的主会话，hang 无进展检测
- [ ] [Step 2: 重调层——错误分类 + resumeChild 复活 + 跨供应商降级链](./step2-resume.md) — 死亡后自动复活原会话续跑，费率错误自动换异供应商
- [ ] [Step 3: 持久层 + 工具层——状态落盘 + ListLinkedSessions 合并 + ResumeSession](./step3-persistence-tools.md) — 重启不失忆，主会话可调起中断的子会话
- [ ] [Step 4: 前端状态展示 + 回归走查 + 文档同步](./step4-regression.md) — 新状态值 UI、全链路验收

## 全局决策

**已钉死的技术前提**（排查/设计阶段确认，不要重新调研）：
- 流事件：`convertPiEvent`（`pi-session/message-converter.ts:19`）覆盖 text_delta / thinking_delta / tool_execution_start / tool_execution_end，全部走 `emit('message')` —— **idle 打点挂现有 `session.on('message')` 即可，PiSession 零改动**。唯一空窗是单个工具执行中（无 delta），靠 idle 阈值 ≥10 分钟兜底
- 供应商判定：`ModelSelection = { profileId, tier }`（`settings-types.ts:10`），**profileId 即供应商代理**（一个 ModelProfile 一套 apiKey/baseUrl）。异供应商 = profileId 不同
- 降级模型注入：resumeChild 内先 `conversationService.updateModelSelection(...)`（已事务化）再 `attachConversation`（attach 读 conversation.modelSelection）——**不改 attachConversation 签名**
- conversation-service 已有 `withConversationsTxn`（2026-08-18 commit 7b25587），delegation-state.json 落盘沿用同款锁纪律（读改写 + `withFileLock` + `#txn` 后缀锁键）

**命名与常量**：
- `DelegationErrorClass = 'transient' | 'quota' | 'cancelled'`（新增，bridge 内部）
- ChildStatus 新增值：`'hang'`、`'interrupted'`（现有 running/done/failed/cancelled/timeout 不动）
- idle 阈值：常量 `IDLE_TIMEOUT_MS = 10 * 60_000`（不进设置页）
- 重试上限：常量 `MAX_RETRY = 2`（transient 类；quota 类降级一次后仍 quota 则视为耗尽）
- quota 关键词表（对 `error.message` 小写匹配）：`429 / rate limit / rate_limit / quota / insufficient / balance / 余额 / 限流 / 额度`

**关键时序（Step 1/2 都要遵守）**：
- 终态处理顺序：`onSessionComplete` → 错误分类 → **重调优先于通知**：决定 resume 则状态回 running、不 resolve waiter；不重调（耗尽/用户取消/no_delivery）才 resolve waiter 带结构化 terminal 信息
- `done`（正常交付）不通知——交付消息本身经 deliverMessage 唤醒 waiter

**通知结构**（`WaitForMessageResult` 扩展，向后兼容）：
```ts
terminal?: {
  status: ChildStatus; errorMessage?: string;
  errorClass?: DelegationErrorClass;
  attempts: number;        // resume 尝试次数
  modelTried: string[];    // profileId:tier 列表
}
```

**继续提示模板**（resumeChild 发给子会话的固定文案）：
> 你刚才因{原因}中断。请检查已完成的部分和共享区已有的产出（若 outputPath 已有部分内容，先读取确认进度），从中断处继续完成任务，不要从头重做。
