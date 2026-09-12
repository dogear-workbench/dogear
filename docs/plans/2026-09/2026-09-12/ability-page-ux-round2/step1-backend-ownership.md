---
step: 1
title: 后端工具归属修正
status: done
---

## 目标

修正三处工具归属：extension 并入 browser 包（主会话给真入口）、reference 拆出「跨会话检索」常驻组、SYSTEM_BEHAVIORS 移除 profile-index（消除"不可关"错误语义）。

## 依赖上下文（接力棒输入）

- 设计定案：[design.md](./design.md) 第五节 + plan.md「全局决策」
- 关键现状：
  - `electron/main/agents/ability-registry.ts`：`ABILITY_PACKS` browser 包 `toolGroups: ['browser']`（约 130 行）；`SYSTEM_BEHAVIORS` 3 条（约 230-260 行，profile-index 条目 segmentKey 指向 main-agent-delegation）
  - `electron/main/agents/tools/reference-tools.ts`：4 个工具同组（ListTopics / ReadReferenceSession / ReadGroupBackground / ListSiblingSessions），`createReferenceToolDefs(opts)` 需要 `{ workspaceId, groupId, parentConversationId?, selfConversationId? }`
  - `electron/main/agents/pi-session/pi-session.ts`：主会话协作组注册在 `buildMainAgentToolDefs`（约 684 行 `groupId && activeAbilities.has('agent-collab')`）；extension 在 OPTIONAL_TOOL_PACKS switch（约 665 行，死分支）；子会话 reference 在 `buildSubAgentToolDefs`（`ab.reference === true`）
  - `electron/main/services/tool-packs.ts`：OPTIONAL_TOOL_PACKS 共 6 条，无 extension 条目
  - `electron/main/agents/session-append-templates.ts`：memory-guidance 的 triggerDescription（约 128 行）

## 计划改动

- [ ] `reference-tools.ts` 拆组：ListTopics + ReadReferenceSession 拆为新的 `createHistorySearchToolDefs(workspaceId)`（不需要 groupId / parentConversationId），registerToolGroup 新 server（命名建议 `dogear-history`，label「跨会话检索」）；ReadGroupBackground + ListSiblingSessions 留守 `dogear-reference`，opts 里不再用的字段清理（selfConversationId 仍被 ReadGroupBackground 用，保留）
- [ ] `pi-session.ts` 主会话 `buildMainAgentToolDefs`：
  - 新增：`workspacePath` 存在时注册 `dogear-history` 常驻组（不受 activeAbilities / groupId 约束）
  - `dogear-reference` 组只注册剩余两个组协作工具（条件保持 `groupId && activeAbilities.has('agent-collab')`）
  - extension 从 OPTIONAL_TOOL_PACKS switch 中移出，改为独立分支：`activeAbilities.has('browser')` 时注册（`registerPack('extension', ...)`），`enabledToolPacks` 不再作为依据
- [ ] `pi-session.ts` 子会话 `buildSubAgentToolDefs`：
  - `workspacePath` 存在时注册 `dogear-history` 常驻组（不查 Profile 细闸——通用检索是基础设施）
  - `dogear-reference` 保持 `groupId && ab.reference === true`（管组协作两工具）
  - extension 改为 `activeAbilities.has('browser') && ab.extension === true`
- [ ] `ability-registry.ts`：browser 包 `toolGroups` 加 `'extension'`，description 改为提及双通道（内嵌浏览器 + 扩展通道）；`SYSTEM_BEHAVIORS` 删除 profile-index 条目（前两条保留）
- [ ] `tool-packs.ts`：extension 不补 OPTIONAL_TOOL_PACKS 条目（已并入 browser 包，switch 分支移除后在文件头注释补一句说明）；如 OPTIONAL_TOOL_PACKS 的消费方有 extension 假设的注释一并修正
- [ ] `session-append-templates.ts`：memory-guidance triggerDescription 补「无工作区主会话现状兜底注册工具（工具注册不受此段开关约束）」
- [ ] `electron/main/agents/ability-registry.test.ts`：同步断言（browser toolGroups、SYSTEM_BEHAVIORS 数量 3→2）；如有 reference 相关测试同步
- [ ] 验证：`bun run lint` + `bun run build:electron` + 相关测试（`bun test electron/main/agents/ability-registry.test.ts`，或全量 `bun test`）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - browser 包 toolGroups 存 `'dogear-extension'`（server 名）而非任务原文的 `'extension'`：两个消费方决定——tipc/ability.ts 的 buildToolGroupMeta 对不在 OPTIONAL_TOOL_PACKS 的 id 走常驻组路径查 tool-registry server 名（存 'extension' 会查空，label 回退裸 id、工具列表空）；getAbilityMounts 的 enabledToolPacks ∩ toolGroups 过滤用 server 名让旧配置残留 'extension' 天然静默忽略，符合设计「旧残留静默忽略」意图。TOOL_PACK_TO_ABILITY 由此含 'dogear-extension' → 'browser'，任务 toolPacksOverride 残留会 match browser 包，语义合理。
  - 计划外连带：tipc/ability.ts PACK_TOOL_MODULE_IMPORTS 加 extension-tools.js（extension 进包体系后，browser 包详情需展示 dogear-extension 组工具明细，不 import 则 getAllToolGroups 拿不到）；reference-tools 的 ReferenceToolsOpts 删掉了无人使用的 workspacePath 字段。
- 改动文件清单：
  - electron/main/agents/tools/reference-tools.ts：拆两组，新增 createHistorySearchToolDefs(workspaceId)（ListTopics + ReadReferenceSession，注册 dogear-history「跨会话检索」）；createReferenceToolDefs 留守 ReadGroupBackground + ListSiblingSessions，opts 清理为 { workspaceId, groupId, parentConversationId?, selfConversationId? }
  - electron/main/agents/pi-session/pi-session.ts：主会话 extension 移出 OPTIONAL_TOOL_PACKS switch 改独立分支（只看 activeAbilities.has('browser')）；主/子会话 workspacePath 存在即注册 dogear-history；子会话 extension 改 activeAbilities.has('browser') && ab.extension === true 双闸；dogear-reference 两处注册参数清理；相关注释更新
  - electron/main/agents/ability-registry.ts：browser 包 toolGroups = ['browser', 'dogear-extension'] + 描述改双通道；SYSTEM_BEHAVIORS 删 profile-index（3→2）；toolGroups 混合语义注释与 TOOL_PACK_TO_ABILITY jsdoc 更新
  - electron/main/services/tool-packs.ts：头注释补 extension 并入 browser 包说明
  - electron/main/agents/session-append-templates.ts：memory-guidance triggerDescription 补无工作区兜底注册说明
  - electron/main/tipc/ability.ts：PACK_TOOL_MODULE_IMPORTS 加 extension-tools.js
  - electron/main/agents/ability-registry.test.ts：新增「工具归属修正」describe（browser toolGroups 断言、SYSTEM_BEHAVIORS 数量 3→2 断言）
- 验证：bun run lint（0 errors，87 个既有 any 警告）+ bun run build:electron（通过）+ 全量 bun test（289 pass / 0 fail）全绿。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - createHistorySearchToolDefs(workspaceId: string): ToolDef[]——dogear__ListTopics + dogear__ReadReferenceSession；tool-registry 新组 server='dogear-history'，label「跨会话检索」，placeholder ['']
  - createReferenceToolDefs({ workspaceId, groupId, parentConversationId?, selfConversationId? })——dogear__ReadGroupBackground + dogear__ListSiblingSessions；组 server/label/placeholder 不变
  - 前端常驻区数据：dogear-history 组已经由 getRegisteredTools / getAllToolGroups 自然可见（reference-tools.js 在 ability.ts 与 agent.ts 的 import 列表里，一次 import 同时注册两组）
  - browser 包 toolGroups = ['browser', 'dogear-extension']；前端展示第二组时 label 取 tool-registry 的「浏览器扩展」
  - memory 工具注册现状不变：主会话 !workspacePath || memory 包生效；无工作区兜底事实已写入 triggerDescription 文案
- 下个 step 该从哪里继续：前端 step 从设计第一~四节开始（规则合并卡 / 渲染字号 / 详情页布局 / 系统行为三区）；常驻区（基础工具 + dogear-tasks + dogear-history）数据可从 getRegisteredTools（agent.ts IPC）取，系统行为三区的常驻工具区按设计文档第四节组织
- 待办或已知限制：
  - ListTopics 工具描述仍提示「用 dogear__ReadGroupBackground 深挖」，后者在无组/关协作包的会话不可用——描述是通用指引，现状已如此（子会话 reference=false 同样），未改；若前端常驻区觉得碍眼可后续微调描述
  - 设置页 ToolPacksTab 的 browser 开关（enabledToolPacks 细闸）只影响内嵌浏览器组；extension 组只受能力页 browser 包总闸——两入口开关语义不重叠是设计拍板（能力页为唯一归属入口），ToolPacksTab 后续是否收编不在本步范围
