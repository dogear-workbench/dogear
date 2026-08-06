# 话题级协作监督与通知融合设计

**背景**：主子会话协作当前依赖 Agent 自觉调用 `SendMessage(delivery: true)`、`WaitForMessage` 和 `ListLinkedSessions`。子会话无正式交付即停止时，父会话只能等超时；`childStates` 是进程内 Map，应用重启后列表与部分发现能力丢失。Windows 通知方案已覆盖主会话停止和权限请求，但尚未承接协作异常的监督决策。

**目标**：以话题（group）为边界建立无 LLM 的主进程监督器，持久记录委派与异常，修复契约通道身份和重启恢复问题；子会话失败、取消、超时或未正式交付时立即唤醒父会话，并在父会话不能自动处理时复用 Windows 原生通知提醒用户。话题根目录提供只读共享上下文，`shared/` 保持唯一可自由写入的协作区。

## 已确认根因

1. `delegation-bridge.ts` 当前将 `attachConversation()` 返回的 Pi 运行时 ID 写入 `ChildStateSnapshot.sessionId` 并返回给 Agent（`:267`）；但 `contract-channel-service.ts:12` 用输入 ID 在持久化 `conversation.sessionId` 中查找，后者保存的是 Harness session ID（`conversation-runtime-service.ts:109`）。两种 ID 混用会导致目标会话或契约通道查找失败。
2. `startChild()` 在父 conversation 尚无 `sessionId` 时仍创建子会话，且有意省略 `contractMetadata`（`delegation-bridge.ts:198`）。该子会话永久缺少父子契约溯源。
3. `ListLinkedSessions` 的父会话分支只读取进程内 `childStates`（`delegation-tools.ts:151`）。重启后 Map 清空，即使持久化契约仍存在，也无法列出关联会话。
4. `onSessionComplete()` 会将未调用正式交付的子会话标记为 `failed`、`cancelled` 或 `no_delivery`（`delegation-bridge.ts:152`、`delegation-lifecycle.ts:8`），但不向父会话的 `WaitForMessage` 投递终态，父会话只能等自身超时。

## 架构

新增一个进程级 `DelegationSupervisor` 单例，按 `workspaceId + groupId` 维护惰性创建的话题监督上下文；它不是 Agent 会话、不调用模型、不常驻独立线程。每个话题的持久化状态落在：

```text
<configDir>/workspaces/<workspaceId>/groups/<groupId>/
  shared/             # 唯一允许组内 Agent 自由读写的协作产物
  digest.md           # 摘要服务维护，只读上下文
  background.md       # 背景服务维护，只读上下文
  supervision.json    # 监督器维护，只读上下文
```

`supervision.json` 使用现有 `getGroupDir()` 和 `safeJsonRead` / `safeJsonWrite` 保存，最少包含 schemaVersion、未终结委派记录、最近监督事件和事件保留上限。委派记录保存父/子 conversationId、统一后的 Harness sessionId、任务、预期输出路径与开始时间；监督事件保存事件 ID、类型、时间、父/子 ID、终态、是否已唤醒父会话、是否已向用户通知、解决时间。最近事件数量有上限，避免话题长期使用无限增长。

持久化 conversation 及其 `contractMetadata` 仍是契约关系的事实来源；监督文件记录运行与异常审计，不复制或替代契约权限校验。

## 契约身份与重启恢复

对 Agent 工具、`contractMetadata.parentSessionId`、`conversation.sessionId`、`SendMessage`、`WaitForMessage` 和 `ListLinkedSessions` 统一使用 Harness session ID。PiSessionManager 的运行时 ID 仅留在运行时管理和 attachment 生命周期中，不能出现在 Agent 可见的子会话快照或跨会话工具参数里。

`startChild()` 创建前必须获得父会话的 Harness session ID：优先读取持久化 conversation，缺失时可从当前绑定的 PiSession 取得 Harness ID 并补写；仍不可得时拒绝创建并返回可重试错误。不得创建没有 `contractMetadata` 的子会话。

父会话的 `ListLinkedSessions` 需要从持久化 conversation 的 `parentConversationId` / `contractMetadata` 查询关联子会话，不能以 `childStates` 是否仍在内存为前提。重启后，监督器启动或首次访问话题时读取未终结委派；将因进程终止而没有终态的记录写为 `app_restarted` 监督事件，保留审计并让后续进入该话题的父会话可获知。不会尝试伪造或自动恢复已不存在的 Pi runtime。

## 监督、父会话唤醒与通知

`delegation-bridge` 仍拥有实时 child 状态迁移和 attachment 释放。在子会话首次进入终态时，bridge 将标准化事件交给对应话题监督器：

- `done`：正式交付已经通过原有 `SendMessage(delivery: true)` 送给父会话；监督器仅记录终态，不发异常提醒。
- `failed` / `cancelled` / `timeout` / `no_delivery`：监督器先原子写入事件，再向父会话投递受信任的监督消息。父会话若正在等待该子会话，立即 resolve 对应 `WaitForMessage`；若未等待但仍有活动 PiSession，则将消息排入下一轮；不可达时记录为“父会话不可自动处理”。
- `app_restarted` / `contract_unavailable`：不能依靠 Agent 自动恢复，记录为需要用户处理的监督事件。

为使等待返回结果不伪装成正式交付，`WaitForMessageResult` 应从布尔 `delivery` 扩展为来源类型，例如 `message | delivery | supervision`，渲染给 Agent 的文字明确标示“监督告警”。内部监督投递不走普通 Agent 工具的契约校验，但只允许 supervisor 向该子会话的持久化父会话发送，不能成为任意会话通信旁路。

Windows 通知服务保持纯输出职责。监督器只在父会话不可自动处理、契约建立失败、应用重启遗留任务等需用户决策的事件上调用它，通知目标始终是父会话；点击后恢复并定位父会话。若父会话正在等待，先由 Agent 自动处理，随后该主会话停止时仍按既有“主会话停止”规则提醒，避免对子会话异常和父会话完成重复轰炸。

## 共享区访问边界

`shared/` 保持现有 `ListGroupFiles` / `ReadGroupFile` / `WriteGroupFile` 的读写根目录，子会话交付与普通协作文件可随意修改。`digest.md`、`background.md`、`supervision.json` 位于话题根目录，属于只读共享上下文：可展示、查看和由授权的专用读取能力引用，普通 Agent 不得通过 `WriteGroupFile` 修改。摘要、背景、监督服务分别拥有对应文件的唯一写权。

话题共享区 UI 应以整个话题目录为视图范围，展示 `shared/` 与根目录系统文件；系统文件标记“只读 / 系统维护”，协作区标记“可写”。第一版至少提供只读查看，编辑仅保留给 `shared/` 内容。

## 模块边界

- `electron/main/services/delegation-supervision-store.ts`：话题级 `supervision.json` 的 schema、迁移/归一化、原子读写、事件裁剪。
- `electron/main/services/delegation-supervisor.ts`：按话题的登记、终态监督、重启恢复、父会话可达性判断、通知决策；不持有 PiSession 的业务生命周期。
- `electron/main/agents/delegation-bridge.ts`：修复 Harness/runtime ID 边界；在创建、交付、终态时调用监督器；提供受限的内部监督投递入口。
- `electron/main/services/contract-channel-service.ts`、`electron/main/services/conversation-service.ts`、`electron/main/agents/tools/delegation-tools.ts`：使用持久化 Harness ID 和父子索引恢复直接契约通道。
- `electron/main/services/session-notification-service.ts`（由既有 Windows 通知计划新增）：消费监督器的用户介入事件，负责 Toast、声音、任务栏闪烁与点击定位；不包含协作判断。
- `electron/main/services/group-shared-service.ts` 及共享区 UI：保持 `shared/` 写入隔离，同时列出话题根目录的只读系统文件。

## 错误处理与边界

- 监督写盘失败、通知不可用或 parent PiSession 不存在时，绝不阻塞子会话终态、输出路径释放或 attachment 清理；记录日志与未通知事件，等待后续查看。
- 用户停止子会话与自然失败必须产生不同终态，但都应唤醒等待父会话；`no_delivery` 同样属于监督异常。
- 同一 child 的首次终态只能产生一次监督事件和一次唤醒，保证 `onSessionComplete`、超时和停止路径并发时幂等。
- 归档/删除话题时，应随组目录统一删除监督文件；恢复话题后可读取历史事件，不自动恢复已终结会话。
- 普通会话、后台摘要/分类任务不进入话题协作监督范围。

**未决问题**：第一版共享区 UI 是否只展示系统文件，或允许用户通过专用管理界面手动标记监督事件为“已处理”；默认仅展示，事件解决状态由父会话自动处理或后续专用入口更新。