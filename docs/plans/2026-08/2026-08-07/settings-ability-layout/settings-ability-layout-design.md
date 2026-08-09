# 设置页能力 Tab 重组设计

**背景**：第一阶段已完成统一工具注册中心（ToolGroupRegistration），消除了工具元数据双写。第二阶段聚焦设置页：当前 13 个 Tab 信息割裂，工具/Skill/提示词三者关联不可见，8 个条件挂载工具组完全不在设置页展示。

**目标**：
1. 所有能力（提示词 + 工具 + Skill）在一个 Tab 内以「能力域卡片」形式展示
2. 用户能看到每个能力的完整构成（提示词内容 / Skill 全文 / 关联工具）
3. Skill 统一为模板订阅模式，内置模板可恢复
4. 工具描述治理：工具只回答「是什么、怎么调」，行为规范/约束交给提示词；提示词只保留警告级约束（易错、易忘），不搬运常识

## 架构

### Tab 结构变化

| 原始 | 变化 |
|------|------|
| AI 行为 | → **基础设置**：原内容 + 基础工具权限（7 个 allow/ask）移入 |
| 工具与权限 | → **能力**：能力域卡片 |
| Skill 管理 | **删除**，吸收进能力卡片 |
| 系统提示词 | **删除**，吸收进能力卡片 |
| 其他 Tab | 不变 |

### 「能力」Tab 卡片布局

每个能力域是一个卡片，左右分栏：
- **左侧**：提示词全文（短内容直接展示）/ Skill 索引（name + description + 详情入口）
- **右侧**：关联工具组列表（每组一行 name + 描述）
- **浮窗**：Skill 详情（SKILL.md 全文），平铺放不下的长内容才弹浮窗

### 能力域列表（按展示顺序）

| 顺序 | 能力域 | 左侧 | 右侧工具 | 开关 |
|------|--------|------|---------|------|
| 1 | 记忆系统 | 说明文字（无独立提示词段） | dogear-memory (3) | 常驻 |
| 2 | Agent 协作 | 6 段注入提示词（reference / group-context / group-append / notes / delegation / sub-contract / main-agent） | delegation (6) + group (3) + reference (3) | 条件挂载，不可关 |
| 3 | 股票分析 | Skill: stock-analysis | stock (6) + analysis (7) + announcement (2) + picking (2) | 工具包开关 + Skill 开关 |
| 4 | 代码工作流 | 6 个 Skill（brainstorming / systematic-debugging / staged-impl / staged-execution / codebase-map / doc-sync） | 复用基础工具，不额外展示 | Skill 开关 |
| 5 | 文章 | （无提示词） | article (2) + article-parse (9, 后台) | 工具包开关 |
| 6 | 自定义 Skill | 用户自建 skill，逐个列出 | — | 可关 + 详情浮窗 |

> 后台任务工具（review / digest / category / group-digest）不进能力 Tab，展示在「会话摘要」Tab。

卡片示例：

```
┌─ Agent 协作 ────────────────── 条件挂载 ─┐
│  左侧                           │  右侧     │
│  ## 主会话协作规范               │           │
│  当你用 CreateSession...        │ delegation│
│                                  │ group     │
│  ## 引用历史会话                 │ reference │
│  如需引用...                     │ (12 个工具)│
│  ...                             │           │
└──────────────────────────────────┴──────────┘

┌─ 股票分析 ──────────── [Skill开关] [工具包开关] ┐
│  左侧                            │  右侧            │
│  stock-analysis                  │ stock (6)        │
│  股票技术指标计算、条件筛选...    │ analysis (7)     │
│  [详情→] [恢复]                  │ announcement (2) │
│                                  │ picking (2)      │
└───────────────────────────────────┴──────────────────┘

┌─ 代码工作流 ────────────────────── [Skill开关] ┐
│  左侧                              │  右侧        │
│  brainstorming [详情→] [恢复]      │（复用基础    │
│  systematic-debugging [详情→] [恢复]│  工具，      │
│  staged-impl [详情→] [恢复]        │  不额外展示） │
│  staged-execution [详情→] [恢复]   │              │
│  codebase-map [详情→] [恢复]       │              │
│  doc-sync [详情→] [恢复]           │              │
└─────────────────────────────────────┴──────────────┘
```

## Skill 模板订阅统一

**现状**：4 种来源分散
- 代码工作流 6 个：仓库 `.claude/skills/`，无开关
- 股票分析：TS 常量，订阅写入工作区
- 文章解析：TS 常量，运行时写入 `.dogear/skills/`
- 复盘：TS 常量，运行时写入 `.dogear/skills/`

**目标**：统一模板源目录 `resources/skill-templates/*/SKILL.md`
- 开发时直接读源文件，构建时随 app 打包
- `listSkillTemplates()` 遍历此目录返回所有可用模板
- `subscribeSkillTemplate()` 从此目录复制到工作区
- 股票分析/文章解析/复盘的 TS 常量内容提取为文件放入
- 代码工作流 Skill 从 `.claude/skills/` 迁移到此目录

**恢复按钮**：内置模板（代码工作流 / 股票分析 / 文章解析 / 复盘）在对应能力卡片上显示「恢复」按钮，从模板源重新复制覆盖工作区副本。

## 交互细节

- **Skill 详情浮窗**：点击 [详情→] 弹出，显示 SKILL.md 全文（只读，可滚动）
- **Skill 开关**：改名 SKILL.md ↔ SKILL.md.disabled，重启会话生效
- **提示词段**：条件注入的不可关，直接展示全文 + 小副标题（label）
- **工具包开关**：现有逻辑不变（enabledToolPacks）
- **条件挂载工具组**：不可关，标注激活条件（如「有 groupId 时挂载」「子会话独占」）

## 模块边界

| 文件 | 改动 |
|------|------|
| `app/settings/page.tsx` | Tab 重命名/合并，基础工具权限移入基础设置 Tab |
| `app/settings/ToolsAndPermissionsTab.tsx` | 重写为「能力 Tab」，能力域卡片组件 |
| `app/settings/SystemPromptPreviewTab.tsx` | 删除（内容吸收进能力卡片） |
| `app/settings/SkillTab.tsx` | 删除（内容吸收进能力卡片） |
| `electron/main/agents/session-append-templates.ts` | 给每段加 label（已有），用于能力卡片副标题 |
| `electron/main/services/stock-analysis-skills-service.ts` | 模板源迁移到 `resources/skill-templates/` |
| `electron/main/services/article-parser-skills-service.ts` | 模板源迁移 |
| `electron/main/services/memory/review-skill-service.ts` | 模板源迁移 |
| `electron/main/services/skill-service.ts` | listSkills 适配新的来源标记 |
| `resources/skill-templates/` | 新目录，所有内置模板源 |
| 构建脚本 | 打包 `resources/skill-templates/` |

## 错误处理 / 边界情况

- 模板源目录不存在时 `listSkillTemplates()` 返回空列表，不崩溃
- 工作区无 workspacePath 时订阅/恢复按钮禁用
- 自定义 Skill 区域处理空列表（无自定义 skill 时显示提示）
- 条件挂载工具组在无 workspace / 无 group 时仍展示（标注「当前未激活」）

## 工具描述治理

审计了全部 61 个工具描述，69% 存在约束越界。治理原则：**工具描述只保留功能性说明 + 工具行为限制**（如「候选超过 100 只自动截断」），行为规范移到提示词，但提示词**只保留警告级约束**（易错、易忘），不搬运常识。

### 记忆系统

工具描述精简为纯功能说明。提示词新增一段（2 条警告）：
```
## 记忆系统
- 只记录有长期价值的信息（稳定的偏好、重要决策、反复出现的模式），不要存一次性对话内容
- UpdateCoreProfile 是全量覆盖——调用前必须先 GetCoreProfile 拿现有内容合并后再写入
```
SaveMemory / ForgetMemory 的触发时机不约束（用户说「记住」/「忘记」就是常识）。

### Agent 协作

工具描述精简为纯功能说明。约束去向：
- CreateSession / WaitForMessage 的工作流规范已在 `MAIN_AGENT_DELEGATION_APPEND` 里，**不重复**
- SendMessage 补 1 条到 `MAIN_AGENT_DELEGATION_APPEND`：「delivery 标记仅用于正式交付，普通往来消息不要设 delivery」
- reference-tools 的使用规范加到子会话契约段（`subAgentContractFor`）：「ReadReferenceSession 读到的内容原样交回，不要臆断」
- group-tools 描述加作用域限定：ListGroupFiles / ReadGroupFile 强调「**共享区**」，避免 agent 误用为通用文件读取

### 股票分析

工具描述删除所有「使用场景」句，保留工具行为限制。工作流规范去向：
- stock-analysis SKILL.md 已有完整工作流，**不重复**
- 补 1 条到 SKILL.md「不要做」段：「用户说'银行股''医药股'等俗名时，先调 ListIndustries 查映射——分类名和俗名差异大」
- ListIndustries 描述保留命名差异事实（客观信息），去掉命令式语气

### 文章

工具描述删除使用场景句。article-parse 的行为约束（低频使用）不搬移，维持现状。

### 后台任务工具（review / category / digest / group-digest）

工具描述照常精简，约束保留在各自后台 agent 的 prompt 里，不在主会话提示词体现。

### 观察项（不实施）

- 子会话探索结果的后续复用：当前机制支持主会话对已交付子会话继续追问（SendMessage + WaitForMessage），但模型可能不知道子会话还活着。等真实场景验证后再决定是否加引导。

## 未决问题

- 能力域卡片的左右分栏在窄屏下如何降级（可能改为上下堆叠）
- 自定义 Skill 区域是否需要区分 workspace / user 来源
- 复盘 skill 和文章解析 skill 是否需要在能力卡片展示（它们是后台任务用的，不是主会话直接用的）
- 提示词段 vs Skill 混在同一个能力域左侧时，视觉上怎么区分（不同背景色？小标签？）
