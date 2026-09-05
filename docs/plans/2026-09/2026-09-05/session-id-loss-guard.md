# sessionId 丢失防护：attach 防线 + txn 审计

## 背景

2026-09-05 复发 2026-08-19 已知 bug（见 `electron/main/services/session-id-repair.ts` 头部注释）：conversation 的 `sessionId` 被未知写操作置空，覆盖者至今未定位。本次事件完整后果链（证据已归档在调查会话）：

1. 子会话正常创建运行（真实 harness `01a071f6`，245KB 消息，交付完成）
2. `sessionId` 被覆盖为 null
3. UI 点开子会话 → `attachConversation` 发现 `sessionId=null` → 误判新会话 → **新建 225 字节空壳 harness 并回写** → 真实实体成孤儿
4. 之后 UI 显示空、`ReadReferenceSession` 读 0 条、SendMessage 报「会话未初始化」

现有启动自愈（±2s 时间对齐回填）接不住：只在启动时跑，且空壳 id 上位后（非 null）永不触发。

本次只做防护与观测，不修存量数据（用户拍板放弃 `c25e5f30` 数据修复）。

## 改动 A：attach 防线（堵死「空壳覆盖」二次伤害）

文件：`electron/main/services/conversation-runtime-service.ts`、`electron/main/services/session-id-repair.ts`

1. **提取单会话对齐函数**：从 `session-id-repair.ts` 的批量扫描逻辑中提取 `findAlignedHarness(workspaceId, createdAtMs, takenSessionIds)`（±2000ms 窗口、未被占用、取时间最近），导出供两处共用。保持既有决策：直接扫 `sessions/<flat-cwd>/` 文件名解析，**不经 PiSessionRepository.list**（其 cwd 过滤行为不一致）。
2. **attachConversation 新建分支前加防线**（`conversation-runtime-service.ts` 约 L97 处，进入 else 新建分支之前）：
   - 触发条件：`!conversation.sessionId && (conversation.usageSummary?.turnCount ?? 0) > 0`——有历史轮次但 sessionId 丢失（首 attach 的 turnCount 为 0，天然不误触）
   - 命中后：取当前工作区已占用 sessionId 集合 → `findAlignedHarness` 对齐 → 找到则先 `updateSessionId` 回填，再以 `harnessSessionId=该 id` 走 open 恢复（isRestore 语义按 true 处理，失败报「会话历史文件缺失或损坏」）
   - 找不到对齐文件：logger.warn 记录后照旧走新建（不阻断，退化现状行为）
3. 测试（bun test）：
   - 「sessionId null + turnCount>0 + 存在对齐 harness」→ attach 走恢复，不新建、conversation.sessionId 被回填
   - 窗口内多候选（模拟 CreateSessionBatch 相近创建）→ taken 过滤 + 最近匹配正确
   - 无对齐候选 → 降级新建 + warn，不抛错
   - turnCount=0 的首 attach 行为不变（不触发防线）

## 改动 B：txn 审计（抓覆盖者）

文件：`electron/main/services/conversation-service.ts`（`withConversationsTxn`）

1. txn 内 save 前：对比读入时的原始快照与修改后的 `file.conversations`，任一会话 `sessionId` 从 truthy 变 falsy → 用 `electron/main/agents/logger.ts` 的 logger（WARN 级别落 `.dogear/logs/dogear-YYYY-MM-DD.log`）记录：
   - conversationId、title、**被清空前的 sessionId 原值**（可直接用于人工回填）
   - `new Error().stack`（定位覆盖者调用链）
2. 只观测不阻断；当前代码无合法置空路径（updateSessionId 只赋值、createFork 赋新值），预期误报为零，若日志出现合法场景再收敛。
3. 测试：常规写入不触发；模拟置空 sessionId 的 txn 触发一次 warn 且不阻断写。

## 不做

- 不修存量 `c25e5f30` / 不删空壳文件（用户拍板）
- 不动 delegation/SendMessage 链路（症状随防线与根因修复自然消失）
- 不做全量启动自愈的窗口/时机调整（现有逻辑保留，仅被复用）

## 验收

- `bun test` 相关用例全绿；`bun run lint` 通过
- 手工路径：临时把某测试会话 json 的 sessionId 置空 + turnCount>0 → attach → 会话内容恢复可见、无空壳产生；恢复测试数据
- 审计埋点验证：测试用例覆盖（真实覆盖者出现依赖复发，埋点常设）
