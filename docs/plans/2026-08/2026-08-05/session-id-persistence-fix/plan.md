# 会话 session ID 持久化修复 实施计划

**目标**：sessionId 成为会话唯一持久标识（创建后永不更改），删除 sdkSessionId 遗留字段，修复已损坏的数据。

**架构思路**：open/create 决策严格二分——sessionId 有值走 open（失败即报错不 fallback），null 走 create（写一次后永不再改）。onHarnessSessionCreated 回调删除，写入职责移到 attachConversation。sdkSessionId 字段及全部引用清除，存量数据一次性迁移。

**涉及模块**：conversation-runtime-service / conversation-service / pi-session / pi-session-repository / delegation-bridge / delegation-tools / tipc/agent / tipc/conversations / group-digest-scanner / topic-lifecycle-service / migration

**设计文档**：[design.md](./design.md)

## 步骤索引

- [x] [Step 1: sessionId 写入逻辑修改 + onHarnessSessionCreated 回调删除](./step1-session-id-write.md) — 核心修复：attachConversation 里 create 后直接写 sessionId，PiSession.start() 删除回调
- [x] [Step 2: 删除 sdkSessionId 字段及全部引用](./step2-remove-sdk-session-id.md) — 清除类型定义、运行时代码、前端引用
- [x] [Step 3: 存量数据迁移 + 损坏数据修复](./step3-migration-repair.md) — sdkSessionId 合并到 sessionId、修复空壳指针、清理空壳 jsonl

## 全局决策

- **sessionId 语义**：创建时写入，之后永不变更，直到会话被删除。不存在"中途换 session"的合法场景。
- **open 失败不 fallback**：session 文件损坏/缺失时直接报错，不静默 create 新 session。错误信息对用户友好（"会话历史文件缺失"）。
- **sdkSessionId 彻底删除**：不保留向后兼容字段，一次性迁移（`sessionId ?? sdkSessionId` 兜底，然后删 sdkSessionId）。
- **onHarnessSessionCreated 回调删除**：create 后的 sessionId 写入由 attachConversation 在 start() 返回后执行，不再通过回调。
- **Harness 不改**：全部修改在我们的封装层（PiSessionRepository / PiSession / conversation-runtime-service）。
