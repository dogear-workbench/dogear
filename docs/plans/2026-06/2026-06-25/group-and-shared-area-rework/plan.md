# 会话组与共享区交互重构 实施计划

**目标**：淡化「会话组」概念，让新建对话一步到位；共享区瘦身为「agent 产物展示 + 引用入口」；顺手修两个相关 UI bug。

**架构思路**：组保留但视觉退到背景（新建对话隐式建组，去图标降级样式），共享区砍掉手动操作（删两个 Dialog，只保留 agent 写出的文件 + 资源管理器入口），「引用」语义统一收到 reference-store（共享文件作为一种新引用类型像文章/会话那样进消息）。详见姊妹目录 `../group-and-shared-area-rework-design.md`。

**涉及模块**：
- 前端：`components/conversation-list/Toolbar.tsx` / `components/group-list/GroupCard.tsx` / `components/SharedAreaPanel.tsx` / `components/ConversationList.tsx` / `components/conversation-list/ConversationRow.tsx` / `components/agent-chat/ChatInputArea.tsx` / `components/agent-chat/hooks/useSendMessage.ts`
- Store：`stores/conversation-store.ts` / `stores/group-store.ts` / `stores/reference-store.ts`
- 后端：`electron/main/services/group-shared-service.ts` / `electron/main/tipc/group.ts` / `electron/main/agents/group-context-builder.ts`
- 类型：`types/group.ts` / `types/electron-api.ts`

## 步骤索引

- [x] [Step 1: 修两个 UI bug（重命名/新建闪烁）](./step1-bug-fixes.md) — `onCloseAutoFocus` 阻止焦点抢回 + loading spinner 加首次判断
- [x] [Step 2: 新建对话即隐式建组](./step2-implicit-group-on-create.md) — `newConversation` 内部先建组再建对话，Toolbar 删 FolderPlus
- [x] [Step 3: GroupCard 视觉降级 + 组内 + 按钮](./step3-group-visual-and-plus.md) — 去 Layers 图标，淡底字号收一档，组卡片右侧加 `+`
- [x] [Step 4: 共享区瘦身（前后端联动）](./step4-shared-area-slim.md) — 删 sharedReferences 数据模型 + 两 Dialog 按钮 + 原生/引用分段；只剩 agent 文件列表 + 「在资源管理器打开」
- [x] [Step 5: 共享文件作为消息引用](./step5-shared-file-reference.md) — reference-store 加 `referencedSharedFiles`，输入框芯片，发送拼 XML，共享区每行加引用按钮

## 全局决策

- **不写单测**：按项目偏好，验证靠 `bun run build` + `bun run lint` + 手测复现路径。
- **不做数据兼容**：开发期约定，旧 `groups.json` 的 `sharedReferences` 字段读时忽略、写时丢弃即可，不写迁移代码。
- **不删旧数据**：用户手动建过的「原生文件」（共享目录里的实体文件）不主动清理，等用户自己处理；UI 只是不再区分「原生项 vs 引用项」，统一作为 agent 产物列出。
- **组 title 派生策略沿用**：`deriveGroupTitle(group, conversations)` 已有，新建组直接传空 title，UI 派生为组内首个对话标题。
- **引用 XML 标签命名**：沿用 `.claude/rules/message-references.md` 风格，新增 `<referenced_shared_files><shared_file group_id="..." rel_path="..." abs_path="..." /></referenced_shared_files>`。
- **不动 SDK additionalDirectories 配置**：共享目录已在 workspacePath 之下，agent 用 Read 工具直接能读绝对路径；工作区外文件读取靠现有权限请求流。
