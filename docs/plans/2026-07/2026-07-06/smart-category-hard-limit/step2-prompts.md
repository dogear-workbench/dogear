---
step: 2
title: 提示词与提炼源头对齐
status: done
---

## 目标

改造 categorize-prompt（新决策流程 + 硬上限意识 + addAnchorTags 收紧），改造 group-digest-prompt（打 tag 前看当前分类词汇表），agent-worker 提炼任务前注入分类词汇上下文。

## 依赖上下文

**前置 step 产出**：Step 1 已经落地了以下能力（从 step1 回填读接力棒）：
- SaveCategory 新增 MERGE_CATEGORIES action（fromIds/name/anchorTags）
- SaveCategory 的 JOIN_EXISTING 加了 replaceAnchorTags 参数
- 工具层强制 anchorTags ≤ 10，超了返 Error
- 新增 PruneCategoryTags 工具

**当前关键文件状态**：
- `electron/main/services/memory/categorize-prompt.md` — 现有文本见完整设计文档；重点段落 "决策原则" 和 "命名规范"
- `electron/main/services/memory/group-digest-prompt.md` — 现有 5 步流程，tags 是自由生成
- `electron/main/agents/agent-worker.ts` — `handleGroupDigestSessionTask` 在这里；查找 `smartCategory` / `digest` 相关块定位

**关键决策回顾**：
- 提炼冷启动（无分类）不注入词汇表段
- 提示词强调"优先复用，实在没合适才自造"——不硬禁自造
- categorize atLimit 时先评估能否 MERGE 腾位置，MERGE 后**紧接着**再调一次 NEW_CATEGORY（一轮内两次工具调用）

## 计划改动

### categorize-prompt.md 全文重写

- [ ] 明确工具列表新增 MERGE_CATEGORIES 和 replaceAnchorTags
- [ ] 决策流程改为分支树（未满 / 已满两条路径）：
  - 未满：JOIN 或 NEW。JOIN 想加 tag 时看该分类现有 anchorTags 数：
    - <10 → addAnchorTags 加 0-2 个（默认不加，除非能真正提升未来快速匹配）
    - =10 → 必须用 replaceAnchorTags 覆写（挑最弱的换掉），或干脆不加
  - atLimit（分类满 10）：
    1. 先扫现有 10 个分类，评估能不能合并两个（"两个分类样例组和 anchorTags 高度重合"→能合）
    2. 能合 → MERGE_CATEGORIES + NEW_CATEGORY（两次调用）
    3. 都不能合 → JOIN_EXISTING（fallback 到最贴的）
- [ ] addAnchorTags 收紧规则块：
  - 默认**不加**，除非该 tag 首次出现且能提升未来 matchByThreshold 命中率
  - 反例列表：`调试` `bugfix` `前端-React` `前端-hooks` `修复` 之类的泛词禁止加
  - 每次 JOIN 加的 tag 数 ≤ 2
- [ ] 保留原有"命名规范"、"决策原则宁可宽不要窄"
- [ ] 明确硬约束：所有 anchorTags 数组 ≤ 10；超了工具会返 Error，需要重试

### group-digest-prompt.md 增加分类词汇对齐段

- [ ] 在 "写作要点" 之后加一段 "打 tag 的词汇选择"：
  ```
  系统会在你的上下文里附上当前工作区的**分类词汇表**（若有）。打 tag 时优先从中选择贴合的词——这样组卡能被快速归类，不用每次都跑分类决策。
  实在没合适的（比如首次讨论新主题）才自造 tag。
  ```
- [ ] 明确格式："词汇表按 `分类名: [tag1, tag2, ...]` 一行一分类展示，你不需要精确匹配某个分类，也不需要照抄——它是启发式的选词参考"

### agent-worker.ts 提炼任务上下文注入

- [ ] `handleGroupDigestSessionTask` 里读 smart-categories 索引：
  - `readIndex(workspaceId)`
  - 若 `categories.length > 0` → 拼接词汇表字符串（`分类名: [...]\n` 每分类一行）
  - 若为空（冷启动）→ 不注入
- [ ] 把词汇表作为 system 上下文追加到 prompt（复用现有把 dirty 列表塞进上下文的地方，找 `dirtyConversations` 相关块参照）
- [ ] 注意 dogear 的 systemPrompt 是 preset+append 模式（`agent-query-config.ts:resolveModelSelection`），不要污染主 systemPrompt，用 assistant/user 消息或 append 段落插入

### 验证
- [ ] `bun run build:electron`
- [ ] `bun run lint`
- [ ] 手动触发一次组卡提炼（在设置页"会话摘要"tab 点某组重新提炼），观察日志：
  - 词汇表是否被注入
  - 新组卡的 tag 是否倾向复用现有词汇
- [ ] 手动触发一次入卡分类，走一次 LLM 分支，观察 agent 是否按新决策流程走

## 实施回填

### 实际改动

- `electron/main/services/memory/categorize-prompt.ts` — `DEFAULT_CATEGORIZE_PROMPT` 全文重写：工具列表精确列出 JOIN_EXISTING(addAnchorTags/replaceAnchorTags 互斥)、NEW_CATEGORY、MERGE_CATEGORIES(fromIds/name/anchorTags)；决策流程改为「atLimit=false（JOIN 细分 <10/=10 两种 anchor 处理）vs atLimit=true（先扫合并候选→MERGE+NEW 或 fallback JOIN）」分支树；新增「addAnchorTags 收紧规则」段（默认不加/最多 2 个/泛词黑名单）；保留原「命名规范」「宁可宽不要窄」原则；新增「硬约束」段
- `electron/main/services/memory/group-digest-prompt.ts:42-46` — 「写作要点」之后新增「打 tag 的词汇选择」段，说明词汇表格式和优先复用原则
- `electron/main/agents/agent-worker.ts:635-644` — `handleGroupDigestTask` 里 `loadGroupDigestPrompt` 之后、`contextSection` 构建之前，`readIndex(workspaceId)` 拉分类，非冷启动时组 `categoryVocabLines`（`- ${name}: [${anchorTags.join(', ')}]` 每分类一行）；`categoryVocabLines` 展开到 `contextSection` 数组末尾（第 660 行 `...categoryVocabLines`），最终并入 `prompt = template + contextSection`

验证：`bun run build:electron` 通过；`bun run lint` 0 errors / 83 既有 warnings（三个改动文件无新增警告）。

### 给下一步的接力棒（Step 3 复用要点）

**agent-worker.ts 分类词汇表注入机制**：
- 函数：`handleGroupDigestTask`（注意 **实际方法名不是 `handleGroupDigestSessionTask`**，plan.md/step2.md 里写的是文档笔误；`AgentWorker` 类的私有方法，位于 `agent-worker.ts:565`）
- 注入方式：**不走 systemPrompt / systemPromptAppend**，而是**追加进 initial user prompt**——`query({ prompt, options })` 完全没传 `systemPrompt` 选项（用 SDK 默认 preset），所有上下文都通过字符串拼接塞进 `prompt` 变量：`prompt = template + contextSection`
- `contextSection` 是一个 `string[]` `.join('\n')` 拼出的文本块，本来就在塞 `dirtyConversations` / `sourcesSeen` / `sharedFileText` / `notesFileText`；分类词汇表就是往这个数组末尾多塞一段

**Step 3 CATEGORIZE_ORGANIZE 任务如果需要类似"资源清单"注入**：直接照抄——`readIndex(workspaceId)` → 判空 → 组 `string[]` → 塞进对应任务的 prompt 拼接处，不用碰 `agent-query-config.ts` 或 `query()` 的 `options`。

**Prune 工具的 allowedTools 未加**：`handleCategorizeSessionTask` 的 `allowedTools` 数组仍只有 `ListCategories` / `SaveCategory`（本步骤计划要求 PruneCategoryTags 不用在 per-group 流程引用）。Step 3 的 organize 任务大概率需要在自己的 `query()` 里显式加上 `mcp__dogear-smart-category__PruneCategoryTags`。

**决策流程摘要（Step 3 organize prompt 参考）**：新的 categorize-prompt 是两层分支树——先看 `atLimit`（ListCategories 返回的字段），未满走 JOIN vs NEW 的语义相关性判断（JOIN 时再细分 anchorTags 是否 =10 决定 add 还是 replace）；已满先尝试「合并两个高重合分类腾位置 + 紧接着新建」，都合不了才降级为强制 JOIN。organize 任务大概率会用 PruneCategoryTags 覆写（批量场景），而不是 add/replaceAnchorTags 的增量逻辑。

**dev 环境操作提示**（Step 4 手测注意）：子会话删除了本地 `.dogear/categorize-prompt.md` 和 `.dogear/group-digest-prompt.md` 两个过时种子文件（loadXxxPrompt 缺失时会用新 DEFAULT 重播种）；如果 Step 4 手测的 configDir 下已有旧种子，需要先删掉才能吃到新提示词。
