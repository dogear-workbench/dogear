# 里程碑 1：规则文件化 + 静态记忆系统

> 创建日期：2026-05-05
> 状态：设计中（待评审 → 实施）
> 路线图位置：`advanced-capabilities-roadmap.md` 的里程碑 1
> 前置条件：无
> 预估工作量：2 周（设计评审后拆为具体 todo）

---

## 一、里程碑目标

建立 **规则层（CLAUDE.md 三级）** 和 **记忆层（核心档案 + 主题记忆）** 的双轨架构。

**本阶段仅做静态部分**：
- ✅ 规则三级文件化 + SDK 自动加载
- ✅ 记忆数据结构 + 存储层 + Agent 工具
- ✅ 设置页记忆管理 UI（手动增删改查）
- ❌ 做梦系统（里程碑 2）
- ❌ 自动提炼（里程碑 2）

**验收标准**：
1. 用户可以在 `~/.claude/CLAUDE.md` 写全局规则，所有 dogear 工作区都能读到
2. 用户可以在 dogear 设置页手动添加/编辑/删除记忆条目
3. Agent 在对话中可以通过 `RecallMemory` 工具按关键词查记忆
4. 核心档案（core-profile.md）自动注入每次会话的 system prompt

---

## 二、架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        规则层（人工维护）                      │
│                                                             │
│  ~/.claude/CLAUDE.md           ← SDK 自动加载（新）         │
│  <workspace>/.claude/CLAUDE.md ← SDK 自动加载（已有）        │
│  persona.prompt                ← 已有，跨会话               │
│  tempPrompt                    ← 已有，单次会话             │
│                                                             │
│  关键变更：settingSources: ['project'] → ['user', 'project']│
└─────────────────────────────────────────────────────────────┘
                             │
                             │ 两条线互不干扰
                             │
┌─────────────────────────────────────────────────────────────┐
│                   记忆层（AI 生成 + 用户巡检）                 │
│                                                             │
│  .dogear/memory/                                            │
│    ├─ core-profile.md       ← 自动注入 system prompt        │
│    │   （~500 token 硬限，存"用户是谁"）                    │
│    │                                                        │
│    ├─ topics/               ← 按需查询                     │
│    │   ├─ stock-analysis.md                                │
│    │   ├─ memory-design.md                                  │
│    │   └─ ...                                              │
│    │                                                        │
│    └─ index.json            ← 主题 → 关键词 → 文件映射      │
│                                                             │
│  访问方式：                                                  │
│    • core-profile 自动注入（在 buildSystemPrompt 中）        │
│    • topics 通过 RecallMemory(keywords) 工具按需查          │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、数据结构设计

### 3.1 core-profile.md（核心档案）

**位置**：`.dogear/memory/core-profile.md`（每工作区一份）
**大小上限**：~500 token（UI 层提示超限，不强制拦截）
**加载方式**：每次会话启动时读取并注入 `systemPromptAppend` 开头

**格式约定**：

```markdown
---
updated: 2026-05-05T14:30:00Z
---

# 用户画像

## 身份
dogear 主开发者。偏好先设计后实现，要求代码解耦和模块化。

## 当前主线
- 记忆大脑系统设计（优先级最高）
- 股票分析系统的 Python Bridge 优化（进行中）

## 强偏好
- 中文交流
- 开发阶段不做兼容性代码
- UI 交互状态不跨会话持久化（用 useState 而非 store）
```

**Schema 要点**：
- Frontmatter 只有 `updated` 时间戳，不搞复杂元数据
- 正文是自由 markdown，三个固定一级标题：`身份` / `当前主线` / `强偏好`
- 不做 schema 强校验——用户可以随便改格式，agent 读的是纯文本

### 3.2 topics/*.md（主题记忆）

**位置**：`.dogear/memory/topics/<slug>.md`
**文件名规则**：kebab-case slug（`stock-analysis.md`、`memory-design.md`）
**数量**：无上限，按主题分

**格式**：

```markdown
---
slug: stock-analysis
title: 股票分析系统讨论
keywords: [股票, stock, akshare, python-bridge, 选股, 技术指标]
created: 2026-04-15T10:00:00Z
updated: 2026-05-03T16:20:00Z
related_topics: [memory-design, python-bridge]
source_conversations: [conv-xxx, conv-yyy]
---

# 股票分析系统讨论

## 核心决策
- 采用 Python Bridge（JSON-RPC 守护进程）而非子进程 per-call
- 公式引擎用 Lark 做 TDX 风格表达式解析

## 未决问题
- 跨市场数据源的符号冲突怎么解决
- 回测结果的可视化要不要做
```

**Schema 要点**：
- `keywords` 是 RecallMemory 工具的主要匹配字段
- `related_topics` 供未来的语义关联用（里程碑 3）
- `source_conversations` 记录提炼自哪些会话（里程碑 2 自动填入，本阶段可以空）

### 3.3 index.json（主题索引）

**位置**：`.dogear/memory/index.json`
**目的**：让 `RecallMemory` 工具快速按关键词找到相关主题文件，不用每次都读所有 markdown

**结构**：

```json
{
  "version": 1,
  "updated": "2026-05-05T14:30:00Z",
  "topics": [
    {
      "slug": "stock-analysis",
      "title": "股票分析系统讨论",
      "keywords": ["股票", "stock", "akshare", "python-bridge", "选股", "技术指标"],
      "updated": "2026-05-03T16:20:00Z"
    },
    {
      "slug": "memory-design",
      "title": "记忆大脑系统设计",
      "keywords": ["记忆", "memory", "做梦", "pi", "规则层"],
      "updated": "2026-05-05T14:30:00Z"
    }
  ]
}
```

**维护策略**：
- 每次写入/更新 topic 文件时，`memory-service` 同步刷新 index.json
- 应用启动时做一次一致性检查（index 中声明的文件存在吗？孤儿文件补建 index？）

---

## 四、模块设计

### 4.1 Service 层

**新增目录**：`electron/main/services/memory/`

| 文件 | 职责 | 关键 API |
|------|------|---------|
| `memory-service.ts` | 记忆 CRUD 聚合入口 | `getCoreProfile()` / `updateCoreProfile(content)` / `listTopics()` / `getTopic(slug)` / `upsertTopic(data)` / `deleteTopic(slug)` |
| `memory-indexer.ts` | index.json 维护 | `rebuildIndex()` / `updateIndexEntry(topic)` / `removeIndexEntry(slug)` |
| `memory-loader.ts` | 会话启动时加载 core-profile | `loadCoreProfileForSession(workspacePath)` |
| `memory-recall.ts` | RecallMemory 工具的业务逻辑 | `recall(keywords: string[], limit?: number)` |
| `index.ts` | Barrel export | - |

**设计要点**：
- 所有文件 IO 走 `safe-json.ts` 模式（原子写入 + 备份 + 互斥锁）
- `memory-service` 是唯一的写入入口，`memory-indexer` 只读外部调用
- 不跨工作区——每个工作区有独立的 `.dogear/memory/` 目录（TODO 确认：是这样吗？还是全局共享？见下方开放问题）

### 4.2 Agent 工具层

**新增文件**：`electron/main/agents/tools/memory-tools.ts`

注册三个工具：

```typescript
// RecallMemory：按关键词查记忆
{
  name: 'RecallMemory',
  description: '查询与关键词相关的历史主题记忆。记忆按主题组织，每个主题有关键词索引。',
  input: {
    keywords: string[],  // 关键词数组（会和主题的 keywords 做交集匹配）
    limit?: number       // 默认 3，最多返回 top-N 个主题
  },
  output: {
    topics: Array<{
      slug: string,
      title: string,
      content: string,   // 完整 markdown 内容
      updated: string
    }>,
    hint?: string        // 当有更多未返回主题时的提示
  }
}

// SaveMemory：用户显式要求记住时调用
{
  name: 'SaveMemory',
  description: '保存新的主题记忆或更新现有主题。仅在用户明确要求"记住 XX"时使用。',
  input: {
    slug: string,
    title: string,
    keywords: string[],
    content: string,     // markdown 正文
    merge?: boolean      // true=合并到现有，false=覆盖（默认 false）
  }
}

// ForgetMemory：用户要求删除时
{
  name: 'ForgetMemory',
  description: '删除指定主题的记忆。仅在用户明确要求"忘记 XX"时使用。',
  input: {
    slug: string
  }
}
```

**关键约束**（写进工具 description）：
- `SaveMemory` 只在用户**明确表达**要记忆时使用，不要猜测用户意图
- `RecallMemory` 应在讨论主题的开头主动调用，不要等用户追问历史再查
- 单次 `RecallMemory` 限制 `limit` ≤ 5，避免一次拉太多污染 context

### 4.3 SystemPrompt 注入点

**修改文件**：`electron/main/agents/query-based-session.ts` 的 `buildSystemPrompt()` 方法

**当前拼接顺序**（从 CLAUDE.md 读）：
```
defaultSystemPrompt → persona.prompt → tempPrompt → systemPromptAppend
```

**新拼接顺序**：
```
defaultSystemPrompt
  → persona.prompt
  → tempPrompt
  → systemPromptAppend
  → [NEW] core-profile.md 内容（如果存在）
```

**加载逻辑**：
- `memory-loader.loadCoreProfileForSession(workspacePath)` 返回 markdown 字符串或 null
- 注入时包装一层标识：

```
---

## 用户画像（自动加载）

<core-profile 内容>

---
```

**边界**：
- 文件不存在 → 不注入（不是错误）
- 文件存在但为空 → 不注入
- 文件超过 2000 字符 → 警告日志，仍然注入（不硬截断，让用户自己调整）

### 4.4 IPC 层

**新增文件**：`electron/main/tipc/memory.ts`

| RPC 方法 | 用途 | 调用方 |
|---------|------|-------|
| `getCoreProfile(workspacePath)` | 设置页加载展示 | 设置页 |
| `updateCoreProfile(workspacePath, content)` | 设置页编辑保存 | 设置页 |
| `listTopics(workspacePath)` | 设置页记忆列表 | 设置页 |
| `getTopic(workspacePath, slug)` | 设置页详情 | 设置页 |
| `upsertTopic(workspacePath, topicData)` | 设置页手动创建/编辑 | 设置页 |
| `deleteTopic(workspacePath, slug)` | 设置页删除 | 设置页 |
| `rebuildMemoryIndex(workspacePath)` | 设置页"重建索引"按钮（运维用） | 设置页 |

注册到 `electron/main/tipc/index.ts`。

### 4.5 前端：设置页记忆 Tab

**新增文件**：`app/settings/MemoryTab.tsx`

**UI 布局**（左右分栏）：

```
┌────────────────────────────────────────────────────────┐
│ 记忆管理                                    [重建索引] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  [核心档案]  [主题记忆]                                │
│                                                        │
│  当前 Tab: 核心档案                                    │
│  ┌──────────────────────────────────────────────────┐ │
│  │ <markdown 编辑器>                                │ │
│  │                                                  │ │
│  │ 当前字符数：450 / 建议 <2000                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                         [保存]         │
│                                                        │
└────────────────────────────────────────────────────────┘

主题记忆 Tab:

┌────────────────────────────┬───────────────────────────┐
│ 主题列表                   │ 主题编辑                  │
│ ─────────────────────────  │ ───────────────────────── │
│ ◉ 股票分析系统讨论          │ Title: [股票分析系统讨论] │
│ ○ 记忆大脑系统设计          │ Slug:  [stock-analysis]   │
│ ○ Python Bridge 优化        │ Keywords: [股票] [stock] + │
│                             │                           │
│ [+ 新建主题]                │ Content:                  │
│                             │ ┌───────────────────────┐ │
│                             │ │ <markdown 编辑器>     │ │
│                             │ │                       │ │
│                             │ └───────────────────────┘ │
│                             │                [保存][删除]│
└────────────────────────────┴───────────────────────────┘
```

**实现要点**：
- 参考现有 `WorkspaceConfigTab.tsx` 的 dirty 检测和保存按钮模式
- 主题列表用简单的左侧 list，不引入树形组件
- Markdown 编辑器先用 `Textarea`（字体 mono），未来可升级到真 MD 编辑器

**注册到 `app/settings/page.tsx`**：在现有 Tab 列表中新增"记忆管理"项。

---

## 五、settingSources 变更

**当前**：`settingSources: ['project']`
**目标**：`settingSources: ['user', 'project']`

**变更位置**：
1. `types/settings.ts` 的 `DEFAULT_SETTINGS`（第 76 行）
2. `electron/main/services/settings-types.ts` 的 `DEFAULT_SETTINGS`（第 69 行）

**对老用户的兼容**：
- 老用户 settings.json 里已经写了 `['project']`，不会自动升级
- 需要加一个**迁移逻辑**：settings 加载时，如果 `settingSources` 不包含 `'user'`，自动补上（考虑是否需要开关让用户拒绝）

**用户可见影响**：
- `~/.claude/CLAUDE.md` 会被 SDK 加载，追加到 system prompt
- 如果用户已有 `~/.claude/CLAUDE.md`（比如用 Claude Code CLI 的），这些规则会生效
- 在设置页 `WorkspaceConfigTab` 的"设置源"显示区域，从只显示 `project` 改为显示 `user + project`

---

## 六、数据流总览

### 6.1 会话启动时（核心档案注入）

```
用户在 dogear 打开对话
  ↓
QueryBasedSession.start() 调用 buildSystemPrompt()
  ↓
memory-loader.loadCoreProfileForSession(workspacePath)
  ↓
读 .dogear/memory/core-profile.md
  ↓
如果存在且非空 → 拼到 systemPromptAppend 末尾
  ↓
传给 SDK query()
```

### 6.2 对话中（Agent 查记忆）

```
用户："上次我们讨论股票分析时提到的 Python Bridge 是什么方案？"
  ↓
Agent 判断需要查历史 → 调 RecallMemory(keywords=["股票", "Python Bridge"])
  ↓
memory-recall.recall() 读 index.json → 关键词匹配 → 找到 stock-analysis.md
  ↓
返回 [{ slug: "stock-analysis", content: "...", ... }]
  ↓
Agent 基于内容回答
```

### 6.3 用户手动编辑记忆

```
用户打开设置页 → 记忆管理 Tab
  ↓
client.listTopics(workspacePath) → 显示列表
  ↓
选中一个主题 → client.getTopic(workspacePath, slug) → 渲染编辑器
  ↓
编辑保存 → client.upsertTopic(workspacePath, data) → 写文件 + 更新 index.json
```

---

## 七、实施步骤（按顺序）

### Step 0：清理遗留字段和 UI 文案（0.5 天）

**目的**：在开始加新东西前，先把现有代码的暧昧地带清理掉。避免里程碑 1 实施时 `systemPromptAppend`、`defaultSystemPrompt`、`persona`、`tempPrompt`、`core-profile` 五个东西混在一个 buildSystemPrompt 里。

**任务**：

1. **移除 `systemPromptAppend` 字段**（@deprecated，全局污染源）
   - [ ] 从 `types/settings.ts` 移除字段定义
   - [ ] 从 `electron/main/services/settings-types.ts` 移除字段定义
   - [ ] 从 `electron/main/agents/query-based-session.ts` 的 `buildSystemPrompt()` 移除拼接逻辑
   - [ ] 搜索项目中所有用到 `systemPromptAppend` 的地方清理
   - [ ] `.dogear/settings.json` 手动删掉 `systemPromptAppend` 行（用户数据，不自动迁移）

2. **修正 tempPrompt 的 UI 文案**（事实与描述对齐）
   - 事实：tempPrompt 是对话私有持久字段，存在 `conversations.json` 里，跟随对话归档/重开都在
   - 修改 `components/PromptSidebar.tsx`：
     - [ ] 标签 "临时提示词" → "对话规则"
     - [ ] 说明文字 "为当前对话添加额外指令..." → "为当前对话添加专属规则（会跟随对话保存）"
     - [ ] 底部说明 "仅对当前对话生效，不会影响其他对话。" → "仅对当前对话生效，与对话一同保存（包括归档后）"
   - [ ] `components/agent-chat/` 中如果有相关 placeholder 文案也同步修改
   - [ ] **不动数据结构、字段名、存储位置**——`tempPrompt` 变量名保留，避免牵一发动全身

3. **确认清理成功**
   - [ ] 重启一个对话，查看 system prompt 日志，确认 `systemPromptAppend` 内容没有再被拼入
   - [ ] 对话侧边栏打开，确认 UI 文案已更新

**影响范围**：
- 使用 `systemPromptAppend` 的老用户：他们 settings.json 里的值失效（符合"开发阶段不做兼容"约定）
- tempPrompt 字段行为：**无变化**，只是 UI 表述对齐了实际语义

**为什么先做这步**：
- `systemPromptAppend` 如果不清理，新加的 `core-profile` 注入会跟它纠缠，buildSystemPrompt 会变成拼接 6 个东西
- UI 文案修正是 0 风险任务，顺手做掉避免后期带着疑惑设计记忆系统

---

### Step 1：数据结构和 Service 层（2-3 天）
- [ ] 创建 `electron/main/services/memory/` 目录和骨架文件
- [ ] 实现 `memory-service.ts`（CRUD）
- [ ] 实现 `memory-indexer.ts`（索引维护）
- [ ] 实现 `memory-loader.ts`（会话加载）
- [ ] 单元自测：手动创建几个测试文件，验证读写/索引一致性

### Step 2：Agent 工具层（1-2 天）
- [ ] 创建 `electron/main/agents/tools/memory-tools.ts`
- [ ] 注册 `RecallMemory` / `SaveMemory` / `ForgetMemory`
- [ ] 在 `tool-registry.ts` 注册工具元数据
- [ ] 端到端测试：起一个会话，让 agent 调用工具

### Step 3：SystemPrompt 集成（半天）
- [ ] 修改 `query-based-session.ts` 的 `buildSystemPrompt()`
- [ ] 加载 core-profile 并拼接
- [ ] 手动创建一个 core-profile.md，验证注入生效（看 debug 日志）

### Step 4：settingSources 变更（半天）
- [ ] 修改 `types/settings.ts` 和 `settings-types.ts` 的默认值
- [ ] 加入 settings 迁移逻辑（老用户自动补 'user'）
- [ ] 修改 `WorkspaceConfigTab.tsx` 的显示（支持展示多个源）
- [ ] 手动测试：写个 `~/.claude/CLAUDE.md`，验证 agent 遵守其中规则

### Step 5：IPC 层（1 天）
- [ ] 创建 `electron/main/tipc/memory.ts`
- [ ] 实现所有 RPC 方法
- [ ] 注册到 `tipc/index.ts`
- [ ] 前端 `lib/client.ts` 的类型自动更新（tipc 自动推导）

### Step 6：前端记忆 Tab（2-3 天）
- [ ] 创建 `app/settings/MemoryTab.tsx`
- [ ] 核心档案编辑器（textarea + dirty 检测 + 保存）
- [ ] 主题列表 + 详情编辑器
- [ ] 关键词编辑（chip 式 UI）
- [ ] 注册到 `app/settings/page.tsx` 的 Tab 列表

### Step 7：端到端联调（1 天）
- [ ] 创建测试核心档案 + 几个测试主题
- [ ] 起会话验证 core-profile 注入
- [ ] 让 agent 调用 RecallMemory，验证返回数据正确
- [ ] 让 agent 调用 SaveMemory，验证索引同步更新
- [ ] 手动在设置页编辑，验证 agent 立即能查到

---

## 八、开放问题（实施前需定）

### Q1：记忆是每工作区独立还是全局共享？

**背景**：`.dogear/memory/` 的位置有两种选择：
- **A. 每工作区独立**：`<workspace>/.dogear/memory/`
- **B. 全局共享**：`~/.dogear/memory/`
- **C. 两级**（推荐）：全局 `~/.dogear/memory/` + 工作区 `<workspace>/.dogear/memory/`

**论据**：
- A 的问题是："我在 dogear 工作区的偏好"和"我在 books 工作区的偏好"有大量重叠
- B 的问题是：股票相关的主题记忆不应该在书籍工作区里自动注入
- C 是最合理的，但复杂度翻倍

**建议**：MVP 阶段先做 **A**（单工作区），里程碑 3 再扩展到 C。现在代码里把 workspacePath 参数贯穿进去，未来扩展不伤筋骨。

### Q2：核心档案的大小限制怎么强制？

**选项**：
- A. 软限制：UI 层提示超过 2000 字符，不强制
- B. 硬限制：拦截保存，超出就拒绝
- C. 自动截断：保存时超长就截断（危险）

**建议**：A。单用户自用的产品，用户对自己负责。

### Q3：RecallMemory 的关键词匹配用什么算法？

**选项**：
- A. 精确字符串匹配（最简单）
- B. 小写不敏感匹配
- C. 子串匹配（"股票" 可以匹配 "股票分析"）
- D. 分词 + 交集

**建议**：B + C 组合（小写 + 子串）。D 中文分词要引入 jieba 之类的库，复杂度不值。

### Q4：core-profile 和 CLAUDE.md 是否可能内容重复？

**场景**：用户在 `~/.claude/CLAUDE.md` 写了"用中文交流"，做梦系统又把这条提到 core-profile.md。
**风险**：同一规则被注入两次，占 token。
**对策**：
- 里程碑 1 阶段用户手动维护 core-profile，不会重复
- 里程碑 2 做梦系统启动时，要加一条提示词："不要把 CLAUDE.md 已有的规则重复写入 core-profile"

---

## 九、风险与兜底

| 风险 | 可能性 | 影响 | 兜底 |
|------|-------|------|------|
| core-profile 文件损坏 | 低 | 会话启动失败 | `memory-loader` 加 try-catch，失败时不注入、记日志 |
| index.json 与实际文件不一致 | 中 | RecallMemory 返回错误数据 | 启动时做一致性检查 + 提供"重建索引"按钮 |
| Agent 误调用 SaveMemory 污染数据 | 中 | 记忆堆积垃圾 | 工具 description 强约束 + 用户设置页巡检 |
| settingSources 变更影响老用户 | 低 | 老用户的 `~/.claude/CLAUDE.md` 生效，行为变化 | 发版 changelog 明确提示 |

---

## 十、评审检查单（实施前自查）

- [ ] 文件结构清晰，模块职责单一
- [ ] 遵循"开发阶段不做兼容"的项目约定（迁移逻辑除外）
- [ ] 所有新增文件 <300 行（超了要拆）
- [ ] 前端逻辑 + UI 分离（已拆 Service / Tab / Tool 三层）
- [ ] 单用户自用的定位：不搞权限、不搞审核队列、不搞 confidence score
- [ ] IPC 类型安全（走 tipc）
- [ ] 文件 IO 用 safe-json 模式
- [ ] 不引入新依赖（md 解析用现有 react-markdown、frontmatter 解析用现成小库或手写正则）
- [ ] 不动主对话的 SDK 集成逻辑（只在 buildSystemPrompt 加一行）

---

## 修订历史

- 2026-05-05：初版设计。规则层 + 记忆层双轨，里程碑 1 只做静态部分
