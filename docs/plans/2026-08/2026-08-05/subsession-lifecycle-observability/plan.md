# 子会话生命周期与可观测性实施计划

**目标**：让子会话在创建、运行、晚打开、失败、交付、取消和超时全过程都有正确且可解释的状态，消除“只有任务问题、看不到 Agent 运行”的表象。

**架构思路**：以 `PiSession` 每轮执行的结构化终态为唯一事实来源，先立即广播运行态，再在 Harness 结算后向委派桥接层交付成功或失败结果。桥接层只根据该结果写 child status 并在安全结算点释放运行时；前端只消费后端状态事件和快照。排除“仅给前端加乐观 loading”方案，因为它无法覆盖后台派遣、晚加入窗口、模型失败和应用重启。

**涉及模块**：`pi-session.ts`、`pi-session-manager.ts`、`conversation-runtime-service.ts`、`tipc/conversation-runtime.ts`、`delegation-bridge.ts`、`tipc/delegation.ts`、共享 delegation 类型、conversation store、AgentChat、会话行、历史/消息 hooks、会话运行规则。

## 步骤索引

- [x] [Step 1: PiSession 状态与终态模型](./step1-pi-lifecycle.md) — 立即发布运行态，并把模型错误变成结构化执行失败。
- [ ] [Step 2: 委派桥接与前端状态呈现](./step2-bridge-ui.md) — 让 bridge 按真实终态结算，前端展示运行、失败和未交付。
- [ ] [Step 3: 回放回归、验收与协作规则](./step3-verification-rules.md) — 验证晚打开/快速切换场景，并固化派遣前后检查规则。

## 全局决策

- `sessionStateChanged` 是运行态唯一权威来源；前端不得为后台子会话乐观修改 `runningConversationIds`。
- 只有任务正常结算且未发送 `delivery:true` 时才允许状态为 `no_delivery`；模型错误、启动异常和运行错误必须为 `failed` 并携带原因。
- 子会话 attachment 不得在 `SendMessage(delivery:true)` 中途释放，必须等待当前 prompt 安全结算。
- 晚打开窗口必须通过 runtime live snapshot 重放进行中消息和权限请求，并由现有 reducer 去重。
- 已验证普通会话在当前渲染进程中不再出现 `historyLoaded` 白屏；该场景仍是每次改动的回归项。
- 每一步完成后必须回填对应 step 的“实施回填”和接力棒，再执行下一步。
