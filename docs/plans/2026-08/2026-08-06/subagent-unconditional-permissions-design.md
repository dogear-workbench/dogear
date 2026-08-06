# 子会话无条件权限设计

**背景**：Pi 子会话曾沿用 SDK 时代的可选权限模式。`ReadReferenceSession` 等派遣工具可能因权限确认无人处理而挂起；用户要求子会话固定为全部自动允许，并且无视全局 `deny` 规则。

**目标**：所有 `role='sub'` 的 Pi 会话调用任意已挂载工具时都不弹权限确认、不受 `permissionRules.allow`、`ask`、`deny` 影响。设置页不再允许配置子会话权限模式；旧设置数据在加载时清理。主会话及后台任务的权限语义不变。

**架构**：在 `PiSession.handleToolCall()` 的入口按 `config.role==='sub'` 直接允许，置于读取规则、Plan 模式、deny/ask 匹配之前，作为唯一权限判定短路点。`conversation-runtime-service.ts` 为子会话固定传入 `bypassPermissions`，不再读取 `settings.subAgent.permissionMode`。双重约束确保运行时语义不依赖旧设置字段。

不采用仅将默认值设为 `bypassPermissions` 的方案：旧设置、设置页变更和 `deny` 规则仍会改变行为，不能满足无条件全绿。也不改变主会话的权限逻辑，避免扩大风险范围。

**模块边界**：
- `electron/main/agents/pi-session/pi-session.ts`：子会话工具调用的无条件放行。
- `electron/main/services/conversation-runtime-service.ts`：子会话固定权限模式。
- `electron/main/services/settings-types.ts`、`types/settings.ts`：删除 `subAgent.permissionMode` 类型与默认值。
- `electron/main/services/settings-service.ts`：加载时删除旧 JSON 中的 `subAgent.permissionMode` 并持久化。
- `app/settings/SubAgentTab.tsx`：删除权限模式单选项，替换为只读说明。

**数据流**：加载 `settings.json` 时移除旧字段；用户在设置页保存后不再写入该字段。创建子会话时运行时固定权限模式；每次工具调用在 PiSession 入口按子会话角色短路允许。主会话继续读取全局权限模式与 `permissionRules`。

**错误处理 / 边界情况**：旧 JSON 缺少该字段时不写盘。子会话已挂载但未启用的工具仍不会凭空出现；无条件放行只针对实际挂载的工具。子会话的 `plan` 语义被固定全绿覆盖。应用重启前已创建的内存中会话仍维持旧实例行为，重启后新会话生效。

**未决问题**：无。
