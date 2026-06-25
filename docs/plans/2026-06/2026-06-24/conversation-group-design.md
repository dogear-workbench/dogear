# 会话组（Conversation Group）+ 主子会话委派 设计

## 背景

当前体验有两个痛点：

1. **上下文断裂**：用户讨论一个主题（如"分析 → 计划 → 实施"）往往要开多个会话，但每开新会话都要重新描述上下文让 agent 接续。手动文件夹只能把会话"放一起方便找"，不解决"新会话天然知道前面讨论过什么"。
2. **复杂任务缺乏协作机制**：要做一个 3 步骤计划时，用户希望主会话委派多个子任务并行/独立执行，主会话挂着审核汇总。现有的 SDK 子代理（subagent）只是"主会话的延伸手臂"——共享上下文、阻塞执行、不可观察、无法独立选模型，不是"同事"。

## 目标

提供一种新的组织 + 协作单元 **会话组（Group）**，承载：

- **上下文延续**：组内会话共享同一份"共享文件区"和"组级 digest 摘要"
- **多会话协作**：主会话可派生独立子会话（独立 sdkSession / 模型 / cwd），通过共享区交付产出
- **AI 自动提炼**：digest/categorize/review 体系全部以组为粒度运作

## 架构哲学

> **上下文干净 + 各司其职 + 通过共享内容统一**

这条贯穿全设计：
- 主会话上下文不应被子任务详细产出污染
- 每个会话/子会话专注单一职责
- 协作不靠"塞 token 到对方上下文"，靠**共享文件区**作为协作总线

## 核心架构

### 1. 数据模型

**关键概念澄清**：
- 组是**语义聚合视图**，不是新原子。**conversation 仍是原子会话**，没有"复合会话"或"执行块"
- 一个组装多个独立 conversation，"有时看成一个、有时分开看"
- 智能分组 / 手动分组（已有）是 conversation **之间**的分组，和这里的"会话组"是不同维度的概念——本设计的会话组承载共享上下文 + 主子关系

**主/子判定规则**：
- 用户手动创建的 conversation → `role: 'main'`
- agent 调 `DelegateTo` 派生的 conversation → `role: 'sub'`，带 `parentConversationId`

```
groups.json:
[
  {
    id: string,
    title?: string,           // 可空，按推导规则显示
    createdAt: number,
    updatedAt: number,
    sharedReferences: SharedReference[]
  }
]

// 引用项多态 schema（P1 只实现 type: 'file'，但 schema 一开始就支持扩展）
type SharedReference =
  | { id, type: 'file', path: string, addedAt, label? }              // workspace 文件
  | { id, type: 'conversation', conversationId: string, addedAt, label? }  // 别的对话（P1 不实现）
  | { id, type: 'article', articleId: string, addedAt, label? }     // 文章（P1 不实现）

conversations.json (新增字段):
{
  ...原有字段,
  groupId: string,             // 强制
  parentConversationId?: string, // 子会话才有
  role: 'main' | 'sub'         // 主/子判定按"创建来源"
}
```

物理存储：`.dogear/workspaces/<wsId>/groups/<groupId>/shared/`（原生项实打实落盘）

### 2. 共享文件区

两类内容统一在共享区呈现：
- **原生项**：组目录 `shared/` 下的真实文件（子会话产出、共识、设计文档等）
- **引用项**：metadata 仅记录 workspace 内某文件的相对路径，agent 通过同一套工具访问

**重要**：引用项不复制内容，跨组可复用（如 workspace 内的某份外部 plan 可被多个组引用）。

### 3. 新会话启动时的上下文装载

system prompt 自动追加：
- 组名 + 组目标一句话
- 共享区文件清单（带 1 行描述）
- 组级 digest 摘要（控制在 500 token 内）

**详细内容靠工具按需读**：`ReadGroupFile` / `ListGroupSessions` / `ReadGroupDigest`

这种"轻注入 + 工具深挖"模式既让 agent 知道有什么资源，又不污染 input。

### 4. 主子会话委派

**子会话本质**：完整 conversation 记录（列表可见、可点进去观察、可人工介入），有独立的 sdkSession / 模型 / cwd / 人设 / 权限模式。

**通信原语 — 两种工具并存**：

| 工具 | 模式 | 适用场景 |
|---|---|---|
| `DelegateTo(spec)` | 立即返回 childId，不阻塞 | 派出去后还要和用户继续讨论别的 |
| `WaitForDeliveries(childIds)` | 主进程层面 await 挂起，0 model invocation | 派完就等齐结果再总结（默认/典型） |
| `SubmitDelivery(...)` | 子会话端，提交交付 | 子会话内部使用 |

`DelegateTo` 后子会话独立跑（独立 token 账本），完成时：
- 若主会话在 `WaitForDeliveries` 挂起 → 通过 Promise 唤醒，工具 result 是结构化汇总
- 若主会话不在 wait → push 一条"模仿用户输入"的消息到主会话 `pendingMessages`，下次响应时自然处理

**交付契约（硬约束）**：
- `DelegateTo` 必填 `outputPath`（相对共享区）
- 子会话 system prompt 强制："产出必须调 SubmitDelivery 落到 X 才算完成"
- 交付消息结构化：`{ childId, status, outputPath, summary(≤1k token) }`
- 详情靠主会话事后 `ReadGroupFile(outputPath)` 按需读

**成本对比要点（讨论结论）**：
- A'（WaitForDeliveries 挂起）≈ 主会话只付工具描述 + result 的 token
- A（pendingMessages push）≈ 多一次主会话上下文读（cache 摊薄但不免费）
- 默认教 agent 用 A'，把 A 作为高阶能力

### 5. 命名策略（默认免命名）

组创建时不取名，按 fallback 链显示：
1. 组内 1 个会话 → 显示该会话 title
2. 组内多会话且无 digest → 显示首会话 title + "等 N 个会话"角标
3. 触发过组级 digest → 用 digest 提炼的组名（写回 `group.title`）

用户可随时手动改。**95% 的组永远不需要手动取名**。

### 6. UI 形态

**侧边栏**：组卡片为一级单位
- 卡片头：标题/最后活动时间/粘性状态/等 N 个交付的角标
- 展开后平铺组内会话，按创建顺序
- 子会话缩进 2 格 + 带"⤷ parent_id"连线，表示主子关系

**手动文件夹/智能分类**保留作为"访问视图"（智能分类对象从会话改为组）。

**列表行按钮简化（顺手优化）**：
- 现状：ConversationRow hover 出"编辑/引用/删除"等按钮挤占标题空间
- 新规则：行内只保留一个 `···` 按钮，点击等同于触发右键 ContextMenu。所有功能进右键菜单
- 这点与会话组改造一起做（反正都要动 ConversationRow）

**右侧预览面板**：新增"共享区" Tab，跟随当前打开的会话所在组自动切换。Tab 内：
- 原生项（组目录文件）
- 引用项（带 ↗ 角标，指向 workspace 文件）
- 拖 workspace 文件进来自动建引用

**SessionTab（顶部 tab）**：第一阶段保留但视觉可淡化。第二阶段评估是否砍掉（列表已足够表现打开/运行状态）。

### 7. 现有功能适配

- **Digest 体系全面升级为组级**：取消会话级 digest，整套 digest 机制（脏检查/3 触发点/digests/ 存储）粒度从 sessionId 改为 groupId。digests 文件改名 `<groupId>.md`
- **智能分类对象改为组**：一个组 = 一个主题，分类粒度更合理
- **Dashboard 按组聚合**："近期做了哪些"以组为单位呈现

### 8. 工具体系

| 类别 | 工具 | 注入方式 |
|---|---|---|
| 共享区 | `ReadGroupFile` / `WriteGroupFile` / `ListGroupFiles` / `AddGroupReference` | 所有会话自动注入 |
| 委派 | `DelegateTo` / `WaitForDeliveries` / `SubmitDelivery` | 主会话自动注入；SubmitDelivery 仅子会话注入 |

"组上下文"（groupId / sharedPath）由 session 框架自动绑定到工具调用，agent 不需要传。

**委派工具家族（Phase 2 实施时细化）**

上表只列了核心 3 个原语。Phase 2 实施时还需要补齐以下能力（具体工具名/参数等实施时定）：

- **批量创建**：一次性发起 N 个子会话（`DelegateBatch`），减少主会话往返
- **停止子会话**：单个/批量取消正在跑的子会话（`StopChild` / `StopAll`），主进程层面 abort
- **追加消息**：主会话给已运行的子会话再发一条消息进一步处理（语义类似插话）
- **列出子会话状态**：主会话查询自己派出的所有子会话当前状态（running/done/failed/timeout）+ 进度摘要
- **子会话反问主会话**：子会话遇到歧义需要主会话决策时主动发起（可能用 AskParent 工具 + 主会话 pendingMessages 机制）

这些工具的具体形态在 Phase 2 开始前补一份小设计，不在本文档展开——因为它们的具体边界要看 P1 完成后 `delegation-bridge` 的实际形态。

## 模块边界

涉及的主要文件：

**新增**
- `electron/main/services/group-service.ts` — 组 CRUD + 引用项管理
- `electron/main/services/group-shared-service.ts` — 共享区物理目录管理
- `electron/main/tipc/group.ts` — 组 IPC 路由
- `electron/main/agents/tools/group-tools.ts` — 共享区工具 MCP server
- `electron/main/agents/tools/delegation-tools.ts` — 委派工具 MCP server
- `electron/main/agents/delegation-bridge.ts` — 子会话生命周期 + WaitForDeliveries Promise 挂起 + pendingMessages push 桥接
- `stores/group-store.ts` — 组列表/展开状态/当前组
- `components/group-list/` — 组列表 UI（GroupCard / SubAgentChain 等）
- `components/SharedAreaPanel.tsx` — 右侧共享区面板
- `types/group.ts` — 类型定义

**修改**
- `electron/main/services/conversation-service.ts` — 加 groupId/parentConversationId/role 字段，迁移逻辑
- `electron/main/services/memory/digest-*.ts` — 粒度从 sessionId 改 groupId
- `electron/main/services/memory/smart-category-*.ts` — 对象改组
- `electron/main/services/memory/review-*.ts` — 按组聚合
- `components/agent-chat/` — 共享区上下文注入，子会话状态展示
- `components/ConversationList.tsx` + `components/conversation-list/*` — 改造为组列表
- `stores/conversation-store.ts` — 适配 groupId

## 数据流

### 新会话启动
```
用户在组 G 内新建会话 C
  → conversation-service.create(groupId=G.id)
  → QueryBasedSession 启动时
    → group-service.getGroupContext(G.id)  // 概况+文件清单+digest摘要
    → 拼入 system prompt
  → 工具注册时自动绑定 groupId 到 group-tools
```

### 子会话委派（A' 模式）
```
主会话 M 调 DelegateTo(spec, outputPath="subtask1.md")
  → delegation-bridge.startChild(M.id, spec)
    → 创建子会话 C_sub（独立 sdkSession + 注入 SubmitDelivery 工具）
    → 立即返回 { childId, status: "started" }
  → 主会话 agent 接着调 WaitForDeliveries([childId])
    → delegation-bridge.waitFor([childId]) 返回 Promise
    → C_sub 跑完调 SubmitDelivery
      → 写文件到 shared/subtask1.md
      → resolve Promise
    → WaitForDeliveries 工具返回结构化汇总
  → 主会话拿到 summary + outputPath，按需 ReadGroupFile 读详情
```

### 组级 Digest
```
触发点（启动扫/夜间03点/关会话）
  → digest-scanner.findDirtyGroups()  // 改为按组脏检查
  → digest-trigger.triggerScanByGroup
  → handleDigestSessionTask: 聚合组内所有会话 transcript + 共享区文件清单
  → 落盘 digests/<groupId>.md
```

## 错误处理 / 边界情况

- **孤儿会话迁移**：现有所有 conversation 自动迁移成"单会话组"（group.title 复用 conversation.title）
- **删除组**：必须先把组内所有会话也删（或提示用户先处理）；共享区目录联动删除；引用项不影响 workspace 内被引用文件
- **子会话失败/超时**：`WaitForDeliveries` 工具结果里标记 `status: 'failed' | 'timeout'`，主会话决定重派或回报用户
- **共享区文件冲突**：多个子会话写同一 outputPath → DelegateTo 时验证 outputPath 唯一性
- **跨组复用引用项**：引用项只是路径记录，不需要去重；同一 workspace 文件被 5 个组引用各自独立
- **缓存掉档**：A' 模式下主会话挂起时间长（>5min/1h）会丢 cache。建议长任务前用户手动切到 1h 缓存档（brainstorming skill 已经在引导这个习惯）

## 阶段化

### Phase 1：会话组地基

**目标**：用户能马上享受"上下文延续"。

**包含**：
- 数据模型迁移（groups.json + conversation 加字段 + 旧数据自动迁移）
- 列表 UI 改造（组卡片可展开 + 主会话列表）
- 共享区原生项（CRUD）+ 手动添加引用项
- 共享区物理目录 + 右侧面板 Tab
- 组概况注入 system prompt
- 共享区 4 个 MCP 工具

**不包含**：主子会话委派；digest/categorize/review 适配（仍按旧的 sessionId 粒度运作，但落到组内会话身上）

### Phase 2：主子会话委派

**包含**：
- 子会话实体（独立 sdkSession + parent 关系 + role）
- 委派 3 个工具 + delegation-bridge
- 列表主子可视化（缩进 + 连线 + 等 N 个交付角标）
- 交付契约 enforcement（outputPath 必填、summary 限长、SubmitDelivery 强制）

### Phase 3：旧功能全面适配

**包含**：
- digest 粒度从会话改组（删除会话级、新建组级、迁移已有 digest）
- 智能分类对象改组
- dashboard 按组聚合

## 未决问题（实施时补）

1. **组级 digest 触发时机**：第一个会话归档时？所有会话都关闭时？手动？Phase 3 时拍板
2. **手动文件夹 vs 组**：手动文件夹现在装 conversation，是否升级成装 group？Phase 1 暂时保持装 conversation 不变，让组列表和手动文件夹并存评估
3. **SessionTab 命运**：第一阶段保留观察。第二阶段视用户实际使用决定是否砍掉/改为快速切换器
4. **子会话嵌套深度**：子会话能不能再派孙会话？技术上完全可以；UI 上多层嵌套要不要折叠？Phase 2 时拍板
5. **共享区文件大小限制**：是否对 WriteGroupFile 设上限防止子会话写超大文件？Phase 2 时讨论
6. **跨组引用项管理**：要不要在 workspace 文件被删除时通知所有引用它的组？Phase 1 简单实现（引用失效时工具调用报错），后续优化
