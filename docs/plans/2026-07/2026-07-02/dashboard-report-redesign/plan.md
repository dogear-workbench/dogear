# 首页报告 + 记忆分流 重新设计 实施计划

**设计文档**：[../dashboard-report-redesign-design.md](../dashboard-report-redesign-design.md)

**目标**：首页报告瘦身为 4 段结构（最近做了什么 / 需要你处理 / 持续观察 / 建议），去掉"最新沉淀"整节；把沉淀职责真正交给记忆系统；启用 `core-profile.md` 的谨慎维护。

**架构思路**：纯提示词 + 小范围工具契约调整，不动数据结构。核心是解开"复盘 agent 想沉淀但 SaveMemory 门槛写死为『仅用户明确要求』"的死结——通过给 `createMemoryTools` 加 `opts.autonomous` 参数，在自动化任务场景下替换 SaveMemory 描述文案；同时新增 `GetCoreProfile`/`UpdateCoreProfile` 只在 autonomous 模式暴露。

**涉及模块**：
- `electron/main/services/memory/review-prompt.ts` — 重写 `DEFAULT_REVIEW_PROMPT`
- `electron/main/agents/tools/review-tools.ts` — 重写 `WriteReport` 描述
- `electron/main/agents/tools/memory-tools.ts` — 加 `opts.autonomous`、新增两个 core-profile 工具
- `electron/main/agents/agent-worker.ts` — `handleReviewSessionTask` 传 `{ autonomous: true }` + 追加 allowedTools

## 步骤索引

- [x] [Step 1: 提示词与报告契约同步重写](./step1-prompt-and-contract.md) — DEFAULT_REVIEW_PROMPT 与 WriteReport 描述对齐新四段结构
- [x] [Step 2: memory-tools 加 autonomous 模式与 core-profile 工具](./step2-memory-tools-autonomous.md) — 参数化 SaveMemory 描述，新增 GetCoreProfile/UpdateCoreProfile
- [x] [Step 3: agent-worker 复盘任务接线](./step3-wire-review-worker.md) — 传 autonomous:true，追加 allowedTools

## 全局决策

- **不做迁移**：磁盘上已播种过旧 `review-prompt.md` 的工作区（本机就是）不会自动覆盖，用户在 ReviewPanel 手动点"恢复默认"即可。不写自动迁移代码。
- **autonomous 只给复盘任务**：`GetCoreProfile`/`UpdateCoreProfile` 不注册进 `registerTools()` 的通用元数据面板（用户不会在设置里看到它们），只由 `agent-worker.handleReviewSessionTask` 显式启用；digest/categorize/交互式聊天场景不动。
- **保真契约不放松**：autonomous 只解开"用户明确要求"的门槛，"宁可不写不可瞎造 + 拿不准 TraceSource 查证"这条要在新提示词里保留。
- **新报告结构不写 frontmatter**：仍是纯 markdown 正文，`updatedAt` 由 `WriteReport` 工具自动生成落到 `dashboard.md` 的 frontmatter（`review-store.ts` 已实现，不动）。
- **命名保留历史代号**：文件仍叫 `review-*`（review-prompt / review-tools / review-store / handleReviewSessionTask），只改内容不改命名，避免连锁改动。
- **验证方式**：`bun run build:electron` + `bun run lint`。运行时验证靠用户在 ReviewPanel 点"恢复默认"→ 手动触发一次报告生成 → 看 `dashboard.md` 和 `.dogear/memory/` 输出。项目不写单元测试。

## 完成总结

三个 step 全部落地，`bun run build:electron` 编译通过，`bun run lint` 0 errors。

**实际改动汇总**：
- `electron/main/services/memory/review-prompt.ts` — `DEFAULT_REVIEW_PROMPT` 整段重写：三层职责区分（首页报告 / 主题记忆 / core-profile）、新四段报告结构、沉淀契约（决策/偏好 + 踩过的坑，明确"仅用户明确要求"不适用复盘任务）、core-profile 苛刻门槛与 Get→合并→Update 流程、报告主动裁剪契约。
- `electron/main/agents/tools/review-tools.ts` — `WriteReport` 描述对齐新四段结构 + "每次主动裁剪，不能因为没变就默认保留"契约。
- `electron/main/agents/tools/memory-tools.ts` — `createMemoryTools` 增加 `opts?: { autonomous?: boolean }` 参数：autonomous 时替换 `SaveMemory` 描述文案 + 条件 spread 追加 `GetCoreProfile` / `UpdateCoreProfile` 两个新工具（复用 `memory-service.getCoreProfile` / `updateCoreProfile`，registerTools 不加元数据避免污染设置页选择器）。
- `electron/main/agents/agent-worker.ts:744,778-779` — 复盘任务 `handleReviewSessionTask` 传 `{ autonomous: true }` + allowedTools 追加两条 core-profile 工具名。

**与原计划的偏差**：仅一处技术偏差——TypeScript 把 `const tools = [...]` 推断为 union tuple 时 `push()` shape 不兼容，改用条件 spread `...(autonomous ? [tool(...), tool(...)] : [])` 解决。其余按设计文档 1:1 落地。

**用户手测提示**：
1. 打开设置 → 会话摘要 → 首页报告面板 → 点"恢复默认"覆盖本机磁盘上的旧 `review-prompt.md`
2. 手动触发一次复盘
3. 观察点：
   - `dashboard.md` 是否是新四段结构（最近做了什么 / 需要你处理 / 持续观察 / 建议）、是否没了"最新沉淀"段、是否比旧版明显更短
   - `.dogear/memory/topics/` 是否新增了决策/坑类沉淀（可以对比 5 月遗留的 3 个旧主题）
   - `.dogear/memory/core-profile.md` 是否被更新——**预期大概率不动**（门槛苛刻）；如果频繁写入需要回来调紧提示词

**未做的事**（按设计文档明确排除）：
- 未写迁移代码自动覆盖旧 `review-prompt.md`（靠"恢复默认"按钮）
- 未把 `GetCoreProfile` / `UpdateCoreProfile` 开放给交互式聊天场景（观察一段时间再决定）
- 未给 digest / categorize 任务开 autonomous 模式（避免多头写入同一份 core-profile 引发竞态）
