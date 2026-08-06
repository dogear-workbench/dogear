---
step: 2
title: 落地 Pi 会话权限策略
status: done
---

## 目标

让 Pi 的 `tool_call` Hook 严格按两态主会话策略执行，确保所有子会话无条件自动执行，并收窄主进程 IPC 类型。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`step1-settings-contract.md` 已定义 `default | autoExecute`、七项基础工具映射和历史设置归一化；旧 `permissionRules` 与 `appendPermissionAllowRules()` 已移除。
- 当前关键文件状态：`electron/main/agents/pi-session/permission-mode.ts:1` 仍有六种模式；`permission-rules.ts:13-63` 是旧 SDK 白名单、deny/ask、编辑 Bash 正则与工具包特判；`pi-session.ts:550-590` 按旧优先级执行。
- 当前工具组装状态：`pi-session.ts:297-320` 未给 `createMemoryToolDefs()` 调用 `registerPack`，其余可选和常驻工具大多已映射至 `toolPackMap`。
- 当前子会话来源：`conversation-runtime-service.ts:81-104` 从 `appSettings.subAgent.permissionMode` 选择模式。
- 关键决策回顾：自动执行绝不受规则影响；默认模式下工具包自动放行、基础工具按设置；未分类工具保守询问；会话许可不落盘。

## 计划改动

- [ ] 将 `permission-mode.ts` 收窄为两态，并在 `PiSession` 构造和 `setPermissionMode()` 边界仅接收新类型。`config.role === 'sub'` 时，`setPermissionMode()` 必须强制保留 `autoExecute`；不得仅依赖 hook 内的 role 短路。
- [ ] 将 `permission-rules.ts` 重构为基础工具目录与映射判定：导出稳定基础工具集合、`isBasicToolName()`、补全/校验映射的 helper；删除 SDK 格式规则、`PERMISSION_EXEMPT_TOOLS`、编辑命令正则、常驻白名单和 `enabledToolPacks` 判定函数。
- [ ] 在 `conversation-runtime-service.ts` 创建 `PiSession` 时快照并传入完整 `appSettings.basicToolPermissions`：任何 `role='sub'` 会话固定传入 `autoExecute`，主会话才读取 `settings.ai.permissionMode`。`PiSession` 必须只使用该快照，不得在每次 `handleToolCall()` 回读全局设置；保存设置后的行为以重启或新建会话为准。
- [ ] 重写 `PiSession.handleToolCall()`：子会话或 `autoExecute` 直接放行；默认主会话中先识别 `toolPackMap` 所属工具包并放行，再按基础工具快照放行或挂起请求，未分类工具也挂起。保留中断/关闭时拒绝 pending Promise 的死锁保护。
- [ ] 将所有工具包都经唯一的 `registerPack()` 入口装配，包含 `createMemoryToolDefs()` 的 `dogear-memory`；审计 group、delegation、reference、review 和 optional pack。`registerPack()` 或启动校验必须保证每个非基础 Dogear 工具恰好归类一次、基础工具不进入映射、重复裸工具名立即失败，避免遗漏归类或静默覆盖。
- [ ] 将 `respondPermissionRequest()` 的当前行为联合类型收窄为 `allow | allow_session | deny`；移除 `always_allow` 的内存和磁盘写入分支，并删除 `updatedInput` 参数及其改写逻辑。仅当 pending 工具是基础工具时才允许 `allow_session` 写入集合；未分类工具的该响应必须拒绝或降级为单次 `allow`。
- [ ] 在 tipc `setPermissionMode` 边界同样拒绝或规范化对子会话的改模式请求；在 `respondPermissionRequest` 的输入契约中移除 `always_allow` 和 `updatedInput`，保证绕过 UI 的调用也不能违反上述不变量。
- [ ] 完整接通 `permissionModeChanged`：扩展 `PiSessionManager` broadcaster 事件联合与订阅、`tipc/agent.ts` 广播分支、`renderer-handlers.ts` 和共享类型，使同一 session 的所有 renderer attachment 收到两态模式变更；若无法实现端到端同步，则删除 PiSession 的 emit 与前端监听，不得保留死链。
- [ ] 收窄 `tipc/agent.ts:247-280`、conversation runtime 的 attach 返回值、`renderer-handlers.ts:70-74` 和相关主进程类型，保证新模式及三种权限响应在 tipc 编译时受约束。
- [ ] 用运行时级测试或最小可替换单元覆盖：自动执行忽略基础配置、默认模式七个基础工具的询问/放行、工具包自动放行、未分类工具询问且不能获得会话白名单、会话允许仅当前 session 生效、子会话 API 改模式后仍为 `autoExecute` 且永不请求确认、工具包重复名/漏归类校验，以及同一 session 双 attachment 的模式同步。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：无重大差异。`permission-rules.ts` 从旧 SDK 规则文件完整重构为基础工具目录 + 纯函数判定，超出「重构」预期但符合全局决策。`pi-session-manager.ts` 的 broadcaster 事件联合类型和订阅也补了 `permissionModeChanged`（计划提到但未单列文件）。
- 改动文件清单：
  1. `electron/main/agents/pi-session/permission-mode.ts` — PiPermissionMode 从 6 态收窄为 `default | autoExecute`
  2. `electron/main/agents/pi-session/permission-rules.ts` — 完整重构：删除全部旧 SDK 规则，新增 `isBasicToolName()`、`getBasicToolPermission()`、`decideToolPermission()` 纯函数
  3. `electron/main/agents/pi-session/pi-session.ts` — handleToolCall 重写为纯函数调用；config 新增 basicToolPermissions 快照；registerPack 校验；memory 工具包经 registerPack 装配；setPermissionMode 子会话强制 autoExecute；respondPermissionRequest 移除 always_allow/updatedInput
  4. `electron/main/services/conversation-runtime-service.ts` — 删除过渡映射，basicToolPermissions 快照传入
  5. `electron/main/tipc/agent.ts` — permissionModeChanged 广播分支；setPermissionMode 子会话守卫；respondPermissionRequest 收窄三种行为
  6. `electron/main/tipc/renderer-handlers.ts` — permissionModeChanged.mode 收窄为 PiPermissionMode
  7. `electron/main/agents/pi-session/pi-session-manager.ts` — broadcaster 事件联合类型和订阅补 permissionModeChanged
  8. `electron/main/agents/tools/tool-registry.ts` — SDK_BUILTIN_TOOLS 移除 WebSearch/WebFetch
  9. `electron/main/agents/pi-session/permission-rules.test.ts`（新增）— 17 测试

### 给下一步的接力棒

- 关键签名 / 数据结构：`decideToolPermission(toolName, mode, toolPackMap, sessionAllowedTools, basicToolPermissions) → 'allow' | 'ask'`；`respondPermissionRequest(requestId, behavior: 'allow' | 'deny' | 'allow_session', message?)`；tipc `setPermissionMode` 对子会话返回错误；`permissionModeChanged` 端到端接通。
- 下个 step 该从哪里继续：前端 UI 适配——ChatInputArea 收窄为两态菜单、PermissionRequestCard 移除 always_allow/编辑参数、设置页移除旧规则、SubAgentTab 删权限模式、共享类型收窄。
- 待办或已知限制：前端 `types/electron-api.ts` 的 PermissionMode 仍是 6 态（未动避免破坏 TS 编译），Step 3 需收窄；前端组件的旧 UI 逻辑 tipc 已拒绝但 UI 仍有对应按钮。
