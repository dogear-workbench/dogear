# pi 运行时迁移设计（阶段二：主会话）

**背景**

[[pi 运行时迁移阶段一](../2026-07-27/pi-runtime-migration-design.md)]已把三条后台一次性链路（GROUP_DIGEST/REVIEW/CATEGORIZE）从 `@anthropic-ai/claude-agent-sdk` 切到 pi（`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`），2026-07-29 收尾，验证通过。阶段一明确不动主会话（`query-based-session.ts`），并列出两个遗留问题：① `PARSE_ARTICLE` 依赖 SDK 的 `plugins` skill 发现机制，pi 无对应物；② 主会话复杂度不是一个量级，需要单独设计。本文档是这两个问题的讨论结果。

**目标**

- 把主会话（用户日常主力对话，承载权限卡片/插话队列/流式 UI/fork/子会话派遣等全部交互能力）迁到 pi 运行时。
- 迁移期间新旧两套运行时**长期共存**（不是短期双跑对比，是持续可用、可回退的两条路径），直到 pi 版本经过真实使用验证，再删除 SDK 版本。
- 顺带解决 `PARSE_ARTICLE` 对 SDK `plugins` 机制的依赖，让它也能脱离 SDK 独立运行。

---

## 架构

### 核心判断：前端与 SDK 零耦合，耦合点全部在主进程转换层

调研确认（详见下方"数据流"一节）：`query-based-session.ts` 内部通过 `convertSDKMessage()` 把 SDK 原始消息转成 dogear 自定义的 `ExtendedSessionMessage`，再经固定的 IPC 事件（`queryBasedSessionMessage`/`permissionRequest`/`askUserQuestion`/`usageEntryAdded`）广播给渲染进程。前端组件（`MessageItem`/`ContentBlockItem`/`PermissionRequestCard`/`AskUserQuestionCard`/usage-badge 系列）全部消费这套自定义类型，`components/`、`stores/` 目录搜不到任何 SDK 类型引用。

**结论**：新写一套 pi 版主会话运行时，只要它产出与现有实现完全一致的**事件名 + payload 结构**，前端可以零改动。两套运行时是两个独立的"生产者"，实现同一份输出契约，不是互相依赖关系——天然适合长期共存，这与阶段一"不抽同时兼容两个引擎的运行时接口"的原则并不矛盾：不是抽象共用的运行时接口，而是共用**输出契约**（`ExtendedSessionMessage` + IPC 事件名），两套生产者各写各的。

### 排除的选项

- **抽一个 `AgentRuntime` 接口同时驱动 SDK 和 pi**——重复阶段一已排除的错误，容易被最小公倍数绑架。改为两个具体类（`QueryBasedSession` 继续用 SDK，新增 `PiMainSession` 或类似命名）各自独立实现，只共享"产出 `ExtendedSessionMessage`"这个契约（类型层面的契约，不是运行时抽象）。
- **同一会话双跑对比（shadow 模式）**——需要同时发起两次真实 API 调用、UI 要支持展示两份结果，成本远超收益，只在验证阶段用一次性对比脚本即可，不做成常驻机制。
- **仅在开发者调试入口暴露 pi 版本**——不采用。既然要长期共存到验证通过为止，直接按 `ModelProfile.apiFormat` 路由更符合"最终会开放给用户选择"的目标，不需要额外一层"开发者开关"。
- **整套引入 pi-agent-core 的 `AgentHarness`**——见下方"skill 加载"一节，已排除。

### 路由机制：`ModelProfile.apiFormat`

阶段一设计文档预留了这个字段（"二期加字段时 provider.ts 已预留形状"）。正式启用：

```ts
// electron/main/services/settings-types.ts（同步改 types/settings.ts）
export interface ModelProfile {
  // ...现有字段不变
  /** 运行时格式，缺省 'anthropic-sdk'（走现有 Claude Agent SDK） */
  apiFormat?: 'anthropic-sdk' | 'pi';
}
```

会话创建/resume 时，按对话所属 Profile 的 `apiFormat` 决定实例化 `QueryBasedSession` 还是新的 pi 会话类。两者实现相同的对外接口（`start/send/close/retain/release/setModel` 等，即 `query-based-session.ts` 现有的公开方法集合），供 `electron/main/tipc/agent.ts` 调用方无感切换。

---

## 模块边界

### 新增：`electron/main/agents/pi-session/`

按项目模块化约定拆分（参考 `agent-chat/` 拆成 ~20 个文件的先例），初步拆分设想（**具体文件划分留给 staged-impl 阶段细化**，此处只定边界原则）：

- 核心会话类文件（持有 pi `Agent` 实例、生命周期）
- 消息转换层（pi 事件 → `ExtendedSessionMessage`，对应 SDK 侧的 `convertSDKMessage`）
- 权限卡片适配（`beforeToolCall` → 权限请求 IPC）
- 插话队列适配（`steer`/`followUp` → `pendingMessages`/`pendingCountChanged` 语义）
- 压缩策略（`transformContext`，SDK 原来是黑盒自动压缩，这里需要自己写）
- skill 加载（见下节，独立文件，不进 harness）
- 系统提示词构建（复用现有 `session-append-templates.ts` 的 append 段拼装逻辑，替换掉 `preset: 'claude_code'`）

单文件/单函数 >300 行的约定在新代码里强制执行——这也是这次重写要解决的历史包袱（`query-based-session.ts` 现状 2385 行）。

### 不动

- `query-based-session.ts` 及其依赖（`agent-query-config.ts`/`session-append-templates.ts`）——SDK 版本原样保留，直到确认可删除。
- `transcript-cleaner.ts`/`session-paths.ts`——消费 SDK 会话 JSONL 格式；pi 会话的 fork/持久化方案需要另外设计（见"未决问题"），本阶段不假设复用这套清洗逻辑。
- 阶段一已完成的 `pi/provider.ts`/`pi/tool-adapter.ts`/`pi/run-once.ts`——`run-once.ts` 是一次性任务封装，主会话是长驻多轮会话，不复用 `run-once.ts` 本体，但 `provider.ts`（`resolvePiModel`）和 `tool-adapter.ts`（`ToolDef`/`toPiTools`）直接复用。

---

## Skill 加载方案（替代 SDK 的 `plugins` 机制）

### 现状

`query-based-session.ts:460-469` 用 SDK 的 `plugins: [{ type: 'local', path }]` 挂载两个本地 skill（`article-parser`/`review`），另外用 `settingSources: ['user','project','local']`（`:483-487`）加载 Claude Code **市场插件生态**（`shadcn`/`frontend-design`/`claude-api`/`verify`/`code-review`/`security-review`/`init`/`fewer-permission-prompts` 等）。市场插件能工作的根本原因是 SDK 的 `query()` 底层 spawn 了真实 `claude` CLI 子进程，天然读得懂 Claude Code 的插件注册表；pi 没有对应物。

### 决策 1：放弃市场插件生态

用户判断这些插件本来就非刚需（"很多注册了但没加载，更多是用了 skill"），迁移后接受其不可用。dogear 自己的 local skill（`article-parser`/`review`，以及未来可能新增的）不受影响。

### 决策 2：不引入 pi-agent-core 的 `AgentHarness`，手写轻量 skill loader

调研发现 `@earendil-works/pi-agent-core` 的 `AgentHarness` 类（`dist/harness/`）确实实现了对等机制（`skills.js` 扫描 `SKILL.md` + frontmatter 解析，与 agentskills.io 开放规范同源，和 Claude Code 的 `SKILL.md` 格式同标准），两段式：索引注入系统提示词（`formatSkillsForSystemPrompt`，~20 行）+ 命中后懒加载详情（`skill(name)` 方法，核心 ~4 行）。

但 `AgentHarness` 强制绑定自己的 `Session` 持久化模型（turn 树、`jsonl-repo`/`memory-repo`）、自带一整套内置工具（bash/edit/read/write/image）、独立的 turn 状态机（`phase: idle/turn`）——想要 skill 机制就要接受这些无关的捆绑约定，与阶段一"不抽同时兼容两个引擎的运行时接口"精神相悖，代价远大于收益。

**决策**：手写一份轻量 skill loader（新文件，暂定 `electron/main/agents/pi-session/skill-loader.ts`），核心逻辑：
1. 扫描 skill 目录，读取每个 `SKILL.md`
2. 正则切分 frontmatter（`---\n...\n---`）+ 解析 `name`/`description`（YAML 极简，用手写解析或已有的轻量方案，不新增 `yaml`/`ignore` 依赖）
3. 拼成索引文本（类似 SDK 的 `<available_skills>` 结构）塞进 systemPrompt
4. 命中后把完整 `SKILL.md` body 通过一个新的 `Skill` 工具（`ToolDef`，复用阶段一的工具适配层）返回给模型，作为一条工具调用结果注入上下文——而不是 harness 那种直接改 turn 状态

因为 `SKILL.md` 格式是开放标准，dogear 现有的 `article-parser`/`review` 两份 `SKILL.md` 文件本体不用改，只换加载方式。

### 决策 3（伴生优化，不阻塞迁移）

用户观察到 dogear 自己的 skill（`brainstorming`/`staged-impl`/`systematic-debugging` 等）现在写得偏"强制流程约束"，模型能力增强后可以考虑精简为更轻量的"流程+踩坑说明"。这是独立的内容优化项，与本次运行时迁移解耦，不写入本设计文档的实施范围，留待后续单独讨论。

---

## 模型质量回归风险

### 风险

主会话现在是 `preset: 'claude_code'` + `append`（append 是 dogear 自己的默认提示词/人设/对话规则/工作区画像等，见 `query-based-session.ts:1707-1782`）。`claude_code` 部分是 SDK/CLI 内置的专有文本，无法获取源文本、也不能直接照搬到 pi。Claude 模型在这个 harness 上做过 RL 对齐，工具命名、行为习惯、输出风格都基于此训练；换成 pi 的极简 systemPrompt（只剩 dogear 自己的 append 段）后，可能出现工具调用准确性下降、对项目约定遵循度下降等行为回归。这是唯一可能让整个主会话迁移不划算的风险点。

阶段一的三条后台链路本来就没用 `claude_code` preset（一次性结构化任务，直接 `prompt` 字符串），所以阶段一的"产出质量比对不降级"经验**不能**直接迁移到主会话这种开放式多轮编码交互场景，两者对 preset 的依赖程度不同。

### 验证方式：不做独立对比实验，用"最小可用 pi 主会话"本身来验证

不单独设计一次性 smoke test，而是把这个风险的验证融进正常迭代：先搭出一个功能最小但真实可用的 pi 版主会话（哪怕只支持单轮工具调用、无插话无 fork），跑真实开发任务，逐步补齐能力清单（见下）。质量回归与否在真实使用中自然浮现，比设计一次性对比任务更贴近实际、更早暴露问题。如果验证中发现质量明显不可接受，止损点是：保留 SDK 路径为默认，pi 路径降级为可选项或推迟。

---

## 数据流

### 事件契约（新旧运行时共享的输出契约）

```
主进程内部（pi Agent 事件 / SDK 消息）
  → 会话类内部转换层（对应 SDK 侧 convertSDKMessage）
  → emit('message', ExtendedSessionMessage)  // types/electron-api.ts 定义
  → tipc broadcaster（electron/main/tipc/agent.ts）
  → renderer-handlers.ts 声明的 IPC 事件（queryBasedSessionMessage / permissionRequest / askUserQuestion / usageEntryAdded ...）
  → 前端 useSessionMessages.ts 等 hook 消费，转成 Message/ContentBlock（components/agent-chat/types.ts）
```

前端从 `queryBasedSessionMessage` 往下完全不变；两套运行时的差异只体现在"转换层"内部实现不同。

### 已确认的耦合边界（迁移时需要处理的两处遗留）

- `electron/main/tipc/agent.ts:10` 导入 SDK 的 `PermissionMode` 类型（仅类型标注）——改用 `types/electron-api.ts` 里已有的自定义 `PermissionMode`。
- `lib/sdk/index.ts`/`lib/sdk/query.ts`（前端遗留，重导出 SDK 的 `query`/`SDKMessage`，当前无任何引用）——迁移收尾时一并删除。

---

## 能力清单（待 staged-impl 逐步细化，此处只列出识别到的子问题和现状结论）

| 能力 | SDK 侧现状 | pi 侧对应 | 结论 |
|---|---|---|---|
| Skill 加载 | `plugins` 机制 + `settingSources` 市场插件 | 手写 loader（见上） | ✅ 本文档已定方案 |
| 权限卡片 | `canUseTool` 回调 + `PermissionResult` | `beforeToolCall` 返回 `{ block, reason }` | 见下方"权限卡片"小节，已定方案 |
| 插话队列 | `pendingMessages` push/shift + `pendingCountChanged` | `agent.steer()` / `agent.followUp()` | 见下方"插话队列"小节，已定方案 |
| 压缩 | SDK 黑盒自动压缩 | `transformContext` 插槽 | 需要自己写压缩策略，SDK 原来白送，这次要自研，留 staged-impl |
| fork / 对话树持久化 | `conversations.json` + SDK 会话历史文件（`transcript-cleaner.ts`/`session-paths.ts` 消费） | pi 会话 JSONL 是单文件内树结构（entry 带 `id`+`parentId`） | 存储模型不同，本文档不假设直接复用清洗逻辑，具体方案留 staged-impl 讨论（是否需要迁移已有历史数据，或新会话走新格式、老会话保留在 SDK 上） |
| 子会话派遣 | 依赖 SDK 会话生命周期管理（`delegation-tools.ts`） | 需要在 pi 会话类里重新实现子会话进程管理 | 留 staged-impl |
| usage 统计 | 从 SDK `result` 消息提取（`usage-extractor.ts`） | pi 的 usage 事件结构不同 | 需要新的提取逻辑产出同样的 `ConversationUsageEntry` 结构，留 staged-impl |
| PARSE_ARTICLE | 依赖 SDK `plugins` | 复用本文档的 skill loader 方案 | ✅ 顺带解决 |

---

## 权限卡片

### 现状

`canUseTool` 回调（`query-based-session.ts:527`）签名即 SDK 的 `CanUseTool`，触发时 `emit('permissionRequest', {...})` 给前端渲染卡片，`respondPermissionRequest(requestId, behavior, message?, updatedInput?)`（`:1966`）处理四种前端语义：`allow`（含"已修改参数"分支，走 `updatedInput`）/ `allow_session`（当次 query 进程内生效，不落盘）/ `always_allow`（`appendPermissionAllowRules` 落盘跨会话持久化）/ `deny`（含自定义拒绝说明）。SDK 的 `PermissionResult` 本身只有 `allow`（可带 `updatedInput`/`updatedPermissions`）和 `deny` 两个分支，dogear 的四种语义都是在 `allow` 分支上包出来的参数组合。

### pi 对应能力与决策

- `beforeToolCall` 返回 `BeforeToolCallResult = { block?, reason? }`（`types.d.ts:40-43`），类型层面**没有**修改参数的字段。
- 但实测 `agent-loop.js:405-438`：`beforeToolCall` 收到的 `context.args` 与后续真正执行时使用的 `args` 是**同一个对象引用**，原地修改 `context.args` 的字段会被后续执行读取到。
- **决策**：采用这个未文档化的原地修改技巧保留"编辑参数后允许"功能。风险是 pi 未来版本可能改成不可变对象/深拷贝导致技巧失效，接受该风险（按项目验证惯例，届时手测发现问题再处理，不预先设计兜底方案）。
- "始终允许"跨会话持久化（`appendPermissionAllowRules`）是 dogear 自己的逻辑，与运行时无关，两侧直接复用。

---

## 插话队列

### 现状

现有"插话排队到下一轮"完全是被 SDK 的 async generator 输入流形状逼出来的——`query()` 的输入通道是一个持续的异步生成器，SDK 内部 `for-await` 语义一次只消费一条驱动一整轮（含该轮全部工具调用），SDK 没有暴露"中途插入不打断当前 turn"的 API，唯一的中断手段是整轮 `interrupt()`/abort。`usePendingState` 的 `idle`/`running`/`flushing` 三态由此推导。

### pi 对应能力与决策

- `agent.steer(message)`：当前 assistant turn **结束后**注入，粒度比现状更细——可能在多轮工具调用之间的某个 turn 边界插入，不必等整个对话循环自然结束。
- `agent.followUp(message)`：等 agent 本会"自然停止"才处理，与现状语义完全对应。
- **决策**：采用 `steer()`，借迁移顺便升级插话交互体验（现状是产品行为被 SDK 能力边界限制出来的，不是主动选择，pi 有能力做得更好没理由放弃）。代价是 `usePendingState`/`StreamingIndicator` 的三态文案需要重新设计（比如区分"即将注入"和"排队中"两种更细的状态），具体状态机设计留 staged-impl。

---

## 落地节奏

dogear 是单用户桌面应用，"发版验证"即"自己开始日常用 pi 路径跑对话"。**决策**：不等能力清单全部补齐再切换，先实现最小可行集合就开始日常使用，越早拿到模型质量回归信号越好，剩余能力边用边补：

- **最小可行集合**（第一批）：skill 加载器、权限卡片（含参数编辑原地修改）、基本工具调用、插话队列（`steer`/`followUp`）、usage 统计（保证 UI 不因缺失数据报错）
- **后补能力**（第二批，不阻塞开始使用）：压缩（长对话才会触发）、fork/对话树持久化、子会话派遣

这个顺序也符合前面"权限卡片/插话队列是交互核心，fork/压缩/子会话是数据模型或使用频率较低的能力"的风险排序。

---

## 未决问题（含二轮讨论回填结论）

### 1. fork / 对话树的持久化方案

**现状**：`.dogear/conversations/projects/<工作区路径>/<sdkSessionId>.jsonl`——dogear 把 `CLAUDE_CONFIG_DIR` 指向自己的目录，借用 SDK/CLI 原生的单会话单文件、线性消息存储约定；fork 现在是"新开一个 session id 文件，SDK 内部从某条消息 resume"，resume 语义由 SDK 提供。

**pi 侧调研结论**：
- 基础 `Agent` 类完全无状态，只持有 `_state.messages`，**没有内置 fork/resume 语义**。Fork 的预期用法就是"把消息数组截到某一点，喂给新的 `Agent` 实例"（`agent.js:153` 的 `state` setter 注释明确支持直接赋值 `messages`）——这与 dogear 现在"fork = 新开一个 session 文件"的模式思路一致，只是"截断+新建"从 SDK 白送变成需要 dogear 自己实现（自己存 JSONL、自己做截断）。
- `pi-agent-core` 的 `harness/session/jsonl-repo.js`（树形 entry，单文件内 `id`/`parentId` 表示分支，即用户记忆中"同一历史文件里随意切分支"的能力）**确认不依赖 `AgentHarness`**，技术上可独立引入。但它绑定自己的一套存储模型（`SessionTreeEntry` + `Session` 类的 `appendMessage`/`moveTo`/`buildContext` API），要用就要接受这套模型，不是薄封装。
- **决策留待 staged-impl**：是"自己写一个贴合 `conversations.json` 现状的简单存储（沿用现在一文件一线性会话的模式）"，还是"引入 `jsonl-repo` 的树形格式换取原生分支能力"，两个方向都可行，权衡点在于要不要顺带迁移历史数据格式。

### 2. 压缩策略的具体实现

**pi 侧调研结论**：
- `harness/compaction/compaction.js` 的核心算法（`findCutPoint` 找切点、`estimateContextTokens` 估算 token、`compact`/`prepareCompaction` 生成摘要）确认是纯函数、**不依赖 `AgentHarness`**，理论上可摘出来复用。
- 但函数签名吃 `SessionTreeEntry[]`，不是裸 `AgentMessage[]`，复用需要写一层"消息数组 ↔ SessionTreeEntry"的桥接适配层。
- `Agent.transformContext` 插槽签名确认为 `(messages: AgentMessage[], signal?) => Promise<AgentMessage[]>`，就是留给外部注入压缩函数的位置。
- **决策**：不预先选定方案，留到"最小可用 pi 主会话"跑起来之后，视实际情况决定是"抄 `compaction.js` 算法 + 写桥接层"还是"基于其暴露的工具函数自己拼一版更省心的实现"，用 pi 自己的能力，不在此阶段预判。

### 3. 子会话派遣在 pi 下的进程管理

**pi 侧调研结论**：
- pi 没有任何原生的多 agent 编排机制（`.d.ts` 全局搜索无 sub-agent/spawn/delegate 相关类型或方法），`AgentHarness` 本身也只是单会话 turn 状态机，没有"一个 Agent 派生另一个 Agent"的概念。
- 但 `Agent` 实例创建成本极低（纯内存对象，无子进程、无磁盘 IO），阶段一 `pi/run-once.ts` 已验证 Worker 线程内 `new Agent()` 正常工作。
- **结论**：子会话 = 一个常驻等待消息的轻量 `Agent` 实例，这个思路在 API 层面顺畅，不存在 SDK 子进程那种重初始化开销——即用户所说的"用 pi 框架后一些 agent 不需要再像 SDK 一样干什么都要先加载一堆东西"。但监听 `CreateSession`/`SendMessage`/`WaitForMessage` 的编排逻辑（`agent.subscribe()` + `prompt()`/`steer()` 组合）需要 dogear 完全自己实现，pi 不提供现成骨架，留 staged-impl 具体设计。

### 4. `ModelProfile.apiFormat` 的用户可见性

**决策**：设置页直接给每个 Profile 加选项暴露（不做"开发者模式"隐藏 UI）。理由：单用户项目，切换方便性优先于灰度控制，现有 Profile 编辑表单加一个字段成本很低。

### 5. 删除 SDK 路径的判定标准

**决策**：不设量化指标（如"连续 N 天无回退"），也不预先设定删除时间点。与项目一贯"不写单元测试，验证靠 build+lint+手测"的判断优先级一致——待能力清单（权限卡片/插话队列/压缩/fork/子会话派遣/usage 统计）补齐、日常使用一段时间主观感觉稳定后再决定，`query-based-session.ts` 及其依赖在此之前作为长期回退路径保留，不设阶段性删除节点。

以上结论不改变本文档"不阻塞落盘"的定位，具体实施步骤（如 fork 存储的最终选型、压缩桥接层写法）仍在 staged-impl 阶段展开。
