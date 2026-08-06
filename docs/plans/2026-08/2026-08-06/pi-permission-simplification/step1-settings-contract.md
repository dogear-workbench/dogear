---
step: 1
title: 统一设置数据与兼容迁移
status: done
---

## 目标

用明确的两态权限模式与基础工具权限映射替换共享设置中的旧 SDK 主会话权限结构，并让历史设置安全归一化。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无。
- 当前关键文件状态：`types/settings.ts:59-95` 与 `electron/main/services/settings-types.ts:55-94` 都定义了五种 `ai.permissionMode`、可选 `permissionRules`、以及 `subAgent.permissionMode`；两份类型必须同步。
- 当前加载行为：`electron/main/services/settings-service.ts:40-58` 仅深度合并并迁移 Pi profile；`electron/main/agents/agent-query-config.ts:66-75,181-207` 仍暴露旧权限字段给仅存的 SDK 背景任务。
- 关键决策回顾：Pi 主会话只接受 `default | autoExecute`；缺失基础工具设置时全部询问；子会话不再有设置项。文章解析 SDK 的固定 `dontAsk` 配置不依赖这套新设置。

## 计划改动

- [ ] 在前端与主进程两份 settings 类型中导出 `BasicToolName`、`BasicToolPermission` 与完整的基础工具映射类型；将 `ai.permissionMode` 收窄为 `default | autoExecute`，在 `AppSettings` 根级新增必填 `basicToolPermissions: BasicToolPermissions`。同时定义独立的 `PiPermissionMode`，后续不得用宽泛 `string` 代替。
- [ ] 删除 `AppSettings.permissionRules` 和 `AppSettings.subAgent.permissionMode`；在 `DEFAULT_SETTINGS.basicToolPermissions` 中提供七项均为 `ask` 的基础工具权限映射，子会话默认配置只保留模型、超时、缓存和上下文挂载设置。
- [ ] 在 `settings-service.ts` 的加载路径加入一次性规范化纯函数：将旧 `bypassPermissions`、`dontAsk`、`auto` 映射为 `autoExecute`，其余旧/未知模式映射为 `default`；过滤/删除旧 `permissionRules` 与子会话权限字段；将 `ai`、`subAgent` 和基础映射的 `null`、数组、字符串等非对象结构恢复为安全对象；为缺失、额外或无效的基础工具键生成七项完整 `ask | allow` 映射，并在发生变化时经 `safeJsonWrite()` 原子写回。规范化必须幂等，不得丢失本次变更无关的有效设置。
- [ ] 删除 `appendPermissionAllowRules()` 及其仅为旧“总是允许”服务的导出；同步移除 PiSession 对它的依赖将在 Step 2 完成。
- [ ] 将 `QueryBaseConfig` 与 `buildQueryBaseConfig()` 移除未被 `PARSE_ARTICLE` 使用的 `permissionMode`、`permissionRules` 字段，避免新 Pi 模式意外传入 Claude SDK；确认 `agent-worker.ts:245-274` 的文章解析仍维持自己的 `dontAsk` 与 `allowedTools`。
- [ ] 为设置归一化所需的纯函数补最小测试或现有测试覆盖，至少覆盖旧自动执行、旧规划模式、缺失映射、额外/无效键、`ai` 或映射父对象结构损坏，以及重复执行规范化不再产生改动六类输入。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - pi-session.ts 删除了 `appendPermissionAllowRules` import 和调用（编译兼容），但 `handleToolCall` 中旧 `permissionRules` 读取改为 `as unknown as Record<string, unknown>` 过渡 cast，Step 2 整体重写时清除。
  - conversation-runtime-service.ts 新增了新→旧 PiPermissionMode 过渡映射（`autoExecute → 'bypassPermissions'`、`default → 'default'`），Step 2 统一为单一类型后删除。
  - 测试 13 个（计划写「最小测试或现有测试覆盖」，实际新建独立测试文件覆盖六类输入）。
- 改动文件清单：
  1. `electron/main/services/settings-types.ts` — 新增 PiPermissionMode/BasicToolName/BasicToolPermission/BasicToolPermissions 类型、BASIC_TOOL_NAMES 常量、createDefaultBasicToolPermissions() 工厂；ai.permissionMode 收窄两态；删除 permissionRules 和 subAgent.permissionMode；DEFAULT_SETTINGS 同步
  2. `types/settings.ts` — 前端类型同步上述变更
  3. `electron/main/services/settings-service.ts` — 新增 normalizeSettings() 幂等纯函数 + normalizePermissionMode() + normalizeBasicToolPermissions() helper；loadSettings() 调用后决定落盘；删除 appendPermissionAllowRules()
  4. `electron/main/agents/agent-query-config.ts` — QueryBaseConfig 删除 permissionMode/permissionRules 字段
  5. `electron/main/agents/pi-session/pi-session.ts` — 删除 appendPermissionAllowRules import 和 always_allow 分支调用（编译兼容）
  6. `electron/main/services/conversation-runtime-service.ts` — 子会话固定 autoExecute，主会话读 settings.ai.permissionMode，新增过渡映射
  7. `electron/main/services/settings-normalize.test.ts`（新增）— 13 测试覆盖旧模式映射、结构损坏恢复、幂等等

### 给下一步的接力棒

- 关键签名 / 数据结构：`BasicToolPermissions = Record<BasicToolName, BasicToolPermission>`，7 键 `read | write | edit | bash | Glob | Grep | Skill`；`createDefaultBasicToolPermissions()` 返回全 ask；`normalizeSettings()` 导出的幂等纯函数。设置层 `PiPermissionMode`（两态）与 pi-session/permission-mode.ts 旧 `PiPermissionMode`（6 态）暂时共存，Step 2 统一。
- 下个 step 该从哪里继续：重写 permission-mode.ts 为两态、permission-rules.ts 重构为基础工具目录、handleToolCall 整体重写、conversation-runtime-service 传 basicToolPermissions 快照、删除过渡映射。
- 待办或已知限制：pi-session.ts handleToolCall 有 `as unknown as Record<string, unknown>` 过渡 cast（Step 2 清除）；conversation-runtime-service 有过渡映射（Step 2 删除）；.claude/ 文档中的旧引用由 Step 4 doc-sync 处理。
