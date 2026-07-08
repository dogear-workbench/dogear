# Agent 协作模式设计

## 背景

现状：子会话通过 `DelegateTo` 派出后，UI 上完全不可见。主会话只能通过 `WaitForDeliveries` 拿到最终交付物（shared 区文件 + 摘要），中间的对话流、工具调用、agent 思考过程都看不到。父子之间只有后台的 `childId` 关联，用户无法介入、无法追溯、无法在 agent 出错时纠偏。

用户想让 agent 协作的过程变可见、可介入。同时不希望在 UI 层引入"主子/父子"的从属心智，因为：

1. 已经有「会话组」作为协作枢纽，再叠一层父子树 = 双轨制心智撕裂
2. 用户的哲学是**信任 agent 组队协作**，用户是"教练"不是"父 agent 的驾驶员"
3. 将来可能加更多角色（轮询代理、定时代理），特权化"主/子"结构不利于扩展

## 目标

- Agent 派出的会话成为组内**一等公民**，UI 上跟手动会话平级呈现
- **不引入主子心智**——列表、Tab、消息流都不体现"父子从属"，纯粹是"一堆 agent 在协作"
- 用户能随时看到任何会话在做什么，能进任何会话补一句话
- Agent 之间通信通过**契约通道**约束（派出关系 = 通信通道），避免组内任何会话乱互发
- 派出的溯源信息**存但不显眼**——列表用图标区分足矣，会话内顶部一行小字兜底

## 架构

### 核心模型转变

**旧模型**：主会话 → 子会话（父子树），子会话 UI 不可见，只有 delegation-tools 后台通道通信。

**新模型**：所有会话平摊在**组**里，agent 派出的新会话跟手动会话是同级公民。派出关系记在 metadata 里（`contractMetadata`），作为**通信通道许可**和**UI 溯源信息来源**，但不体现为父子从属。

### 数据模型

在 `Conversation` 类型上新增字段：

```ts
interface ContractMetadata {
  parentSessionId: string;        // 派出者的 sdkSessionId
  task: string;                   // 派出时的任务描述
  expectedOutputPath?: string;    // 预期交付路径（shared 区相对路径）
  createdBy: 'agent' | 'human';   // 创建来源（用于列表图标区分）
}

interface Conversation {
  // ... 原有字段
  contractMetadata?: ContractMetadata;  // agent 派出的会话有；手动创建的没有
}
```

`createdBy` 字段是列表图标区分的唯一依据。派出者被删除时，`parentSessionId` 变成孤儿引用，代码兜底显示为"派出者已删除"。

### 通信边界（契约通道）

规则：**两个会话之间存在派出关系（直接或间接）→ 建立契约通道，允许双向发消息；无派出关系 → 不能互发**。

- 手动会话之间：无契约通道，不能互发（如需协作走 shared 文件）
- Agent 派出的会话 ↔ 派出者：有通道，双向
- Agent A → agent B → agent C 链：A-B、B-C 有通道，A-C 无直接通道（想通信要走 B 中转，或走 shared 文件）

通信通道的实现是**语义层校验**，不是物理隔离——tipc 层收到 SendMessage 时校验 metadata 中的派出关系。

### UI 呈现

**列表（组内会话）：**
- 组内会话全部平铺，无缩进无分组线
- 排序规则：
  - 手动会话按 `updatedAt` 时间倒序
  - Agent 会话按 DFS 顺序紧跟派出者（`A → B → C → D` 中 B 派 C，则列表显示 `A, B, C, D`）
  - 派出者被删除 → agent 会话回落自然时间序
- 图标区分：
  - 手动：`MessagesSquare`（lucide）
  - Agent：`Bot`（lucide）
  - 完成状态**不做视觉区分**（agent 会话完成后跟运行中长得一样，靠打开看内容判断）

**Tab：**
- 完全平铺（当前 `session-store.tabs[]` 结构直接吃下）
- 任何会话点击都能开 tab，主/子/agent 全平级
- 子会话启动**不自动激活 tab**（只加进 `tabs[]` 后台运行，避免打断当前操作）
- 无派出关系 chip，无血缘条

**会话内部：**
- 顶部一行溯源小字（仅 `contractMetadata` 存在时显示）：`由 [XX 会话名] 派出：[task]`，可点跳转到派出者会话
- 派出者已删除 → 显示"派出者已删除（原任务：xxx）"
- 消息 `sender` 增加类型区分：
  - `human`：用户手打，显示用户头像
  - `agent:<sessionId>`：其他会话的 agent 通过契约通道发来，显示 agent icon + 来源会话名
- 用户可以进任何 agent 会话直接打字（作为 human 消息插入流中），介入不受限

### 命名

Agent 派出会话时的 `title`：
- 优先取 `DelegateTo` 调用的 `title` 参数（父 agent 自己起）
- 兜底：`task.slice(0, 30)`

## 模块边界

**数据层：**
- `types/electron-api.ts` — `Conversation` 加 `contractMetadata` 字段
- `electron/main/services/conversation-service.ts` — CRUD 支持新字段；提供 `getBySessionId(parentSessionId)` 查派出者信息
- `electron/main/services/conversation-runtime-service.ts` — 派出新会话时写入 `contractMetadata`

**通信层：**
- `electron/main/agents/tools/delegation-tools.ts` — 保留现有工具语义，但内部实现改为"创建平级会话 + 建立契约通道"，工具名和参数保持兼容
- 新增契约通道校验：SendMessage 之类的 IPC 收到时查 metadata

**Store 层：**
- `stores/conversation-store.ts` — 加载会话时按 DFS 规则排序（新增排序纯函数）
- `stores/session-store.ts` — Tab 平铺（现有结构不动）

**UI 层：**
- `components/ConversationList.tsx` + `conversation-list/ConversationRow.tsx` — 图标按 `contractMetadata.createdBy` 区分
- `components/agent-chat/AgentChat.tsx` — 顶部新增溯源条组件（仅有 `contractMetadata` 时显示）
- `components/agent-chat/MessageItem.tsx` — `sender` 视觉区分 human vs agent（agent 消息显示来源）
- `components/agent-chat/hooks/useSendMessage.ts` — 允许用户在任何会话内发 human 消息（当前应已支持，需确认 agent 会话也能接受用户输入）

**排序工具函数：**
- 新建 `lib/conversation-sort.ts` — 纯函数：`sortConversationsWithDFS(conversations)`，接收原始列表，按规则输出排序后的列表。派出者缺失的兜底逻辑集中在这里。

## 数据流

**Agent 派出新会话：**
1. Agent 调用 `DelegateTo({ task, outputPath, title? })`
2. `delegation-tools` → `conversation-runtime-service` 创建新 `Conversation`：
   - 同 `workspaceId`、同 `groupId`
   - `contractMetadata = { parentSessionId: <caller sdkSessionId>, task, expectedOutputPath: outputPath, createdBy: 'agent' }`
   - `title = title ?? task.slice(0, 30)`
3. 启动新 `QueryBasedSession`，发送 initial message（task 内容）
4. 前端订阅到 `conversationCreated` 事件 → `conversation-store` 重新拉列表 → 按 DFS 排序 → 列表出现新 agent 会话紧跟派出者
5. Tab 不自动激活（tabs[] 后台增加，但 `activeTabId` 不变）

**Agent 会话之间通信：**
1. Agent 调用 `SendMessageToChild({ childId, message })` 或未来的通用 `SendMessage({ toSessionId, message })`
2. tipc 层校验：`toSession.contractMetadata.parentSessionId === fromSession.sdkSessionId` 或反向
3. 校验通过 → push 到目标会话的 `pendingMessages` 队列，触发下一轮回应
4. 校验失败 → 返回错误，agent 得到反馈

**用户介入 agent 会话：**
1. 用户点列表任意 agent 会话 → Tab 激活
2. 用户在输入框打字发送 → 作为 `human` sender 消息插入流
3. Agent 收到后继续对话（跟人交互无差别）

**Agent 交付完成：**
1. Agent 调用 `SubmitDelivery` 或写 shared 文件 + 通过契约通道发消息通知派出者
2. 派出者会话收到消息，UI 上就是普通消息
3. Agent 会话本身**不改变 UI 状态**，继续留在列表（用户可翻回看）

## 错误处理 / 边界情况

- **派出者被删除**：agent 会话孤儿。`contractMetadata.parentSessionId` 无对应记录 → 排序回落时间序 + 会话顶部溯源条显示"派出者已删除"
- **Agent 会话被删除**：跟着删就删了；派出者失去通信通道，之后再调用 SendMessage 返回错误"目标会话不存在"，agent 需要处理
- **契约通道违规**：非通道会话尝试互发消息 → 返回明确错误，agent 应停止尝试
- **循环派出**：Agent 派 Agent 派 Agent 派... 数据层不限制（信任 agent），但可在派出深度 ≥ 5 时打日志警告
- **会话归档**：agent 会话跟手动会话一样各管各的归档，UI 不联动
- **组间移动**：会话组可以整组移动到文件夹，agent 会话跟着组走（因为它就在组里）
- **列表滚动位置**：切换会话时的 UI 状态保留是 Tab 层的实施细节，见未决问题

## 未决问题

1. **通信 API 是否重构**：现有 `delegation-tools` 有多个专用工具（`DelegateTo`/`SendMessageToChild`/`ReplyToChild`/`SubmitDelivery`/`WaitForDeliveries`）。平摊模型下语义上更适合统一为 `CreateSession` + `SendMessage(sessionId)` + `ReceiveMessage`。是渐进保留现工具兼容，还是一次性重构？

2. **Tab 状态保留细节**：用户不喜欢关 tab，如果切换 tab 是销毁重建，滚动位置/输入草稿/搜索状态会丢。要不要把这些 UI 状态提升到 `session-store` 按 `sessionId` 索引？还是 tab 内部用 `display:none` 保留不销毁？两种方案各自的性能和复杂度需要具体估。

3. **Agent 主动"叫住"用户的通知机制**：Agent 卡住需要用户决策时，怎么通知？列表未读徽章？系统通知？会话上的 pulse？（`StatusPulse` 组件已存在，可复用）

4. **溯源条 UI 具体设计**：顶部小字是一行 badge 还是可展开的信息卡？点跳转的动画？"派出者已删除"的兜底样式？

5. **消息 sender 视觉设计**：human vs agent 用什么区分？agent 消息用哪个 icon？来源会话名怎么排版？agent 消息背景色是否要跟 human 消息区分？

6. **契约通道的物理位置**：契约通道是**渲染层纯校验**（tipc handler 里查）还是**服务层校验**（service 方法里查）？后者更严格，前者更简单。

7. **迁移策略**：现有已存在的 delegation 派出的子会话数据怎么处理？是不是要写一个迁移脚本给旧数据补 `contractMetadata`？还是只对新会话生效，旧的不管？
