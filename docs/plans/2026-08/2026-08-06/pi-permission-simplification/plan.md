# Pi 权限简化实施计划

**目标**：将 Pi 主会话权限收敛为“默认 / 自动执行”两种模式；默认模式由七个基础工具的“自动放行 / 询问”配置决定，工具包一律自动放行；子会话永远自动执行。

**架构思路**：保留 `AgentHarness.tool_call` 作为唯一的工具前置拦截点，在 `PiSession` 内实施新策略。设置数据改为显式的基础工具权限映射，移除为旧 Claude SDK 主会话兼容而存在的多模式和 `permissionRules` 体系；文章解析后台任务继续使用自己的固定 SDK `dontAsk + allowedTools` 配置，不复用 Pi 权限设置。

**涉及模块**：`types/settings.ts`、`electron/main/services/settings-types.ts`、`settings-service.ts`、`pi-session/permission-mode.ts`、`pi-session/permission-rules.ts`、`pi-session/pi-session.ts`、`conversation-runtime-service.ts`、`tipc/agent.ts`、设置页与工具权限页、聊天权限菜单与权限卡、前端共享类型及使用量类型。

## 步骤索引

- [x] [Step 1: 统一设置数据与兼容迁移](./step1-settings-contract.md) — 定义两种模式和基础工具映射，清除旧 SDK 主会话规则的读写路径。
- [x] [Step 2: 落地 Pi 会话权限策略](./step2-pi-runtime-policy.md) — 重写 Harness Hook 判定、固定子会话自动执行并收窄 tipc 契约。
- [ ] [Step 3: 收敛设置与会话交互界面](./step3-ui-contract.md) — 提供基础工具配置和两态菜单，删除旧规则、Web 工具及“总是允许”交互。
- [ ] [Step 4: 验证、清理与文档同步](./step4-verify-doc-sync.md) — 构建验证关键场景，清理遗留引用并同步项目索引。

## 全局决策

- 新模式的持久化值固定为 `default | autoExecute`。`autoExecute` 是无条件放行，不读取基础工具映射、会话允许集合或旧规则。
- 基础工具权限持久化字段固定为根级 `basicToolPermissions`；其稳定键为 `read`、`write`、`edit`、`bash`、`Glob`、`Grep`、`Skill`。新装、缺失、无效或结构损坏的映射均规范化为七项完整且值为 `ask | allow` 的映射，默认全部为 `ask`。
- 基础工具映射在创建 `PiSession` 时由 `conversation-runtime-service` 快照传入；保存设置仅影响之后新建或重启的会话，不热更新运行中会话。
- “默认”模式下：已注册工具包自动放行；基础工具按映射决定；未分类工具保守地请求确认。仅基础工具可获得“本会话允许”；未分类工具和工具包工具不得写入会话允许集合。
- 子会话固定 `autoExecute`，无独立权限模式设置，也不发出权限确认请求；该不变量同时由创建路径、`PiSession.setPermissionMode()`、tipc 路由和聊天 UI 保证。
- 权限模式变更需在同一 session 的全部 renderer attachment 间同步；若无法完成端到端广播，不得保留表面存在的后端→前端事件链。
- 询问卡只保留“允许一次 / 本会话允许 / 拒绝”；移除“总是允许”、拒绝说明与编辑调用参数，避免重新引入跨会话规则或额外决策分支。当前响应联合类型不再含 `always_allow`，但历史 usage JSONL 的读取与统计继续兼容该值。
- `WebSearch`、`WebFetch` 不属于 Pi 当前注册工具，不在新基础工具列表中；从旧 SDK 静态元数据与设置展示中移除。
- 只保留 `PARSE_ARTICLE` 后台任务使用的 Claude Agent SDK 既有固定权限配置；不得把 `autoExecute` 直接传给 SDK。
- 工具包归类以 `registerPack()` 为唯一装配入口：每个非基础工具必须恰好归属一个工具包，基础工具不得归类，重复裸工具名必须在启动或测试中显式失败，避免遗漏归类后意外进入确认流程。
