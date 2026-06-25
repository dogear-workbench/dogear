# 会话组 Phase 1（地基）实施计划

> 设计文档：[../conversation-group-design.md](../conversation-group-design.md)

**目标**：用户能马上享受"上下文延续"——新建会话时天然知道同组其他会话讨论过什么；组内有共享文件区可读可写可手动加引用项。

**架构思路**：
- 数据层先行：所有现有 conversation 自动迁移成"单会话组"，新会话强制带 groupId
- UI 渐进式：列表新增"组视图"作为默认，旧的手动/智能/时间视图作为可切换视图保留，避免破坏现有体验
- 共享区分两层：物理目录（原生项落盘）+ 引用项 metadata（指向 workspace 路径）
- system prompt 注入轻量化：只放组概况 + 文件清单 + 简短摘要（<500 token），详情靠工具按需读

**涉及模块**：
- 类型：`types/group.ts`（新）/ `types/electron-api.ts`（扩 Conversation 字段）
- 主进程：`electron/main/services/group-service.ts`（新）/ `group-shared-service.ts`（新）/ `conversation-service.ts`（扩字段+迁移）/ `tipc/group.ts`（新）
- Agent 框架：`electron/main/agents/query-based-session.ts`（system prompt 拼接）/ `tools/group-tools.ts`（新 MCP server）
- 前端 Store：`stores/group-store.ts`（新）
- 前端组件：`components/group-list/`（新目录）/ `components/SharedAreaPanel.tsx`（新）/ `components/ConversationList.tsx`（加视图切换入口）/ `app/page.tsx`（右侧面板嵌入共享区 Tab）

## 步骤索引

- [ ] [Step 1: 数据层地基](./step1-data-layer.md) — 类型 + group-service + conversation 加 groupId + 旧数据迁移
- [x] [Step 2: IPC + Group Store](./step2-ipc-store.md) — tipc/group.ts + stores/group-store.ts
- [x] [Step 3: 组列表 UI（新增视图）](./step3-group-list-ui.md) — components/group-list/ + ConversationList 加视图切换
- [x] [Step 4: 共享区物理层](./step4-shared-service.md) — group-shared-service.ts + IPC + 路径校验
- [ ] [Step 5: 共享区右侧面板 Tab](./step5-shared-panel.md) — SharedAreaPanel.tsx 嵌入右侧预览面板
- [ ] [Step 6: 共享区 MCP 工具](./step6-mcp-tools.md) — group-tools.ts 注册 4 个工具
- [ ] [Step 7: 组概况注入 system prompt](./step7-context-injection.md) — query-based-session.ts 启动时拼接

## 全局决策

**命名约定**
- 主进程类型在 `electron/main/types.ts` 镜像（不直接导入 `types/`）
- Store 文件命名 `xxx-store.ts`，camelCase action 名
- 服务层 camelCase 内部，前端兼容用 `toCompat()` 转 snake_case（如已有惯例）
- 工具命名遵循 PascalCase（与现有 `ReadArticle` / `GetStockQuote` 一致）

**数据格式**
- `groups.json`：数组形式，单条 `{ id, title?, createdAt, updatedAt, sharedReferences: [] }`，**不写 conversations 数组**（避免双向同步）
- `conversation.groupId`：强制非空字符串
- `conversation.role`：`'main' | 'sub'`，**主/子判定规则：用户手动创建 = main，agent 调 DelegateTo 创建 = sub**。P1 阶段实际只产生 main（DelegateTo 是 P2）
- `conversation.parentConversationId`：仅 sub 才有，P1 阶段全部缺省
- group id 用 `nanoid` 或 `crypto.randomUUID()`，命名 `group_xxx` 前缀方便辨识
- **SharedReference 用 discriminated union**：`type: 'file' | 'conversation' | 'article'`。P1 只实现 `'file'`，但 schema 一开始就支持扩展（避免后续破坏性改动）

**物理路径**
- 共享区根目录：`<configDir>/workspaces/<wsId>/groups/<groupId>/shared/`
- `groups.json` 路径：`<configDir>/workspaces/<wsId>/groups.json`（按工作区独立）
- 注意：当前 `conversations.json` 是**全局**（不按工作区），但 group 按工作区组织。Step 1 文档里讨论是否同步把 conversation 也按工作区拆——倾向暂时不拆，conversation 通过 `workspaceId` 字段过滤即可

**迁移策略**
- 启动时检查每个 conversation 是否有 groupId，没有则：
  1. 自动 createGroup（title 沿用 conversation.title）
  2. 把 conversation.groupId 写回
- 迁移幂等（已经有 groupId 的不动）
- 旧数据保留备份（safe-json 已自带 .bak 机制）

**错误处理**
- 共享区路径必须经过 `path.relative` + `startsWith` 校验，防止 `../` 越界
- group-service 所有 CRUD 用 safe-json 互斥锁（已有机制）
- IPC handler 必须 try/catch 包裹，返回 `{ ok: boolean, error? }`

**渐进式 UI 改造原则**
- Step 3 **不删除**任何现有的 conversation-list 子组件
- 新视图（GroupList）和旧视图（ManualSection/SmartSection/TimeSection）并存
- 默认视图改为 GroupList，但用户可以在 ViewTabs 切回旧视图
- 第二阶段做 P2 时根据使用情况决定是否清理旧视图

**列表行按钮简化（顺手优化）**
- 现状：ConversationRow hover 出"编辑/引用/删除"等按钮挤占标题空间
- 新规则：行内只保留一个 `···` 按钮（lucide MoreHorizontal），点击触发与右键 ContextMenu 完全相同的菜单
- 应用范围：组视图（GroupRow / 组内 conv 行）+ 旧视图复用的 ConversationRow 一起改
- 与 Step 3 一起做（反正都要动 ConversationRow）

## 验证流水线

每个 step 完成后跑：
```bash
bun run build:electron   # 主进程改动必跑
bun run lint             # 类型+lint
bun run dev              # 手测：UI 交互、IPC 调用、agent 行为
```

不写单测（项目偏好），靠 build + lint + 手测把关。
