# Pi 权限简化设计

**背景**：主会话从 Claude Agent SDK 迁移到 Pi 后，为兼容旧 SDK 保留了多种权限模式、`allow/ask/deny` 规则、持久化“总是允许”及工具包特判。该模型复杂，且“自动执行”仍会被部分规则拦截，不符合直觉。

**目标**：把主会话权限收敛为“默认”和“自动执行”两种模式。默认模式只由基础工具的逐项“自动放行/询问”配置决定；已启用工具包始终自动放行。自动执行模式忽略一切设置、无条件放行。子会话永久自动执行，不显示也不等待权限确认。

**架构**：Pi 的 `AgentHarness.tool_call` 仍是唯一拦截点；`PiSession.handleToolCall()` 改为执行精简策略，不再实现 SDK 的 `permissionRules` 兼容层。

```text
工具调用
  ├─ 子会话 → 自动放行
  ├─ 主会话 + 自动执行模式 → 自动放行
  ├─ 主会话 + 已启用工具包 → 自动放行
  ├─ 主会话 + 默认模式 + 基础工具配置为自动放行 → 自动放行
  └─ 主会话 + 默认模式 + 基础工具配置为询问 → 权限卡
       ├─ 允许一次
       ├─ 本会话允许
       └─ 拒绝
```

排除的方案：不保留 `plan`、`acceptEdits`、`dontAsk`、旧 `bypassPermissions` 语义；不保留 `allow/ask/deny` 规则、Bash 命令正则、持久化“总是允许”或按工具包外的额外白名单。它们会重新引入难以解释的优先级。

**权限模型**：

- 主会话权限模式只有 `default` 与 `autoExecute`。`autoExecute` 不读取基础工具配置、工具包状态之外的任何权限规则，所有已注册工具都允许执行。
- 默认模式按基础工具配置决定行为。基础工具按用户可见的集合定义为 `read`、`write`、`edit`、`bash`、`Glob`、`Grep`、`Skill`；技术上非 Pi 原生的 Glob、Grep、Skill 也纳入同一配置，避免暴露运行时差异。
- 基础工具设置值只有 `allow` 与 `ask`。新安装和迁移后的默认值均为全部 `ask`，即默认模式初始会对每个基础工具请求确认；用户可逐项改成 `allow`。
- 已启用的可选工具包及 Dogear 常驻工具包自动放行，不参与基础工具设置。
- `allow_session` 只对当前主会话内同名基础工具生效，关闭会话后失效；`allow` 仅放行当前调用；`deny` 阻止当前调用。不存在跨会话“总是允许”。
- 子会话始终自动执行，不读取主会话模式或基础工具配置，不产生权限卡，也不保留独立的权限模式设置。主会话是否创建子会话是唯一的用户把控点。

**模块边界**：

- `electron/main/agents/pi-session/permission-mode.ts`：缩减模式类型为两种，并提供旧持久化值到新模式的安全归一化。
- `electron/main/agents/pi-session/permission-rules.ts`：替换为基础工具目录、基础工具配置校验与默认值（全部询问）；删除 SDK 规则、编辑命令正则和工具包特判逻辑。
- `electron/main/agents/pi-session/pi-session.ts`：重写 `handleToolCall()` 的策略；保留请求挂起、一次允许、本会话允许和拒绝；删除 `always_allow`、`appendPermissionAllowRules()` 与 `permissionRules` 读取。子会话在此处无条件放行。
- `types/settings.ts`、主进程 settings 类型：删除主会话和子会话的旧权限规则/模式字段，新增基础工具权限映射与两种模式默认值。
- `electron/main/services/settings-service.ts`：加载旧设置时归一化历史模式；不再写入或追加旧 `permissionRules`。
- `app/settings/page.tsx`、`app/settings/ToolsAndPermissionsTab.tsx`：将界面改为两种默认模式和七个基础工具的“自动放行/询问”开关；删除 SDK 内置工具权限规则、细粒度允许规则以及 WebSearch/WebFetch 条目。工具包开关保留，但文案明确“启用后自动放行”。
- `components/agent-chat/ChatInputArea.tsx`、`components/agent-chat/PermissionRequestCard.tsx`：主会话菜单只显示“默认/自动执行”；权限卡只显示“允许一次/本会话允许/拒绝”。
- 子会话设置与派遣链路：移除 `subAgent.permissionMode` 的读取和 UI；创建子会话时固定传入 `autoExecute`。
- `electron/main/tipc/agent.ts` 和 renderer 类型：收窄权限模式、权限响应行为的 zod/TypeScript 联合类型，保持 tipc 通讯而不改变 IPC 模式。

**数据流**：

1. 用户在设置页保存默认模式与基础工具映射到 `.dogear/settings.json`。
2. 新建或重启主会话时读取默认模式；输入框菜单的切换只更新当前 `PiSession` 内存状态。
3. 主会话每次工具调用进入 Harness Hook：先判断自动执行模式，再判断工具包，再查询基础工具配置；需要询问时发出权限请求并挂起。
4. 用户在权限卡选择一次允许、会话允许或拒绝，前端经现有 tipc 路由返回；不产生任何跨会话规则写入。
5. 子会话工具调用直接放行。

**迁移与边界情况**：

- 旧 `permissionRules`、旧“总是允许”的裸工具名和 SDK 格式规则均不参与新决策，可在保存新设置时清理。
- 历史 `bypassPermissions`、`dontAsk`、`auto` 归一化为 `autoExecute`；历史 `default`、`acceptEdits`、`plan` 或未知值归一化为 `default`。无论来源如何，基础工具初始映射缺失时补全为全部 `ask`。
- 自动执行模式必须在任何基础工具/工具包判断前返回允许，保证“忽略所有设置”的承诺。
- 未注册的工具（包括当前不可用的 WebSearch、WebFetch）不出现在基础工具配置，也不影响运行时判定。
- 旧会话在代码升级后继续运行时，应对其内存中的旧模式做归一化，避免 UI 与运行时不一致。

**未决问题**：无。
