# 组会话上下文互通 实施计划

**目标**：让组内新会话能通过派子会话按需拿到组背景 + 兄弟会话进展，主 agent 上下文永远干净；同时提供通用「引用历史会话」能力，共享底层去噪函数。

**架构思路**：主会话只装 DelegateTo，所有读组卡/兄弟会话/引用会话的脏活由子会话消化后 SubmitDelivery 回摘要。新增 background.md 作为轻量结构化背景（跟组卡在同一次 GROUP_DIGEST_SESSION 里一起产），砍掉 `_cleaned/` 留盘，收敛出底层 `readCleanTranscript` 纯函数。组卡从 `digests/<groupId>.md` 迁到 `groups/<groupId>/digest.md`。

**排除的方案**：主动注入组卡到 systemPrompt（浪费+污染）、后台 worker 生成 live 摘要（新增开销）、主 agent 直接装 ReadReferenceSession（污染主上下文）、前端加引用 chip UI（第一版靠 agent + ListSiblingSessions 足够）。

**设计文档**：见 [../group-session-context-design.md](../group-session-context-design.md)（背景/目标/完整数据流/迁移影响范围全在里面）。

**涉及模块**：
- Service：`transcript-cleaner.ts` / `group-digest-store.ts` / 新增 `background-store.ts` / 新增 `migration-p4.ts` / `group-digest-scanner.ts` / `group-digest-trigger.ts` / `review-scanner.ts` / `category-trigger.ts` / `conversation-service.ts`
- Tool：新增 `reference-tools.ts` / `group-digest-tools.ts`（加 SaveGroupBackground）/ `digest-tools.ts`（内部改用底层）/ `review-tools.ts`（内部改用底层）
- IPC：新增 `tipc/background.ts` / `tipc/digest.ts`（路径改）/ `tipc/conversations.ts`（创建会话传 group 信息）
- Agent：`query-based-session.ts`（systemPrompt append 注入）/ delegation 子会话工具装配
- Prompt：`group-digest-prompt.ts`（提示词加"同时产 background"）

## 步骤索引

- [x] [Step 1: 数据迁移 + `_cleaned/` 清理 + startup gate](./step1-migration.md) — 组卡从 `digests/<groupId>.md` 挪到 `groups/<groupId>/digest.md`，删掉 `_cleaned/` 留盘链路，加迁移期间的启动闸门
- [x] [Step 2: 底层 `readCleanTranscript` 收敛](./step2-clean-transcript.md) — 新增纯函数导出，CleanTranscript / TraceSource 内部改用它，删掉带副作用的 cleanTranscript
- [x] [Step 3: background.md 产物 + SaveGroupBackground 工具](./step3-background-md.md) — 新增 background-store + MCP 工具 + 提示词改造，让 GROUP_DIGEST_SESSION 一次产两个物
- [x] [Step 4: 子会话工具集 reference-tools](./step4-reference-tools.md) — 新增 ReadReferenceSession / ReadGroupBackground / ListSiblingSessions，装到子会话可用工具集
- [x] [Step 5: systemPrompt append 注入 + 端到端手测](./step5-systemprompt-inject.md) — 会话创建时按"组内非首个"判定注入两段 append，走一遍完整链路

## 全局决策

- **命名一致性**：所有跨会话读原文能力统一走 `readCleanTranscript` 纯函数；所有组内产物统一放 `groups/<groupId>/` 目录
- **产物落盘位置**：
  - 组卡：`<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`
  - 背景：`<configDir>/workspaces/<wsId>/groups/<groupId>/background.md`
  - 共享区：`<configDir>/workspaces/<wsId>/groups/<groupId>/shared/`（已存在，不动）
- **模型选择**：子会话默认走 `settings.subAgent.modelSelection`（不新增独立配置项），用户可自选便宜模型
- **错误处理原则**：
  - `readCleanTranscript` 对不存在的 sessionId 返回空串 + 明确 error 字符串（不 throw），子会话把这个原样交回给主 agent
  - `ReadGroupBackground` 对不存在的 background.md 返回 null，agent 应能凭 digest.md + ListSiblingSessions 兜底
- **提示词维护**：systemPrompt append 里列的工具名如果改了必须同步改文案（Step 4 和 Step 5 是这个耦合的两端）
- **测试策略**：项目不写单测，每个 step 完成后必须**手测验证**——step 文档里的「实施回填」要写手测怎么跑、观察到什么现象
- **不做兼容层**：迁移 one-shot，跑完删旧路径；不做双写观察期（按项目原则）
- **回填时机**：每个 step 做完立即在 stepN.md 回填「实际改动 + 接力棒」，plan.md 索引打勾——否则跨会话续做时接不上

## 完成总结

**总体产出**：主会话上下文永远干净，组内新会话能通过派子会话按需拿到组背景 + 兄弟原文；同时提供通用「引用历史会话」能力，共享底层 `readCleanTranscript` 去噪函数。

**实际改动一览**：

1. **数据搬家 + 迁移闸门**（Step 1）：组卡从 `digests/<groupId>.md` 挪到 `groups/<groupId>/digest.md`；删掉 `_cleaned/` 留盘链路；`migration-p4` 一次性迁移旧路径 + `migration-gate` 阻断运行时读旧路径
2. **底层收敛**（Step 2）：新增 `readCleanTranscript(workspacePath, sessionId, options)` 纯函数；CleanTranscript / TraceSource 内部改用它；删掉带副作用的 cleanTranscript
3. **background.md 新产物**（Step 3）：新增 `background-store.ts`（topic / progress / keyDecisions / openQuestions 结构化背景）+ `SaveGroupBackground` MCP 工具；GROUP_DIGEST_SESSION 提示词改造，一次产两个物
4. **子会话工具集**（Step 4）：新增 `reference-tools.ts` MCP server（`ReadReferenceSession` / `ReadGroupBackground` / `ListSiblingSessions`），装到 delegation 子会话，通过 closure 携带 workspaceId/groupId/parentConversationId，agent 无需传参
5. **systemPrompt 注入**（Step 5）：`buildSystemPrompt` 里插两段——A（REFERENCE_APPEND，所有主会话）+ B（groupAppendFor(groupName)，组内非首个主会话）

**与原设计的关键偏差**：

- Step 4：DelegateTo payload 未加 groupId/workspaceId 字段，全走子会话 conversation 记录的 groupId + role='sub' 自动携带；ReadGroupBackground / ListSiblingSessions 也做成零参数（groupId 从 closure）
- Step 5：**未采用「创建时持久化到 conversation.systemPromptAppend」方案**，改为 start() 时运行时算兄弟数 + 拼 append。理由见 step5-systemprompt-inject.md 的「与原 plan 差异」。老会话下次启动自动升级，无需迁移

**待跟进的 follow-up**：

- **端到端手测未跑**（只跑了 build + lint）：需要用户实际启动 app 后走一遍
  - 组内首个会话 → 主 agent systemPrompt append 只见 A 段
  - 同组第二个会话 → 主 agent 见 A + B（`{groupName}` 已替换）
  - 组内新会话第一句问「继续之前那个方向」→ 主 agent 自主派子会话 → 子会话工具池含 dogear-reference 三个工具 → 拿到摘要
  - 引用对话验证：孤立会话说「我上周聊过 xxx 主题」→ 主 agent 派子会话调 ReadReferenceSession
- **文档同步**：本次新增 background-store / reference-tools / migration-p4 / session-append-templates 等，建议下次跑 `/doc-sync` 更新 CLAUDE.md / codebase-map.md
- **提示词一致性**：groupAppendFor 里硬列了子会话可用工具名（ReadGroupBackground / ListSiblingSessions / ReadGroupDigest / ReadReferenceSession），如果 reference-tools 或 group-digest-tools 改名要同步改文案（session-append-templates.ts 是唯一改动点）
