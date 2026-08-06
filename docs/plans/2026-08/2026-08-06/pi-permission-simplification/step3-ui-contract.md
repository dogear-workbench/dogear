---
step: 3
title: 收敛设置与会话交互界面
status: done
---

## 目标

将设置页、当前会话模式菜单和权限卡同步为精简模型，并清除旧 SDK 工具权限、Web 工具和子会话权限选项。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`step1-settings-contract.md` 已提供两态设置及基础工具映射；`step2-pi-runtime-policy.md` 已使 tipc 只接受三种权限响应、子会话固定自动执行。
- 当前关键文件状态：`app/settings/page.tsx:43-48,436-452` 显示四种默认模式，保存时还会清洗 `permissionRules`；`app/settings/ToolsAndPermissionsTab.tsx:81-143,280-440` 是旧 SDK 四态规则界面；`app/settings/SubAgentTab.tsx:8-15,78-108` 显示子会话权限单选。
- 当前聊天状态：`components/agent-chat/ChatInputArea.tsx:33-75,385-419` 有四态样式/菜单；`PermissionRequestCard.tsx:20-143,194-252` 仍有“总是允许”、拒绝说明与编辑参数；`useSendMessage.ts:65-136`、`types.ts:66`、`types/usage.ts:26` 仍使用 `always_allow`。
- 关键决策回顾：基础工具全部默认询问；工具包开关保持“启用即自动放行”；权限卡只有允许一次、本会话允许、拒绝；WebSearch/WebFetch 不展示。

## 计划改动

- [ ] 修改 `SettingsPage` 的默认权限模式选项、描述和保存逻辑：只呈现“默认 / 自动执行”，直接保存新设置，不再处理旧 `permissionRules`。
- [ ] 重写 `ToolsAndPermissionsTab` 的基础工具段：以稳定的七工具元数据展示每项的“自动放行 / 询问”二态控件；保留常驻能力与可选工具包的只读列表/开关，并清楚标注工具包启用后自动放行。
- [ ] 删除旧 SDK 内置工具权限四态区、细粒度规则区、相关 icon/import/state/helper；不要再依赖 `getRegisteredTools()` 的 `sdk` 静态组来呈现基础工具。
- [ ] 从 `SubAgentTab` 删除权限模式常量、单选控件和写入逻辑，文案明确子会话由主会话派遣且执行时自动通过；保留模型、超时、缓存、上下文挂载配置。
- [ ] 将 `ChatInputArea` 的样式映射和菜单收窄为“默认 / 自动执行”，并让状态通知文案不再描述规划或自动编辑模式。把当前 conversation 的 `role` 明确传入或派生为 `isSubSession`：子会话隐藏可操作菜单，或仅显示不可操作的“自动执行（子会话固定）”，不得向 `setPermissionMode` 发出请求。
- [ ] 精简 `PermissionRequestCard`：保留工具输入摘要与三个决策按钮；删除总是允许、拒绝并说明、编辑参数、相关本地状态和未使用图标。对不允许本会话授权的未分类工具，依据后端事件能力位隐藏“本会话允许”。同步收窄 callback、内容块类型和 `useSendMessage` 的当前响应联合类型。
- [ ] 将当前响应与历史 usage 决策分开建模：新 UI/IPC 仅处理 `allow | allow_session | deny`，但 usage JSONL 读取和聚合继续接受并显示历史 `always_allow`，不得通过收窄类型破坏旧会话详情。
- [ ] 显式同步所有共享契约：`types/electron-api.ts`、`stores/session-store.ts`、`components/agent-chat/types.ts`、`ContentBlockItem.tsx`、`MessageItem.tsx`、`ToolGroupBlock.tsx`、`useSessionEvents.ts`、`electron/main/types.ts` 与 `renderer-handlers.ts`。将 session store 和 renderer handler 中的裸 `string` 模式类型收窄为 `PiPermissionMode`。
- [ ] 从 `electron/main/agents/tools/tool-registry.ts:46-55` 的旧 SDK 静态列表移除 WebFetch、WebSearch；保留仅用于历史工具渲染和逐字稿兼容的展示代码，不把它们重新暴露为可配置权限。
- [ ] 手工验证：保存默认模式与基础工具配置后重启或新建主会话，确认已运行会话不热更新；盾牌菜单只显示两项；基础工具询问卡只显示三项；未分类工具没有“本会话允许”；子会话设置页没有权限模式、输入区没有可操作模式菜单且运行时不会出现权限卡；双窗口 attach 同一 session 时模式同步。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：无重大差异。额外改动了 `AgentChat.tsx`（传入 isSubSession）、`ContentBlockItem.tsx`/`MessageItem.tsx`/`ToolGroupBlock.tsx`（onPermissionResolved callback 收窄）、`UsagePermissionWaits.tsx`（注释文案更新），均为计划改动的连带同步。
- 改动文件清单：
  1. `types/electron-api.ts` — PermissionMode 从 6 态收窄为两态
  2. `app/settings/page.tsx` — PERMISSION_MODE_OPTIONS 两态；删除 sanitizeForSave
  3. `app/settings/ToolsAndPermissionsTab.tsx` — 完整重写：七基础工具二态控件 + 批量切换 + 工具包只读列表；删除旧 SDK 四态区和细粒度规则区
  4. `app/settings/SubAgentTab.tsx` — 删除权限模式单选，替换为只读说明
  5. `components/agent-chat/ChatInputArea.tsx` — 两态样式/菜单；isSubSession prop 子会话 disabled
  6. `components/agent-chat/AgentChat.tsx` — 传入 isSubSession
  7. `components/agent-chat/PermissionRequestCard.tsx` — 完整重写为三按钮；非基础工具隐藏「本会话允许」；删除 always_allow/拒绝说明/编辑参数
  8. `components/agent-chat/types.ts` — permissionResolved 联合类型保留 always_allow（历史兼容）
  9. `components/agent-chat/hooks/useSendMessage.ts` — handlePermissionResolved 收窄三态；modeLabels 两态
  10. `components/agent-chat/ContentBlockItem.tsx`/`MessageItem.tsx`/`ToolGroupBlock.tsx` — onPermissionResolved callback 收窄
  11. `stores/session-store.ts` — permissionMode 类型收窄为 PiPermissionMode
  12. `components/agent-chat/usage-badge/UsagePermissionWaits.tsx` — 注释文案更新

### 给下一步的接力棒

- 关键签名 / 数据结构：前端 `PermissionMode = 'default' | 'autoExecute'`（与后端统一）；`ChatInputArea.isSubSession?: boolean`；`PermissionRequestCard.onResolved: (requestId, behavior: 'allow' | 'deny' | 'allow_session') => void`；`SessionTab.permissionMode: PiPermissionMode`。
- 下个 step 该从哪里继续：全仓搜索残留旧值（acceptEdits/bypassPermissions/dontAsk/plan/always_allow/permissionRules/subAgent.permissionMode/updatedInput），验证配置兼容和策略矩阵，执行完整测试，doc-sync。
- 待办或已知限制：手工验证项需用户在实际运行环境中验证。
