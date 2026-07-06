# 智能分类硬上限与整理机制设计

## 背景

当前智能分类系统在 5 个月使用后出现严重的**标签爆炸**和**兜底桶效应**：

- **标签数量失控**：单个分类 anchorTags 累积到 71 个（智能分类）、58 个（会话组）、30 个（性能优化），远超能有效指导匹配的量级
- **同义词大量并存**：同一分类下 `调试` / `代码-bugfix` / `代码-缺陷修复` / `功能修复` 五个近义词共存，`前端-hooks` / `前端-React` / `前端-UI组件` / `前端-UI交互` 平行存在
- **最早分类变成垃圾桶**：`智能分类` 分类装了 24 个组，因为它是最早创建的 + `atLimit=true` 强制 JOIN，什么都往里塞
- **matchByThreshold 失效**：标签越多，任意子串命中概率越高，"快速通道"退化为"任意通过"

**根本原因（三重叠加）**：
1. `SaveCategory` 落库时 `anchorTags: [...new Set([...cat.anchorTags, ...addTags])]` **只去重不设限**
2. 满 10 个分类时 `atLimit=true` **只禁 NEW 不触发整理**，直接强 JOIN 当前卡
3. 提炼 agent **完全自由造词**，看不到分类词汇表，每次生成不同风格的 tag

**用户判断（关键洞察）**：**上限 = 触发整理的信号，不是终点**。10 个分类 × 10 个标签 = 100 个信息位应该足够容纳所有会话。撞上限时应该做取舍，不是硬塞或截断。

## 目标

让智能分类系统在 **10 分类 × 10 标签** 的硬上限内保持整洁：

- 存量数据一次性清理到位（多个分类的 anchorTags 压到 ≤10）
- 新增数据从源头对齐（提炼时看得见现有分类词汇）
- 撞上限时触发整理决策（agent 全自主判断合并/替换）
- 老组的归属漂移问题走**归档路线**根治（阶段 2 单独设计）

## 架构

### 分阶段推进

| 阶段 | 目标 | 覆盖问题 |
|------|------|---------|
| 阶段 1（本次实施） | 治当前的标签爆炸 + 撞上限硬塞问题 | 战术层 + 战役层 |
| 阶段 2（后续单独立项） | 归档机制淘汰老组 | 战略层 |

### 阶段 1 的五个动作

#### 动作 1：提炼时看得见分类词汇（源头对齐）

**改动位置**：`electron/main/services/memory/group-digest-prompt.md`（提示词）+ 提炼任务 agent 上下文

**具体做法**：
- 提炼任务启动前，代码层把当前工作区所有分类的 `{name, anchorTags}` 塞进提示词上下文
- 提示词新增一段引导："打 tag 时优先从现有分类的 anchorTags 里选择；实在没合适的才自造"
- 冷启动阶段（没分类）继续自由生成，不冲突
- 不新增工具（不用 ListCategories），直接把词汇表当只读上下文注入，避免 agent 多一次工具调用

**为什么不排斥自造**：偶尔冒出新主题（比如首次做"股票分析"）是合理的，硬限制会让新主题永远无法诞生

#### 动作 2：SaveCategory 硬上限 10 + 撞上限触发整理

**改动位置**：`electron/main/agents/tools/category-tools.ts`（工具 schema + 落库逻辑）+ `categorize-prompt.md`（提示词）

**具体做法**：

1. **anchorTags 硬上限 10**
   - `SaveCategory` 落库时校验 `anchorTags.length > 10` → 返回 Error 让 agent 重决策
   - 新增 action 参数 `replaceAnchorTags?: string[]`：覆写整个 anchorTags 数组（不是 append）
   - 提示词强制：当现有 anchorTags 已达 10 时，agent 必须给出 `replaceAnchorTags` 才能生效

2. **分类上限 10 时触发 MERGE 评估**
   - 新增 action 类型 `MERGE_CATEGORIES { fromIds: [id1, id2], name, anchorTags, redistribute? }`
   - 提示词流程改造：`atLimit=true` 时先评估现有 10 个分类里能否合并两个腾位置
     - 能合 → 输出 `MERGE_CATEGORIES` + 后续 `NEW_CATEGORY`（两次 SaveCategory 调用）
     - 不能合 → fallback 到 `JOIN_EXISTING`
   - MERGE 落库：删除 fromIds 两个分类，创建新分类，把两分类的所有 groupIds 合并到新分类

3. **提示词收紧 addAnchorTags 行为**
   - 从"贴近就加、能丰富画像"改为"默认不加；除非该 tag 能提升未来快速匹配的准确度"
   - 明确列反例：`调试` `bugfix` `前端-React` 这种泛词一律不加
   - 每次 JOIN 最多 1-2 个新标签（不新增字段约束，靠提示词）

#### 动作 3：存量一键清理

**改动位置**：新增 `electron/main/services/memory/category-organize-trigger.ts` + `app/settings/memory/SmartCategoryPanel.tsx`（按钮）

**具体做法**：
- 设置页智能分类面板加按钮「一键整理现有标签」（需 confirm-store 二次确认）
- 触发新任务 `CATEGORIZE_ORGANIZE`（区别于 per-group 的 `CATEGORIZE_SESSION`）
- 编排：串行队列并发 1；跑期间禁止普通 categorize 入队
- Agent 任务：
  - `ListCategories`（含 anchorTags + 样例组标题）
  - **逐个分类**判断：哪些 tag 是同义词可合并、哪些是过时噪声可删
  - 每个分类调用新工具 `PruneCategoryTags({ categoryId, newAnchorTags })` 覆写 anchorTags 数组
  - **可选**：如果两个分类语义高度重合，agent 提议 MERGE_CATEGORIES（但不强制）
- 活动状态同现有 categorize-trigger（可停止、进度可见）

#### 动作 4：matchByThreshold 保留不动

- 现在 anchorTags 会被压缩到 ≤10 个精准词汇，命中变成有信号
- `matchByThreshold` 现有的 primary+secondary 字符串精确匹配保留
- 阈值配置保持现状（不再需要提高，因为标签精准了）

#### 动作 5：REORGANIZE 暂不做（走归档路线）

- 之前讨论的"MERGE 后重排相关组"暂不实施
- 依据：老组的归属漂移问题由**阶段 2 的归档机制**根治
- MERGE 后 groupIds 直接合并（原分类的组全归到新分类）
- 短期内可能有错配，等阶段 2 归档机制上线后自然消解

## 模块边界

### 需要修改的文件

| 文件 | 改动内容 |
|------|---------|
| `electron/main/agents/tools/category-tools.ts` | SaveCategory 加 MERGE_CATEGORIES action + replaceAnchorTags 参数 + 10 硬上限校验；新增 PruneCategoryTags 工具 |
| `electron/main/services/memory/smart-category-store.ts` | 新增 mergeCategories 纯函数（合并两分类的 groupIds） |
| `electron/main/services/memory/categorize-prompt.md` | 提示词流程改造（atLimit 触发 MERGE 评估、addAnchorTags 收紧、standalone 存量清理提示词分开） |
| `electron/main/services/memory/group-digest-prompt.md` | 加"看现有 anchor 词汇再打 tag"段落 |
| `electron/main/agents/agent-worker.ts` | 提炼任务前拉分类词汇塞进上下文；新增 handleCategorizeOrganizeTask |
| `electron/main/agents/task-types.ts` | 新增 CATEGORIZE_ORGANIZE 任务类型 |
| `electron/main/services/memory/category-organize-trigger.ts` | 新增：存量清理编排（串行队列 + 活动采集） |
| `electron/main/tipc/category.ts` | 新增 triggerCategorizeOrganize / cancelCategorizeOrganize IPC |
| `app/settings/memory/SmartCategoryPanel.tsx` | 加「一键整理现有标签」按钮 + 活动状态展示 |
| `stores/smart-category-store.ts` | 加对应的 store action |

### 不动的文件

- `smart-category-engine.ts`（matchByThreshold + normalizeTags 保留）
- `category-trigger.ts`（per-group 触发链路不变，只是新增 Organize 平行链路）
- 数据模型 `SmartCategory` / `CategorizeDecisionLog`（不改结构，只加值）

## 数据流

### 新入卡流程（阶段 1 完成后）

```
新组卡产生（提炼 agent 已经用当前分类词汇打了对齐的 tag）
    ↓
category-trigger.triggerCategorize(workspaceId, groupId, digestPath)
    ↓
Step A: matchByThreshold（tag 精准 → 命中率高）
    ├─ 命中 → JOIN，写日志，结束
    └─ 未命中 → Step B
        ↓
Step B: LLM 决策（agent 调 ListCategories + SaveCategory）
    ├─ atLimit=false
    │   ├─ 能贴现有分类 → JOIN_EXISTING（addAnchorTags 只在能提升匹配时才加，且校验 ≤10）
    │   └─ 都贴不上 → NEW_CATEGORY
    └─ atLimit=true
        ├─ 评估现有 10 个能合并两个 → MERGE_CATEGORIES + NEW_CATEGORY（两次调用）
        └─ 都不能合 → JOIN_EXISTING（fallback）
    ↓
落 recentDecisions 日志 + broadcast categoriesUpdated
```

### 存量清理流程（新增）

```
用户点「一键整理现有标签」按钮（confirm-store 二次确认）
    ↓
triggerCategorizeOrganize(workspaceId)
    ↓
CATEGORIZE_ORGANIZE 任务入队（串行 + 禁止普通 categorize 并发）
    ↓
agent-worker.handleCategorizeOrganizeTask
    ↓
agent 循环：
  - ListCategories（读全部分类含 anchorTags + 样例组标题）
  - 对每个 anchorTags 超过 10 的分类：
      合并同义词、删过时词 → PruneCategoryTags 落库
  - 可选：识别语义高度重合的分类对 → MERGE_CATEGORIES
    ↓
完成后自动清空活动状态、broadcast categoriesUpdated
```

## 错误处理 / 边界情况

- **提炼时分类为空**（新工作区/新用户）：不塞词汇表，agent 自由造词，跟当前行为一致
- **PruneCategoryTags 传入 >10 个 tag**：工具返回 Error（防御性校验）
- **MERGE_CATEGORIES 两个 fromIds 相同或不存在**：工具返回 Error
- **MERGE 后 groupIds 合并去重**：`[...new Set([...cat1.groupIds, ...cat2.groupIds])]`
- **存量清理中途取消**：已 Prune 的分类保留（不回滚），未处理的下次再整理
- **存量清理并发保护**：Organize 跑期间新组卡触发的 categorize 排队等待，不并发
- **提炼上下文里的分类词汇表体积**：10 分类 × 10 tag × 20 字 ≈ 2000 字，可接受

## 已决事项

1. **recentDecisions.decision 扩展**：新增 `merge` 和 `prune` 两个值（否则事后查不到分类结构变化）
2. **UI 进度粒度**：逐分类展示 tag 压缩进度（如 "智能分类: 71 → 10"）
3. **提炼词汇表格式**：`分类名: [tag1, tag2, ...]` 一行一分类塞进提示词
4. **matchByThreshold 阈值当前值**：`0.5`（settings 默认，本次不改，等标签精准化后观察命中率再定）
5. **存量清理时的 MERGE**：agent 发现两分类语义高度重合就主动提议 MERGE_CATEGORIES，一次整理到位

## 阶段 2 骨架（后续单独设计）

**触发点**：本次不实施，作为路线图占位。

**核心机制**：
- 组活跃度检测：按 `group.updatedAt` 或组内最新 `conversation.updatedAt`，超过阈值（默认 3 个月，可配置）
- 归档触发：手动按钮 / 或定时扫描
- **归档前跑一次 review**（用户明确选择）：确保有价值信息已沉淀到记忆
- 归档态：从 `categories.groupIds` 移除，组卡文件保留（不删）+ 加 `archivedAt` 字段
- UI：设置页或首页加"已归档组"入口，允许用户回看

**归档带来的连锁收益**：
- 分类系统不再累积历史包袱
- MERGE 后不需要复杂的 REORGANIZE 重排逻辑
- 老组的归属漂移问题自动消解（因为它已不在分类系统里）

**待讨论**：
- 阈值默认多长（1 个月 / 3 个月）
- 是自动归档还是手动触发
- 归档后能否恢复
- 是否需要"手动归档单个组"入口

### 阶段 2 附加：老会话周总结（年终总结雏形）

**动机**：老会话归档后只保留组卡文件太"死"，用户希望能定期回看"这段时间在做什么"，一年下来累积 52 条周总结 ≈ 年终总结素材。

**核心机制**：
- 定时任务（每周一次）扫描该周内活跃过的老会话/老组
- 单独跑一次总结 agent：读该周内所有相关组卡 + review 沉淀过的内容，产出**一条**周总结
- 存储位置：单独目录（如 `<configDir>/workspaces/<wsId>/weekly/YYYY-Www.md`）
- 内容形态：简短（3-5 条），类似"这周主要在做 X、决定了 Y、搁置了 Z"
- 展示：可以放在首页或独立"回顾"入口，一年下来 52 条构成时间轴

**与归档的关系**：
- 归档解决"分类系统的历史包袱"
- 周总结解决"用户想回看历史但不想读组卡"
- 两者独立，可先后实施
- 周总结基于 review 已经沉淀的内容，不做额外提炼——同"信任沉淀链路"原则

**待讨论**：
- 触发时机（自动定时 / 手动触发）
- "活跃过"定义（该周内 dirty 过的组 / 该周内有 conversation 更新的组）
- 是否也生成月总结 / 季度总结
- 与首页报告的区别（首页是"现在应该关注什么"，周总结是"这段时间做了什么"）
