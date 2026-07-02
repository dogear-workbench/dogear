# 首页报告 + 记忆分流 重新设计

**背景**：首页报告（`dashboard.md`）经过一个多月的累积已经严重臃肿（单工作区 184 行）。根因不是数据量大，而是驱动生成的提示词/工具契约本身有问题：

1. `review-prompt.ts` 的 `DEFAULT_REVIEW_PROMPT` 和 `review-tools.ts` 的 `WriteReport` 工具描述都硬编码了"待办/近5天/建议/最新沉淀"四段式模板，其中"待办"内部又分"新增/已完成/观察中/待排期"四个高度重合的子类，同一件事在报告里被复述 3~4 遍。
2. "近5天做了哪些"按天流水账展开，每天的内容又是整段照抄组卡摘要，篇幅巨大但信息密度低。
3. "最新沉淀"整节把本该进记忆系统的内容（决策、经验教训）原文炒了一遍搬进报告，既臃肿又和记忆系统职责重叠。
4. 深挖发现更根本的问题：`SaveMemory` 工具描述写死"仅在用户明确表达要求时才写"，但复盘 agent 是系统自动触发、无用户在场"明确要求"——工具描述和复盘 agent 的实际使用场景直接冲突，导致模型不敢真正调用 `SaveMemory`，只能把该沉淀的内容硬塞进报告充数。这才是"沉淀"实际上从未流入 `.dogear/memory/topics/` 的真正原因（该目录里还是 5 月的 3 个旧主题，近一个月的架构决策全部缺失）。
5. `core-profile.md`（自动注入每个新会话 system prompt、本该实现"不用反复强调基础信息"的画像文件）目前完全空白，且没有任何 agent 工具能写它，只能用户在设置页手动编辑——从未被真正利用。
6. 报告的更新契约写的是"增量合并：没变的段落原样保留"，这鼓励了只增不减——过期的待办、已解决但没删除的项、语义重复的条目会无限累积，报告只会越来越长。

**目标**：
- 首页报告瘦身为 4 段结构，一眼看清"最近做了什么 / 需要我处理什么 / 该观察什么 / 有什么新启发"，去掉冗余分类和"最新沉淀"整节。
- 报告的重写逻辑从"追加保留"改为"每次都主动裁剪+合并"，过期/已解决/重复内容主动删除，不做历史归档。
- 真正把"沉淀"这个职责交给记忆系统：修复 `SaveMemory` 在自动化任务里的门槛矛盾，让复盘 agent 能放心写。沉淀门槛收紧为"决策/偏好 + 踩过的坑"，排除纯功能流水账。
- 让 `core-profile.md` 真正被复盘 agent 谨慎维护起来，逐步实现"新会话不用你重复强调基础信息"的目标。
- "建议"这一段从"待办复述"改为鼓励模型主动推理新方向/健壮性优化，作为真正启发用户的内容。

**架构**：纯提示词 + 小范围工具参数化改动，不涉及数据结构变化（报告仍是自由 markdown + `updatedAt`，记忆仍是 `.dogear/memory/topics/*.md`）。

排除的选项：
- 没有引入新的存储结构区分"报告历史版本"——用户明确要报告只反映当前状态，不需要归档。
- 没有给交互式聊天场景放开 `SaveMemory` 门槛——那个场景保持"仅用户明确要求"不变，问题只出在自动化任务复用了同一份工具描述。
- `core-profile.md` 的自动维护范围严格限制在"复盘任务"，不扩展到 digest/categorize 任务，避免多头写入同一份文件引发竞态和内容漂移。

**模块边界**：
- `electron/main/services/memory/review-prompt.ts` — 重写 `DEFAULT_REVIEW_PROMPT`
- `electron/main/agents/tools/review-tools.ts` — 重写 `WriteReport` 工具描述，与新提示词结构对齐
- `electron/main/agents/tools/memory-tools.ts` — `createMemoryTools` 增加 `opts?: { autonomous?: boolean }` 参数；`autonomous=true` 时替换 `SaveMemory` 描述文案；新增 `GetCoreProfile` / `UpdateCoreProfile` 两个工具（复用 `memory-service.ts` 已有的 `getCoreProfile`/`updateCoreProfile`），仅在 `autonomous` 模式下加入 tools 数组
- `electron/main/agents/agent-worker.ts` — `handleReviewSessionTask` 里改为 `createMemoryTools(workspacePath, { autonomous: true })`，`allowedTools` 追加两个新工具名
- 已有的"恢复默认"按钮（`ReviewPanel.tsx`）可以让已经播种过旧提示词文件的用户一键切换到新版，不需要额外做迁移逻辑

**数据流**：不变。复盘任务仍是 `review-trigger` 串行队列触发 → `agent-worker.handleReviewSessionTask` 一次性 headless query → agent 自主调用 `ListDigests/ReadDigest/TraceSource` + `ReadReport/WriteReport` + `RecallMemory/SaveMemory/ForgetMemory`（现为 autonomous 模式）+ 新增的 `GetCoreProfile/UpdateCoreProfile`。

**新报告结构**（`WriteReport` 的 markdown 参数应符合此结构）：
```
> 一句话总结当前状态
## 最近做了什么
（3~7 天内按主题合并，不按天罗列，不写"已完成"这类字眼，一行一条讲清做了什么）

## 需要你处理
（确实没做的 + 提出但搁置的，合并为一类；已解决的直接删除，不保留"已完成"记录）

## 持续观察
（已经做完/上线，需要一段时间使用才能验证效果好坏的——区别于"需要你处理"：这类东西不需要你做什么，只是等反馈）

## 建议
（不是待办复述：基于新增内容主动推理下一步方向、可做的健壮性/体验优化、值得注意的风险点，鼓励大胆，这段是用来启发用户的）
```
不再有"最新沉淀"段落。

**报告维护契约**（写入 `WriteReport` 工具描述 + 提示词契约段）：
- 报告是**当前状态快照**，不是历史归档：每次重写都要主动判断——哪些待办已解决可以整条删除，哪些观察项已经有了明确结果可以归档进记忆或直接删除，哪些条目讲的是同一件事可以合并成一条。不能因为"没变"就默认原样保留整段。
- 报告纯净、给人看：不放 sessionId/uuid/链条，不放"最新沉淀"。

**记忆分流契约**（提示词新写法）：
- 沉淀门槛：**决策/偏好**（会影响未来至少一次实施判断的技术决策，或用户明确表达的立场/偏好）+ **踩过的坑**（调试/实施中发现的非显而易见的根因和解法）。纯粹"做了什么功能"的流水账不算，那是组卡（digest）的职责，不需要在 workspace 记忆里重复。
- 明确告知复盘 agent：`SaveMemory` 工具描述里"仅限用户明确要求"这句话是给交互式聊天场景写的，不适用于复盘任务——复盘就是被系统触发来做这个判断的，判断标准以本提示词为准。
- `core-profile.md` 维护：只有真正稳定、跨多次会话反复验证为真的身份/偏好/工作模式（例如"不写单元测试""偏好薄 IO 厚提示词"这类）才有资格写入；近期动态、进行中的任务、某次具体决定都不该进这里。触发条件苛刻，预期大多数复盘不会调用这个工具。调用前必须先 `GetCoreProfile` 读现状，合并后 `UpdateCoreProfile` 全量覆盖，不能覆盖丢失已有内容。

**错误处理 / 边界情况**：
- `GetCoreProfile` 返回空文件是正常状态（当前就是空的），提示词需要说明"空是正常的，不代表没必要写，只是目前没有足够稳定的信号"。
- `autonomous` 模式的 `SaveMemory` 仍然保留"保真契约"（不可编造，拿不准就 `TraceSource` 查证），只是去掉"用户明确要求"这道门槛，不是放松真实性要求。
- 已经播种过旧版 `review-prompt.md` 的工作区（本机就是一例，磁盘上的文件比代码里的 `DEFAULT_REVIEW_PROMPT` 更旧）不会自动更新，需要用户在设置页手动点"恢复默认"。

**未决问题**：
- `GetCoreProfile`/`UpdateCoreProfile` 是否也应该开放给交互式聊天场景（用户主动说"记住我的身份是…"时）——本次先只给复盘任务，观察效果后再决定要不要扩展。
- 沉淀门槛的具体执行效果如何，需要跑几轮复盘后用真实产出验证，可能需要再微调措辞。
