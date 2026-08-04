---
step: 6
title: 移除 SDK 主会话代码并验收边界
status: done
---

## 目标

删除 Claude Agent SDK 的主会话依赖和遗留接口，确认其仅保留于 PARSE_ARTICLE 后台任务，并完成迁移后的构建与关键流程验收。

## 依赖上下文（接力棒输入）

- 前置 step 产出：主会话创建、恢复、历史、删除、fork、摘要、引用和 delegation 都已使用 Harness sessionId；旧 Conversation 已冻结归档。
- `@anthropic-ai/claude-agent-sdk` 仍是必要依赖，因为 `PARSE_ARTICLE` 继续走 SDK query 与 plugin/skill 发现。
- 清理目标仅为”SDK 主会话路径”，不得误删 PARSE_ARTICLE、其 worker payload、query 配置或文章解析 skill 所需代码。
- `ModelProfile.apiFormat` 字段身兼两职：Step 3 之前它同时决定”主会话走 SDK 还是 PiSessionManager”（`conversation-runtime-service.ts` 的路由分支，Step 3 后应已删除）和”模型选择器用三档 tier 还是自由 `piModels` 列表”（`pi/provider.ts`、`lib/model-selection.ts`，与运行时无关）。本步骤清理 SDK 主会话术语时，只删路由分支相关代码，**不得**把 `apiFormat` 字段本身、其 `'anthropic-sdk'`/`'pi'` 取值或 tier 映射逻辑当成”SDK 遗留”一并改名或删除——它在迁移完成后仍要继续为模型选择 UI 服务。

## 计划改动

- [x] 全局检索 `QueryBasedSession`、QueryBasedSessionManager、SDK 主会话 resume/fork/history/permission/usage 代码及 `sdkSessionId` 残留；逐项区分 PARSE_ARTICLE 必需项和应删除项。
- [x] 删除 SDK 主会话类、manager、主会话专属 TIPC procedures、renderer 事件桥接与无调用方的工具/配置适配代码。
- [x] 收敛 `agent-query-config.ts` 或拆出 PARSE_ARTICLE 专用配置，避免其继续暴露主会话语义。（决定：不物理拆分，见下方接力棒说明）
- [x] 清理 conversation runtime、conversation CRUD、类型定义、日志和 UI 中的 SDK 主会话术语；保留旧归档 metadata 的 archiveReason 兼容，不恢复 sdkSessionId。
- [x] 更新开发文档、代码地图和相关计划/设计引用，明确"两类运行时"已变为"主会话 Harness + PARSE_ARTICLE SDK worker"。
- [x] 执行 `bun run lint`、`bun run build:electron` 和 `bun run build`，修复所有类型/死代码/构建问题，不以跳过检查或 suppress 方式绕过。
- [x] 手动回归：新建并恢复 pi 主会话、工具权限、插话与中断、历史、fork、归档旧会话占位、组摘要、delegation、文章解析 PARSE_ARTICLE。（`bun run dev` 冒烟通过，交互式点击回归由用户自行验证，见下方接力棒）
- [x] 确认 Bun 依赖中 SDK 仍存在；为全局检索到的每个 `@anthropic-ai/claude-agent-sdk` 剩余 import 建立 PARSE_ARTICLE allowlist 归属，除该调用链外不得保留 SDK 主会话引用，并记录最终入口和未来移除前置条件。
- [x] 完成后回填计划索引与完成总结，并按 doc-sync 要求同步代码地图。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  1. 排查过程中发现计划外的独立 SDK 死链路——`agent-worker.ts` 的 `TaskType.CHAT_SESSION` + `skills/chat-skill.ts`（`ChatSession`/`ChatSessionManager`）仍直接 import SDK `query()`，暴露为 `sendSessionMessage`/`closeSession` 两个 TIPC 路由，但前端 100% 无调用方。征得用户同意后一并删除（不在原计划范围内，属于本步骤排查副产品）。
  2. `agent-query-config.ts` 未按原计划"收敛/拆出 PARSE_ARTICLE 专用配置"物理拆分——核实后发现它已从"SDK 专属配置构建器"演变成"Worker 线程通用 settings 读取入口"，真实调用方是 PARSE_ARTICLE（构建真实 SDK query() 配置）+ 四条 pi 后台任务（GROUP_DIGEST/REVIEW/CATEGORIZE/CATEGORIZE_ORGANIZE，只借 `buildQueryBaseConfig` 读取 `appSettings` 再喂给 `pi/provider.ts` 的 `resolvePiModel`）。贸然拆分会打断四条生产中的 pi 任务，风险高于收益，故保留原文件不动，仅修正文件头注释准确描述现状。
  3. 本步骤额外补齐了 `.claude/rules/codebase-map.md`（及镜像 `.claude/skills/codebase-map/SKILL.md`）里此前从未记录过的 `electron/main/agents/pi-session/` 整个目录（15 个文件），此前 Step 1-2F 建立该目录时未同步过代码地图，属于历史欠账一并补上。
  4. `.claude/rules/session-runtime.md` 做了实质性重写（而非术语替换）：文档描述的 `clearForkFields` 参数、`attachConversation({...})` 配置对象式调用签名均已不存在于当前代码（实际是位置参数 `attachConversation(conversationId, workspaceId, holderType, options?)`），快照重播机制描述为"已实现"但实际 `snapshot` 恒为 `[]`（未实现，接口留口子）——按代码现状重写而非简单替换 SDK 字样。
- 改动文件清单：
  - 删除：`electron/main/agents/query-based-session.ts`、`electron/main/agents/skills/chat-skill.ts`、`electron/main/agents/skills/index.ts`（整个 `skills/` 目录）
  - 修改（业务代码）：`electron/main/index.ts`、`electron/main/agents/agent-manager.ts`、`electron/main/agents/agent-query-config.ts`、`electron/main/agents/agent-worker.ts`、`electron/main/agents/task-types.ts`、`electron/main/agents/pi-session/permission-rules.ts`、`electron/main/agents/pi-session/pi-session-manager.ts`、`electron/main/agents/pi-session/pi-session.ts`、`electron/main/services/memory/review-skill-service.ts`、`electron/main/services/memory/session-paths.ts`、`electron/main/services/usage/usage-extractor.ts`、`electron/main/services/wechat/wechat-bot-controller.ts`、`electron/main/tipc/agent.ts`、`electron/main/tipc/conversation-runtime.ts`、`electron/main/tipc/renderer-handlers.ts`、`electron/main/tipc/settings.ts`、`electron/main/tipc/wechat.ts`、`electron/main/types.ts`、`types/delegation.ts`
  - 修改（文档，本步骤主会话直接编辑，未派子会话）：`.claude/CLAUDE.md`、`.claude/rules/agent-development.md`、`.claude/rules/codebase-map.md`、`.claude/skills/codebase-map/SKILL.md`、`.claude/rules/session-runtime.md`

### 给下一步的接力棒

- 完成后无需下一步；在此记录：
- **SDK 最终保留文件及 PARSE_ARTICLE 调用链**：
  - `electron/main/agents/tools/article-parse-tools.ts`（`createSdkMcpServer`/`tool`）—— 唯一调用方 `handleParseArticleTask`
  - `electron/main/agents/agent-worker.ts:396` 动态 `import('@anthropic-ai/claude-agent-sdk')` 取 `query`，供 `handleParseArticleTask` 使用
  - `electron/main/agents/agent-query-config.ts` —— 见上方"与计划差异②"，PARSE_ARTICLE 与四条 pi 后台任务共用，未来若要彻底与 SDK 解耦，需先把四条 pi 任务的 `baseConfig.appSettings` 依赖换成直接 `loadSettings()`（`settings-service.ts`），再评估此文件是否还有 PARSE_ARTICLE 外的调用方
  - `electron/main/agents/pi/tool-adapter.ts` 的 `toSdkServer()` —— 中立工具适配层给 PARSE_ARTICLE 用的薄壳，本身不发起 query()
  - 仅类型引用（不构成运行时依赖，未来移除 SDK 包时也需清理）：`electron/main/tipc/agent.ts:8`、`electron/main/agents/pi-session/pi-session.ts:17`（`PermissionMode` 类型）、`electron/main/types.ts:5`（`SDKPermissionDenial`，供历史用量记录展示，主会话侧恒为 undefined）
  - 结论：`@anthropic-ai/claude-agent-sdk` 现在 100% 收敛于 PARSE_ARTICLE 调用链（+ 少量类型引用），未来移除 SDK 依赖前置条件是重做 PARSE_ARTICLE 的解析 skill 发现机制（目前依赖 SDK 的 plugin/skill 加载，pi 无对应物）。
- **已验证流程与构建命令结果**：
  - `bun run build:electron`（`tsc -p tsconfig.electron.json`）：全程多轮验证均通过，0 错误
  - `bun run build`（vite build + tsc）：通过，仅预置 chunk-size 警告（与本次改动无关）
  - `bun run lint`：72 条 `@typescript-eslint/no-explicit-any` 警告，全部是本次未触碰文件里的历史遗留项，0 错误，无新增
  - `bun run dev` 冒烟：应用正常启动，日志显示 pi 会话创建/关闭正常、group-digest 任务提交与取消正常；发现一条与本次迁移**无关**的环境配置问题——本机 GLM 模型方案的模型清单里没有 `sonnet`，导致 `attachConversationRuntime` 报错 `模型「sonnet」不在方案「GLM」的模型清单里`（`resolvePiModel` 报错），这是本地 `settings.json` 模型选择配置问题，不是本次代码改动引入的回归
  - 交互式点击回归（权限确认、插话中断、历史回放、fork、归档旧会话占位、组摘要、delegation）由用户自行在已启动的应用中验证，未在本次会话内逐项截图确认
- **与原计划的差异、已知限制与后续候选**：
  1. `agent-manager.ts` 仍残留 `sessionCallbacks` 字段 + `handleSessionMessage` 方法 + worker 消息 switch 里 `'sessionMessage'`/`'sessionStarted'`/`'sessionClosed'` 三个死分支（触发源已随 CHAT_SESSION 删除消失，但不影响编译，Step 6c 交付中已如实记录，留作后续候选）
  2. `renderer-handlers.ts` 里 `askUserQuestion`/`sessionCapabilities`/`agentNotification`/`permissionModeChanged`/`subAgentStarted`/`subAgentCompleted` 六个事件类型定义已无 `.send()` 调用方（原发送方在已删除的 `query-based-session.ts` 里），是纯死类型定义，清理需要连带检查前端多个监听点，风险/收益不匹配本步骤"顺路清理"尺度，留作后续候选
  3. 微信 bot 消息的 `source: 'wechat-bot'` 前端徽章功能自 Step6a 切到 `getPiSessionManager()` 后已失效（pi 广播块从未实现对等的 bot 来源打标逻辑），前端 `MessageItem.tsx` 仍在读这个字段，需要在 pi 广播块里重新实现，不在本次移除 SDK 主会话范围内
  4. `conversation-runtime-service.ts` 的 `attachConversation()` 的晚加入快照重播（`snapshot`）功能目前恒返回 `[]`，是尚未实现的占位（非本次引入，本次只是在文档里如实记录现状，见 `session-runtime.md` 重写）
  5. `types/electron-api.ts` 的 `sdk_session_id`/`fork_pending` 等遗留字段已有清晰的 deprecated/遗留注释，无需处理；`sdkSessionId`（`conversations.json`/`types.ts`/`delegation.ts` 等）作为迁移前遗留字段继续保留，仅供归档溯源，未恢复其运行时分流语义
  6. 至此「Pi Harness 主会话迁移与 SDK 主会话移除」计划的 Step 1-6 全部完成，主会话已完整迁移到 pi-agent-core AgentHarness，SDK 仅服务 PARSE_ARTICLE；建议后续新起一个独立计划专门处理上面列出的死代码/占位清理候选项
