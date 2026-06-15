# 对话列表智能分类设计

> 状态：设计已与用户对齐，待拆实现计划
> 背景：会话摘要卡上线后，左侧对话列表仍是平铺时间排序，会话多了难找。引入「智能分类」复用摘要卡能力，按主题自动归类；同时保留手动文件夹作为用户兜底。

## 1. 目标与原则

- **以智能分类为主**，替换当前"按时间排序的散落会话"位置；时间排序作为可切换的备选视图保留
- **手动区只放文件夹**，不再容纳散落会话——散落会话默认走智能/时间区
- **同一会话可在多处出现**（手动文件夹 + 智能分类 + 时间分组），但 tab 唯一
- **智能区只读**：分类、命名、合并、拆分全权交给 agent；用户要"自己整"就去手动区
- **每个工作区独立**：分类决策不跨工作区。粗粒度 5–10 个分类，单层无嵌套（典型工作区只做一个方向）
- **避免雪崩**：每次新摘要卡只触发局部决策，不全量回扫；只有"初始化/重置"才整体重做

## 2. 数据模型

### 2.1 摘要卡扩展（既有 DigestCard）

新增 frontmatter 字段：

```yaml
tags:
  primary: "产品-Dashboard"           # 主标签，自由文本
  secondary: ["UI重构", "用户反馈"]   # 0–3 个辅标签
  scores:                              # 每个标签的适配度 0–1
    "产品-Dashboard": 0.85
    "UI重构": 0.6
    "用户反馈": 0.4
```

打标签由 `DigestSession` 提示词承担，与生成摘要卡同一次 query 完成，零额外成本。

### 2.2 智能分类索引

新文件：`<configDir>/workspaces/<wsId>/smart-categories.json`

```ts
{
  categories: [{
    id: "cat_xxx",
    name: "产品设计",
    anchorTags: ["产品-Dashboard", "产品-Sidebar", "UI重构"],  // 分类的"指纹"
    conversationIds: ["conv_a", "conv_b"],
    createdAt, updatedAt
  }],
  // 决策审计，最近 20 条，方便排查"为什么会被分到这里"
  recentDecisions: [{ time, conversationId, decision, reason }]
}
```

- 反向引用：会话与分类是多对多，存在 categories[].conversationIds[] 里
- 不修改 `conversations.json`，保持既有结构干净

### 2.3 手动文件夹结构改造

当前 `ConversationTreeData`：

```ts
{
  folders: Record<folderId, {id, name, createdAt}>
  children: Record<parentId, string[]>  // 邻接表，混放 folderId 和 conversationId
}
```

新版语义调整（**字段不变**）：

- `children[__root__]` 只允许放 folderId，不再放 conversationId
- 其他 `children[folderId]` 仍混放，但允许**同一 conversationId 出现在多个 key 的 value 里**（多文件夹引用）

## 3. 流程：提炼 → 分类

### 3.1 阶段 1：DigestSession 打标签（每次会话提炼时）

提示词追加：要求 agent 在 SaveDigest 同时输出 tags 字段。**优先复用工作区现有标签**（prompt 里塞当前所有 tag 列表 + 频次），避免近义割裂。

标签归一化（代码层）：trim、统一中划线/斜杠、大小写；不做近义合并（agent 的事）。

### 3.2 阶段 2：CategorizeSession 决策（新增任务类型）

`DigestSession` 成功后串行触发（同队列、并发 1、可 cancel），payload: `{ workspaceId, conversationId, digestPath }`。

**Step A · 纯阈值匹配**（代码层，0 LLM）

```
对每个分类 cat:
  score = Σ scores[t] for t in (newTags ∩ cat.anchorTags)
if max(score) ≥ 0.5: → 命中，push 到 conversationIds，审计 "match"，结束
if 命中多个: 多标签归类，都 push
```

**Step B · 无匹配 → LLM 决策**

agent 输入：
- 新摘要卡的 overview + tags
- 所有现有分类的 `{name, anchorTags, 样例 3 个会话标题}`
- 当前分类数 / 上限（10）
- "潜在受影响候选名单"（见 Step C）

agent 必须从 2 个动作中选一个：

```ts
JOIN_EXISTING { categoryId, addAnchorTags?: string[] }
  // 归入老分类；可选扩它的 anchor 标签
NEW_CATEGORY { name, anchorTags, redistribute?: [{conversationId, moveToCategoryId}] }
  // 新建分类；同次响应附带受影响候选的迁移决定
```

**Step C · 受影响候选剪枝**

代码层提前召回（不让 agent 看全量）：

- 与新分类 anchor 标签有重叠的**最多 2 个**邻近老分类
- 每个老分类内挑：适配度最低的 5 条 + 标签和新分类有交集的 5 条（去重，≤10 条）
- 喂给 agent：候选的标题 + 标签 + 在原分类的适配度分

agent 在 NEW_CATEGORY 同次响应里输出 `redistribute`，**不发起第二次 LLM 调用**。

### 3.3 决策权重提示词

```
原则（按优先级）：
1. 分类宁可宽不要窄。新摘要卡能与任何现有分类有合理语义关联 → JOIN_EXISTING
2. 仅当与所有现有分类语义距离都明显较远时 → NEW_CATEGORY
3. JOIN_EXISTING 时，新标签若语义贴近且能丰富画像 → 加进 addAnchorTags；
   若只是边角、加进去稀释 → 不加
4. NEW_CATEGORY 时，整理候选只移动"明显更适合"的，
   不为对称、平衡、清空而强行迁移 —— 宁可少动
5. 已达上限（10 个）则禁止 NEW_CATEGORY，必须 JOIN
```

## 4. UI 结构

```
═══════════════════════════════════
📁 手动区（只有文件夹）
  📁 文件夹 A
    💬 会话 1
  📁 文件夹 B
  ＋ 新建文件夹              ← 零文件夹时只显示此按钮

─── [🧠 智能] | [⏱ 时间] ───  ← 视图 tab 切换，默认智能，不记住偏好

  当 🧠 智能：
    ⚡ 近期（< 5 天）
    🏷 产品设计 (12)
    🏷 代码优化 (8)
    ...

  当 ⏱ 时间：
    ⚡ 近期（< 5 天）
    📅 30 天内
    📅 更早

📦 归档（永远在最下）
═══════════════════════════════════
```

### 4.1 交互细节

- **「近期」< 5 天**：两种视图都置顶；5 天内会话**照常**走分类决策，只是同时也在近期展示
- **「近期」是虚拟节点**：不存数据，渲染时按 `created_at > now - 5d` 实时筛
- **空分类不渲染**：`conversationIds.length === 0` 时隐藏节点（数据保留）
- **分类排序**：按 `conversationIds.length` 倒序（活跃在上）；分类内按 `updated_at` 倒序

### 4.2 同一会话多处出现的处理

- 节点右侧轻量角标 `⟂N`（N = 该会话还出现在几个其他位置），hover 看具体位置
- N=0 时不显示
- 角标 ≥5 时变橙，是"分类没分好"的可视化信号

### 4.3 Tab 唯一性

- tab key = `conversationId`
- 点任何节点 → `openOrFocusTab(conversationId)`：命中已存在 tab 就 setActive，没有就新开
- 树的视觉高亮分两层：
  - **选中态**：深色背景，单节点（你刚点的那个）
  - **已打开态**：淡色背景，可能多节点（指向同一 tab 的所有节点）

独立窗口（session-window）和主窗口算两套 tab 空间，互不影响（保持现状）。

### 4.4 右键菜单

| 位置 | 菜单项 |
|------|--------|
| 智能区 / 时间区的会话 | **添加到文件夹 ▸**（多选子菜单，已加打勾）、分叉、归档、重命名 |
| 手动文件夹内的会话 | **移动到文件夹 ▸**（单选）、**从文件夹移除**（仅清这一处引用）、分叉、归档、重命名 |
| 智能分类节点 | 无右键（只读） |
| 手动文件夹节点 | 重命名、删除（既有） |

## 5. 归档行为

- 归档 = 设置 `conversation.archived_at`，**不动**任何文件夹/分类的 `conversationIds[]`
- 所有节点渲染时统一过滤 `archived_at != null` 的会话 → 一次操作所有位置同步消失
- 归档节点反过来只显示 `archived_at != null` 的
- 恢复归档 = 清空 `archived_at`，所有引用自动复原
- **agent 决策时跳过归档会话**（提示词约束）

## 6. 设置页暴露

设置 → 会话摘要卡分节追加：

- **智能分类总开关**（关掉回退到现状）
- **匹配阈值滑杆**（默认 0.5，0.3–0.8）
- **分类数上限**（默认 10，先锁死，看后续）
- **模型方案选择**（与 digest / review 对齐）：
  - `categorizeProfileId`：独立模型方案，缺省回退 `activeProfileId`；下拉选已配置的 profiles
  - `categorizeModelTier`：`haiku | sonnet | opus`，默认 `haiku`（决策成本低、走快档即可）
  - 方案不完整时任务直接返回明确 error（与 digest 一致），不静默回退
- **提示词编辑**：`categorize-prompt.md` 内嵌编辑器（仿 digest-prompt / review-prompt 的播种机制）
- **批量重新提炼**（已有"重新提炼"单卡功能，加批量按钮）
- **立即重跑全部分类**（清空 `smart-categories.json` + 把所有摘要卡的 tags + 标题一次性喂给 agent，让它整体产出分类布局——适合初始化和重置）
- **分类活动状态**：current / queue / recent + cancel 按钮（与 digest / review 一样的轮询）

## 7. 数据迁移

**一次性迁移脚本，启动时跑**：

```
for (id of children[__root__]) {
  if (id 是 conversationId) {
    children[__root__].splice(id)
  }
}
// folder 节点保留；folder 下的会话引用都保留；conversation 表本体不动
```

非常轻：**没有字段删除、没有 schema 变更**。散落会话只是从手动区根部移到下半部分——视觉上不会"消失"，会走智能/时间区渲染。

**首次启动新版引导**：弹一次"初始化分类"提示卡，让用户点一下触发"立即重跑全部分类"。在此之前，散落会话仍能通过时间视图找到，不会丢。

## 8. 边界与遗留

### 8.1 历史摘要卡

- 不强制全量回填 tags
- 通过"立即重跑全部分类"一次性走批量分类时，agent 会同步给老摘要卡产出 tags（写回 frontmatter）
- 不提供"仅补标签"的独立动作（路径过窄、维护成本不划算）

### 8.2 任务编排

- `CategorizeSession` 走现有 `agent-manager` 队列，并发 1
- 失败重试 1 次；仍失败 → 审计标记 error，下次新摘要触发时一并重试
- cancelable（接 AbortController），cancelCategorize → cancelTask

### 8.3 故意不做（YAGNI）

- 不做分类层级（二级分类）—— 粗粒度路径不需要
- 不做"分类合并"按钮 —— agent 决策时自然处理
- 不做"标签编辑器" UI —— 标签是 agent 产出的，用户改不动
- 不做"分类锁定" —— agent 全权改名，包括重组/扩大场景

## 9. 实现切入点（落地计划另写）

- 类型：
  - `types/digest.ts` 加 `DigestTags`
  - `types/smart-category.ts` 新增
  - `types/settings.ts` 在 `ai` 下加 `categorizeProfileId` / `categorizeModelTier`（默认 `haiku`）+ 顶层加 smart-category 相关开关字段（enabled / threshold / maxCategories）
- 存储：`memory/smart-category-store.ts`（仿 `digest-store.ts`）
- 决策：`memory/smart-category-engine.ts`（Step A 纯函数 + Step B 触发 LLM 任务）
- 任务：`agents/task-types.ts` 加 `CATEGORIZE_SESSION`；`agent-worker.ts` 加 handler（按 `categorizeProfileId` + `categorizeModelTier` 重建凭证 env，接 AbortController）
- 工具：`agents/tools/category-tools.ts`（dogear-smart-category MCP server：ListCategories / SaveCategory / RedistributeConversations）
- 提示词：`memory/categorize-prompt.md` 模板 + `loadCategorizePrompt` 播种 + `saveCategorizePrompt` 写入
- IPC：`tipc/category.ts`（getCategories / triggerCategorize / triggerFullRebuild / getActivity / cancel + get/setCategorizePrompt / get/setCategorizeProfileId / get/setCategorizeModelTier + 阈值/开关读写）
- 前端：`stores/smart-category-store.ts`；`components/ConversationList.tsx` 重构（拆出 ManualSection / SmartSection / TimeSection / ArchiveSection 子组件）
- 设置：`app/settings/` 在「会话摘要卡」Tab 追加分类相关控件（开关 / 阈值 / 上限 / 方案 / 档位 / 提示词 / 活动 / 立即重跑）
- 迁移：`workspace-json-service.ts` 启动时跑一次 `children[__root__]` 散落清理
