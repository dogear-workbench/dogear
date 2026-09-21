# 随手问与分流 实施计划

**目标**：落地三块能力——① 工作会话岔题的「建议卡 + 操作气泡 + ForkSession」分流链路；② 无工作区绑定的临时会话（personal 隐藏空间，7 天归档，可移入工作区）；③ registry 驱动的快捷键清单与设置 tab。

**架构思路**：临时会话用内置隐藏工作区 `personal` 承载，复用全部按 workspaceId 组织的设施（decouple 已保证 tab 并存互扰为零）；分流做成「agent 事后建议卡（非阻塞）→ 输入框操作气泡（复用引用芯片 UI 与标签注入）→ ForkSession/笔记工具执行」的异步链路，不复用 delegation 父子契约；快捷键建渲染层 registry，设置页自动生成清单。详见设计文档：`../quick-chat-design.md`。

**涉及模块**：`lib/hotkey-registry.ts`（新）、`app/settings/`、`components/ConversationList.tsx` + `conversation-list/`、`stores/conversation-store.ts`、`components/agent-chat/`（ChatInputArea / MessageItem / useSendMessage）、`electron/main/services/`（workspace-json / conversation / auto-archive / group）、`electron/main/agents/`（fork-session 工具、pi-session 能力解析、提示词模板）

## 步骤索引

- [x] [Step 1: hotkey registry 与设置快捷键 tab](./step1-hotkey-registry.md) — 快捷键定义为数据，设置页自动渲染清单，迁移现有两键 + 预留 Ctrl+Alt+N
- [x] [Step 2: personal 空间后端](./step2-personal-backend.md) — 隐藏工作区常量、目录确保、getAll 过滤、归档 7 天分支、单会话组约定
- [x] [Step 3: 临时会话前端](./step3-personal-frontend.md) — 左侧列表顶部分区（当天/更早折叠）、分区「+」与 Ctrl+Alt+N 入口、最小能力包、tab 承载
- [x] [Step 4: 移入工作区](./step4-move-to-workspace.md) — 索引迁移 + session 文件搬运 + 组归属选择 UI + agent 只读话题工具放行
- [x] [Step 5: 分流建议卡](./step5-suggestion-card.md) — 提示词引导 + 文本协议 + MessageItem 解析渲染按钮组
- [x] [Step 6: 操作气泡与 ForkSession](./step6-shunt-bubble-tools.md) — 输入框气泡 UI、发送标签注入、ForkSession 工具、CreateNote 接线、回执跳转

## 全局决策

1. **`personal` 是保留字 workspaceId**：常量放前后端共享位置（如 `types/` 或既有共享常量模块），命名 `PERSONAL_WORKSPACE_ID`；任何 workspaceId 消费方遇到它必须走特殊分支或显式放行
2. **personal 每会话一隐式组**：创建会话即建同名单会话组，后端复用组/归档逻辑，前端平铺渲染不显示组概念
3. **后端改动后必须 `bun run build:electron`**（Vite 热重载只对前端生效）
4. 不写单测，按各 step 验收清单手动验收
5. 工具命名带 `dogear__` 前缀，handler 错误返回 `isError: true` 不抛异常，文件末尾 `registerTools()` 注册
6. 分流统一两条文本协议：① **建议块**（agent 回复末尾，本条已定稿）——fenced JSON 块，语言标签 `shunt-suggestions`，块内正文 `{"summary":"<岔题摘要，自含≤60字>","options":["new-session","new-topic","note"]}`（options 为三动作非空子集，去重）；前端在 MarkdownRenderer 之前截获解析（完整块剥除正文、取最后一个有效块渲染卡片，流式中途的未闭合块一并剥除防代码块闪烁），解析实现 `components/agent-chat/shunt-suggestions.tsx`；② **气泡注入标签 `<shunt>`**（Step 6 定稿）——`<shunt action="new-session|new-topic|note" summary="<岔题摘要，XML 属性转义>">用户补充文字</shunt>`；作为独立 text block 前置于用户消息（发送时由 useSendMessage 从输入框气泡构建，正文=输入框文本，不再重复入块；前端 parseUserMessageReferences 解析剥壳、正文留在 userMessage，白名单外 action 不解析原样保留）
7. agent 只建议不执行：任何会话结构变更（ForkSession/归组/移入/笔记）必须经用户发出气泡或点击 UI 确认
8. 遇到设计未覆盖的边界：记入 step 文档「实施回填」，不擅自扩大改动面

## 完成总结

2026-09-21 六个 step 全部完成，逐 step 独立 commit（06f347eb / 4993c87f / 1b766db1 / c547642b / 38eecfcc / 1214164d）。

- **快捷键 registry**：HOTKEY_DEFS 数据驱动 + 设置页「快捷键」tab 自动渲染；Ctrl+F / Ctrl+\ 迁移，Ctrl+Alt+N 预留给临时会话
- **personal 隐藏工作区**：常量前后端镜像、getAll 默认过滤、7 天归档分支、文件夹树/watcher 跳过；前端常显「临时会话」分区（当天/更早折叠）、最小能力包（仅联网搜索，数据驱动 config 合并）、临时徽章、归档「临时」标记
- **移入工作区**：conversation-move-service 执行链（校验→释放句柄→索引迁移→JSONL 搬运 header 改写→personal 清理，失败回滚）+ 弹层选工作区/组 + agent 只读话题工具（ReadTopicCard）辅助归置
- **分流链路**：shunt-suggestions fenced JSON 建议块（非阻塞事后建议）→ 建议卡三按钮 → 输入框操作气泡 → `<shunt>` 标签注入 → dogear__ForkSession（平级会话/新话题组，orphan 保活）/ CreateNote（tags「分流暂存」）→ dogear:// 回执跳转链接

**遗留（均已在 step 文档回填）**：① GUI 全链路手动验收待 bun run dev（各 step 数据层/解析层均已脚本验证）；② dogear-memory 工具因 pi-session 无工作区兜底分支仍在 personal 注册（需改 pi-session 一行，待他人未提交改动落地后补）；③ 笔记引用注入 workspaceId= 属性与解析端 workspacePath= 正则不匹配的既有 bug（超出本次范围）；④ web-research 提示词段对 personal 轻微超配（含派子会话指引但无派遣工具）。
