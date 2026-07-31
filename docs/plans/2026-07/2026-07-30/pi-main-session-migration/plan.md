# pi 运行时迁移（阶段二：主会话）实施计划

**设计文档**：[../pi-main-session-migration-design.md](../pi-main-session-migration-design.md)（背景、取舍、能力清单对照表都在那里，本文件只讲怎么落）

**目标**：把主会话运行时从 `@anthropic-ai/claude-agent-sdk` 切到 pi，新旧两套长期共存（按 `ModelProfile.apiFormat` 路由），不预设删除 SDK 路径的时间点。本计划只覆盖**第一批最小可行集合**——做完即可日常把某个 Profile 切到 pi 使用；压缩/fork/子会话派遣/PARSE_ARTICLE 改造是第二批，做完第一批验证过模型质量风险后再单独立项规划。

**架构思路**：新建 `electron/main/agents/pi-session/` 目录，独立的 `PiSession`/`PiSessionManager` 类，与现有 `QueryBasedSession`/`QueryBasedSessionManager`（`query-based-session.ts`）**互不依赖、长期并存**，不抽共用运行时接口。两者只共享一份输出契约：产出相同结构的 `ExtendedSessionMessage`，走相同的 IPC 事件广播，前端零改动。`electron/main/tipc/agent.ts` 按会话所属 `ModelProfile.apiFormat` 路由到对应 Manager。

**涉及模块**：
- 新增 `types/settings.ts` + `electron/main/services/settings-types.ts` 的 `ModelProfile.apiFormat` 字段
- 新增 `app/settings/page.tsx` 里 Profile 表单的 apiFormat 下拉项
- 新增 `electron/main/agents/pi-session/`（多文件，具体划分见各 step）
- 改 `electron/main/tipc/agent.ts` / `electron/main/services/conversation-runtime-service.ts` 的路由逻辑
- 改 `components/agent-chat/hooks/usePendingState.ts`（配合 steer 的更细粒度状态）

## 步骤索引

- [x] [Step 1: apiFormat 路由 + PiSession 最小骨架](./step1-walking-skeleton.md) — 加字段、设置页 UI、新建 PiSession/PiSessionManager 骨架，跑通"发一句话、收到文字回复"的最短链路
- [x] [Step 2: Skill 加载器](./step2-skill-loader.md) — 手写 SKILL.md 扫描+索引+懒加载，接入 article-parser/review 两个现有 skill
- [x] [Step 3: 基础工具接入](./step3-basic-tools.md) — 文件类工具（Read/Write/Edit/Bash/Grep/Glob）+ dogear-memory 常驻工具，tool_use/tool_result 消息转换
- [x] [Step 4: 权限卡片](./step4-permission-card.md) — beforeToolCall 接入、原地修改参数技巧、始终允许规则复用
- [x] [Step 5: 插话队列](./step5-interrupt-queue.md) — steer()/followUp() 接入、usePendingState 三态状态机重新设计
- [ ] [Step 6: usage 统计](./step6-usage-tracking.md) — pi 事件 → ConversationUsageEntry 提取逻辑
- [ ] [Step 7: 联调验收](./step7-integration-verify.md) — 端到端跑真实任务，确认可日常切换使用，记录已知限制

## 全局决策

**依赖边界**
- 复用阶段一已完成的 `electron/main/agents/pi/`：`provider.ts`（`resolvePiModel`/`buildPiModels`）、`tool-adapter.ts`（`ToolDef`/`defineTool`/`toPiTools`）。**不复用** `run-once.ts`（一次性任务专用，主会话是长驻多轮，需要新的会话生命周期封装）。
- 不引入 `pi-agent-core` 的 `AgentHarness`。但 `harness/` 目录下部分模块已确认**不依赖** `AgentHarness` 本体、可独立引用其纯函数/工厂：`harness/skills.js`（skill 扫描，Step 2 参考但选择手写不直接 import，见 Step 2 决策）、`harness/tools/*.js`（`createReadTool`/`createBashTool` 等，Step 3 评估是否直接复用工厂函数）、`harness/compaction/compaction.js`（压缩算法，留第二批）。判断标准：拿它的纯函数/工厂时不要连带拉入 `Session`/turn 状态机等无关的强绑定。

**不做的事**
- 不抽同时兼容 SDK 和 pi 的运行时接口，`PiSession` 与 `QueryBasedSession` 是两个独立类。
- 不在代码里留 feature flag 控制"是否启用 pi"——路由靠 `ModelProfile.apiFormat` 字段本身，不是开关。
- 不做市场插件生态（`settingSources`/`enabledPlugins`）的替代，pi 路径下这些不可用。
- 不在第一批实现压缩、fork/对话树持久化、子会话派遣（`CreateSession`/`SendMessage`/`WaitForMessage` 等 delegation 工具）、`group`/`reference` 工具（本质是子会话基础设施）、`PARSE_ARTICLE` 改造、`stock`/`article`/`announcement` 等业务工具包。这些是第二批，做完第一批验证后再规划。
- 第一批 `ExtendedSessionMessage` 只覆盖核心交互类型：`text`/`tool_use`/`tool_result`/`thinking`/`permission_request`/`ask_user_question`/`result`/`error`。Hook 类（`session_start`/`session_end`/`stop`/`notification`/`tool_failure`）、`compact_boundary`/`compacting`、`task_notification` 暂不产出——前端对应 UI 没有事件就是不显示，不影响基本对话可用性。

**Manager 架构**
- 新建独立的 `PiSessionManager`（`electron/main/agents/pi-session/` 下），不改造现有 `QueryBasedSessionManager`。两套 Manager 并存，`agent.ts` 在调用入口按 `apiFormat` 路由到对应实例，其余调用点签名保持一致（`getSession`/`sendMessage`/`interrupt`/`setPermissionMode`/`respondPermissionRequest`/`respondAskUserQuestion`/`setModel`/`setCachePolicy`/`getSupportedCommands`/`retain`/`release`/`closeSession`/`getConversationIdBySession`/`bindConversation`）。
- `MAX_ACTIVE_SESSIONS` 等限制两套各自维护，不强行提取共享常量（等最终删除 SDK 路径时这类问题自然消失）。

**工具约定**
- 沿用阶段一约定：`ToolDef.schema` 用 zod，`toPiTools` 转换。dogear 自定义工具（`memory-tools.ts` 等）已经是 `ToolDef` 形状，直接复用。
- 复刻 SDK 内置工具（Read/Write/Edit/Bash/Grep/Glob）时，如果决定直接复用 `harness/tools/*.js` 的工厂函数（它们是 TypeBox schema，不是 zod ToolDef 形状），允许绕过 `ToolDef` 中间层直接产出 pi 的 `AgentTool`，不强行套壳成 `ToolDef` 再转回去——具体选择在 Step 3 执行时调研 `env` 接口形状后确定。

**验证方式**
- `bun run build:electron` + `bun run lint`，加手测。项目不写单测。
- 每一步验收是"真实可用"，不是"代码能跑"——尤其 Step 7 要求真正切一个 Profile 到 pi、跑几个日常任务。

## 已知限制（第一批完成后仍然存在，第二批解决）

- 无法 fork 对话、无法查看/切换分支
- 长对话不会自动压缩，达到模型上下文上限后会报错或截断（具体行为看 Step 1-3 实现，不专门处理）
- 无法使用子会话派遣（`CreateSession`/`SendMessage` 等），也就无法在 pi 会话里执行需要委派子代理的复杂任务
- 无法使用 `group`/`reference`（组共享区、跨会话引用）
- 无法使用市场插件 skill（`shadcn`/`frontend-design`/`claude-api` 等）
- 无法使用 stock/article/announcement 等业务工具包（先只挂文件类 + memory）
- `PARSE_ARTICLE` 任务链路不受影响（仍走 SDK，第一批不动）
