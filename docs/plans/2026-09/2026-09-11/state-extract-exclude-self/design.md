# 话题状态抽取排除自身 设计

**背景**：话题状态卡的 stale 判定（`getStaleConversations`）只有「sessionId 未见于 sourcesSeen」或「mtime 前进」两个条件，没有「排除调用者自己」的概念。导致：组内第一个会话开局按指引调 `dogear__ReadGroupBackground` 时，stale 全量返回（组里只有它自己），触发抽取提炼自己才一两轮的开局对话，过早确立话题背景并联动组标题；运行中的会话 mtime 持续前进，每轮调工具都会把自己列入待抽名单。开局注入的指引句恒注入（实施决策「主体句保留」），组里只有自己时也是白引导。

**目标**：
1. 抽取触发与未提炼列表一律排除当前会话自身；自身内容由下一个会话开局时补抽（提炼是给后来者看的，语义正好对）
2. 指引动态注入：排除自己后无前人状态（无卡且无其他未提炼会话）→ 不注入「开局先调 ReadGroupBackground」指引，省一次无意义工具调用
3. 同步设置页常驻「会话组上下文（模板说明）」：该段是 buildGroupContextPrompt 输出的示例快照（session-append-templates.ts 的 GROUP_CONTEXT_EXAMPLE，仅供设置页只读预览），现状只示例了组头、缺「### 话题状态」段——补齐示例并更新 triggerDescription，使其与真实输出一致
4. 边界（已拍板）：组内其他正在运行的并行会话照常抽，内容不完整可接受——抽取增量幂等，后续重抽自然修正，不查运行态

**架构**：给「排除自己」这一语义打通一条参数链（注册处 conversationId → 工具/注入构造 → ensureGroupFresh → getStaleConversations），复用 `parentConversationId` 排除父会话的既有模式；注入侧指引句从恒注入改为条件注入。不做运行态查询、不改抽取执行器、不改状态卡 schema。

**模块边界**：
- `electron/main/services/memory/background-store.ts` — `getStaleConversations(wsId, groupId, excludeConversationId?: string)`：mainConvs 过滤 `c.id === excludeConversationId`（在 stat 之前，省无谓 IO）
- `electron/main/services/memory/state-extract-trigger.ts` — `ensureGroupFresh(wsId, groupId, timeoutMs, excludeConversationId?)` 透传
- `electron/main/agents/tools/reference-tools.ts` — `ReferenceToolsOpts` 加 `selfConversationId?: string`；ReadGroupBackground handler 两处 `getStaleConversations`/`ensureGroupFresh` 调用均传（读时同步 + 失败分支的未提炼列表）
- `electron/main/agents/group-context-builder.ts` — `buildGroupContextPrompt`/`buildTopicStateSection` 接收 `selfConversationId?`；stale 派生传 exclude；指引注入条件改为 `topic || stale.length`——无话题且排除自己后无未提炼会话时，仅保留「本组还没有提炼过的话题状态，不要虚构。」一句，不注入指引
- `electron/main/agents/pi-session/pi-session.ts` — 395 行 `buildGroupContextPrompt` 与 568/658 两处 `createReferenceToolDefs` 均传 `this.config.conversationId`
- `electron/main/agents/session-append-templates.ts` — `GROUP_CONTEXT_EXAMPLE` 补「### 话题状态」段示例（话题背景/最近未提炼会话/指引，注明指引仅在有前人状态时注入）；`group-context` 段 triggerDescription 更新为：会话属于某个组时注入，内容 = 组头（组标题+共享区引导）+ 话题状态轻量头（有前人状态才含 ReadGroupBackground 指引）

**数据流**：会话注册工具/构建 systemPrompt 时携带自身 conversationId → ReadGroupBackground 调用 → ensureGroupFresh 排除自己 → stale 为空直接 synced=true 秒回（无卡时返回提示文本）→ 不提交抽取任务；开局注入同理，未提炼列表不再包含自己。

**错误处理 / 边界情况**：
- `selfConversationId` 缺省（undefined）= 不排除，保持现行为，向后兼容
- 排除自己后 stale 为空且无卡：ReadGroupBackground 秒回「尚未生成」提示，指引也不注入，第一个会话零浪费开局
- 并行运行中的其他会话仍会被抽（拍板不处理）；失败会话不推进 sourcesSeen 的既有重抽语义不变

**未决问题**：无
