---
step: 2
title: 提示词与提炼源头对齐
status: pending
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

## 实施回填（做完后填）

### 实际改动
（TBD）

### 给下一步的接力棒
（TBD — 至少要写：agent-worker.ts 里注入词汇表的具体函数/位置，方便 Step 3 复用同样机制注入 organize 上下文；如果发现 categorize-prompt 结构有大改，需要提示 Step 3 的 organize prompt 是否也需要跟着改）
