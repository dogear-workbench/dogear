# 自定义工具 dogear__ 前缀设计

## 背景

对话 Agent 同时挂基础文件工具（`read/write/edit/bash/Glob/Grep/Skill`）和一批自定义工具。自定义工具以裸名注册（`tool-adapter.ts` 的 `toPiTools` 直接 `name: def.name`），其中 `Read*`（ReadReferenceSession、ReadArticle、ReadDigest 等）和 `WriteReport` 与基础 `read`/`Write` 在名字上高度相似，模型做「读/写文件」意图匹配时会误路由到自定义工具，失败后反复重试，基础工具调不出来（Claude SDK 用 `mcp__{server}__{tool}` 前缀隔离两类工具，本项目的 pi 实现没有这层）。

## 目标

所有自定义工具统一加 `dogear__` 前缀（如 `dogear__ReadReferenceSession`），与基础工具彻底隔离名字空间。名字在 `defineTool` 定义处直接写死，提示词、权限、UI、transcript 全部使用同一名字——单一事实源，无运行时转换。

## 架构

- 前缀写进 defineTool 名字本体，**不做**运行时加前缀/去前缀转换（排除转换层方案：提示词引用裸名而运行时名带前缀会产生错位，引发新一轮名称错误）
- 基础工具**不加**前缀：`read/write/edit/bash/Glob/Grep/Skill`、`workspace-file-tools.ts` 的 `Read/Write/Edit`（runOnce 场景）、`builtin-tools` 的 `Read/Write/Edit/Bash`
- 不用 `mcp__` 前缀：这批工具不是真 MCP；`transcript-adapter.ts:30` 对 `mcp__` 开头已有显示逻辑；未来真接 MCP server 会撞名
- server 名（dogear-reference 等）和 tool-pack 名不变，只改工具名

## 模块边界

### A. 工具定义层（55 个工具名 + 文件头注释 + 描述/返回文本里的交叉引用）

| 文件 | 工具 |
|------|------|
| `agents/tools/reference-tools.ts` | ReadReferenceSession / ReadGroupBackground / ListSiblingSessions |
| `agents/tools/delegation-tools.ts` | CreateSession / CreateSessionBatch / StopSession / SendMessage / WaitForMessage / ListLinkedSessions |
| `agents/tools/group-tools.ts` | ListGroupFiles / SaveSharedNote |
| `agents/tools/review-tools.ts` | ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport |
| `agents/tools/group-digest-tools.ts` | ReadGroupDigest / SaveGroupDigest / SaveGroupBackground |
| `agents/tools/digest-tools.ts` | CleanTranscript |
| `agents/tools/memory-tools.ts` | RecallMemory / SaveMemory / ForgetMemory / GetCoreProfile / UpdateCoreProfile |
| `agents/tools/article-tools.ts` | ReadArticle / ListArticles |
| `agents/tools/article-parse-tools.ts` | ReadRawHtml / ReadCurrentContent / ReadParserRules / ReadPlatformScript / ListPlatformScripts / RunPlatformScript / UpdatePlatformScript / ReadParseHistory / SaveParsedArticle |
| `agents/tools/category-tools.ts` | ListCategories / SaveCategoryNew / SaveCategoryJoin / SaveCategoryMerge / PruneCategoryTags |
| `agents/tools/stock-tools.ts` | SearchStock / GetStockQuote / GetKLineData / GetTimeline / GetWatchlist / ModifyWatchlist / GetFundFlow / GetNorthboundHolding / ListIndustries / CompareIndustry |
| `agents/tools/stock-analysis-tools.ts` | CalcIndicators / ScreenStocks / GetFinancials / DetectSignals / EvalFormula / SimpleBacktest |
| `agents/tools/stock-announcement-tools.ts` | ListAnnouncements / ReadAnnouncement |
| `agents/tools/stock-picking-tools.ts` | PreheatLongTermPool / RankByLongTerm |

**不动**：`workspace-file-tools.ts`、`pi-session/search-tools.ts`（Glob/Grep）、`pi-session/skill-loader.ts`（Skill）、`pi-session/builtin-tools.ts`。

### B. 代码级工具名匹配（仅 3 处）

- `agent-worker.ts:245` — `def.name === 'SaveParsedArticle'`
- `agent-worker.ts:255` — `def.name === 'UpdatePlatformScript'`
- `agent-worker.ts:442` — `t.name === 'ListGroupFiles'`

### C. 提示词模板（源码内硬编码工具名）

- `agents/session-append-templates.ts` — MEMORY_GUIDANCE / 委派指引 / 组指引 / 触发器描述
- `agents/group-context-builder.ts` — 组上下文注入文本
- `agents/agent-worker.ts` — 后台任务内嵌提示词（约 :490 等处）
- `services/memory/review-prompt.ts` — 复盘任务提示词
- `services/memory/group-digest-prompt.ts` — 组提炼任务提示词
- `services/conversation-runtime-service.ts:102` — 子会话契约文本（SendMessage 提法）

### D. 调度白名单

- `services/scheduler/builtin-task-meta.ts` — 三个内置任务的 tools 数组

### E. skill 模板（注入 system prompt，名字必须对齐）

- `resources/skill-templates/cross-session-review/SKILL.md`
- `resources/skill-templates/stock-picking/SKILL.md`
- 其余 skill 实施时全量 grep 工具名确认

### F. 测试

- `agents/pi-session/permission-rules.test.ts` — packMap 字面量（'RecallMemory'、'ReadArticle' 等）

### G. 文档

- `docs/codebase-map.md` — 各工具名提法

### 自动跟随、无需改动

- 权限 packMap（`pi-session.ts:461-464` 运行时遍历 toolDefs 构建）
- 前端工具列表（`tipc/agent.ts:453` getRegisteredTools 动态获取）
- `computeSubAgentActiveTools` / `buildSubAgentToolDefs`（从 toolDefs 计算；skill 过滤按 tool group 名 'article-parser'/'cross-session-review'，不改）
- `usage-extractor.ts`（只匹配基础 'Read'，不受影响）

## 数据流

不变。纯命名层改动，无逻辑/存储变化。

## 错误处理 / 边界情况

- 存量 settings 自定义 permissionRules：用户手写的旧工具名（allow/deny）会匹配不上新名，走默认权限逻辑，不报错。低风险，不做数据迁移；如有用户配置需手动更新
- **错误返回不做工具兜底引导**（用户拍板）：工具 `isError` / 空数据返回文本只陈述事实，不引导「请改用 Xxx 工具」——引导若指向未装配的工具（如 `reference-tools.ts:80` 的 ReadGroupBackground 空返回引导调 ReadGroupDigest，对话 agent 根本没挂它）会直接制造死循环；错误信息干净报出，让模型自行决策。行为性引导（如「请勿据此臆断」）保留；成功返回里对真实同场工具的交叉引用（如 CreateSession 返回里提 SendMessage/WaitForMessage）保留
- ReadDigest / ReadGroupDigest **本轮不合并**（不同场无直接冲突，保持观察）
- **旧 transcript 里的旧工具名**：仅历史展示，无逻辑依赖（组卡 TraceSource 按 uuid 不按工具名）
- **替换安全网**：基础工具名 `Read/Write/Edit/read/write/edit` 绝不能被误替换——替换规则必须带完整工具名边界（全词匹配），实施后 grep 验证无残留旧名、无误伤

## 未决问题

- `agent.md`（用户工作区/全局指南，代码库外）里提到 CreateSession/WaitForMessage/SaveSharedNote 等名字——模型靠描述能对上，不强制改，由用户自行决定是否同步
- 验证方式：`bun run build:electron` + `bun run lint` + `bun test`（permission-rules 等相关测试）+ 全局 grep 旧名零残留
