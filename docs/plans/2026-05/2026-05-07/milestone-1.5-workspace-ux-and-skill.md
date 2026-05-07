# 里程碑 1.5：工作区交互重构 + Skill 瘦身

> 创建日期：2026-05-07
> 状态：设计中（待评审 → 实施）
> 路线图位置：`../2026-05-05/advanced-capabilities-roadmap.md` 的里程碑 1.5
> 前置条件：里程碑 1 已完成（2026-05-06 联调通过）
> 预估工作量：8-10 天（分两个并行模块 A/B）

---

## 一、动机和目标

### 为什么现在做

里程碑 1 联调完成后，用户开始把 dogear 作为**日常开发工具**使用（"在 dogear 里聊 dogear 开发"，VSCode 退化为编辑器）。这个定位转变立刻暴露两个核心痛点：

**痛点 1：交互模型不匹配日常使用**
- 开发环境和生产环境的 Electron 单实例锁冲突，同时运行时后启动的无法被唤醒
- `clearWorkspace()` 会主动关闭所有活跃 `QueryBasedSession`，切换工作区等于销毁会话
- 用户没法"代码工作区跑着任务，切到股票工作区干点别的"

**痛点 2：上下文成本过高，注意力分散**
- 全局 `~/.claude/CLAUDE.md`（RTK 工具集 ~200 行）对 dogear 大部分场景不相关
- 项目 `.claude/CLAUDE.md` 有大量"核心文件功能索引"（~300 行），是给人看的文档，agent 用 Glob/Grep 能自己探索
- 18 个自定义 MCP 工具全量注入（股票分析 7 个、书籍 5 个、文章 2 个、股票基础 6 个），工具 schema 占用上下文
- 单次"修改某个 UI 组件"的任务，90% 的上下文都是冗余

### 目标

两个并行模块：

**模块 A：工作区交互模型重构**
- 从"工作区为主体"→"会话为主体"
- Tab 栏承载活跃会话，后端 session 不随工作区切换销毁
- 工作区切换用 Command 浮窗，瞬时切换
- 工作区级 CLAUDE.md 编辑入口外移到主界面
- 开发/生产允许同时运行

**模块 B：规则和工具瘦身**
- 用户级 CLAUDE.md 瘦身，只留通用协作偏好
- 项目级 CLAUDE.md 砍文档性部分，保留约定性部分
- 低频重计算工具转 Skill + 脚本模式
- Skill 启用即授权（自动进 allowedTools）

两个模块互相独立，可以并行实施。

### 1.5 不做的事

- ❌ 左侧对话列表的"最近优先 + 老对话折叠"排序（后续独立优化）
- ❌ 跨工作区的会话或记忆关联（后续里程碑讨论）
- ❌ 独立会话窗口内部的 Tab 化（保持单会话锁定）
- ❌ Sub-Agent（里程碑 5）
- ❌ 做梦系统（里程碑 2）

---

## 二、模块 A：工作区交互模型重构

### A.1 新世界观

**核心转变**：从"工作区为主体"→"会话为主体"。

```
┌──────────────────────────────────────────────────────────────────┐
│ 顶部导航栏                                                         │
│                                                                  │
│  [Dogear] [📁 dogear-work ⬇] [📋 工作区规则]          ... [⚙️ 设置] │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Tab 栏                                                            │
│                                                                  │
│  [💬 股票分析 🟠][💬 代码讨论][💬 读《XXX》 🔵][+]                   │
│                                                                  │
├──────┬──────────────────────────┬─────────────────────────────┤
│      │                          │                             │
│ 对话 │   聊天区                  │   工具轨道/文件预览           │
│ 列表 │                          │                             │
│ ＋   │                          │                             │
│ 文件 │                          │                             │
│ 树   │                          │                             │
│ (可  │                          │                             │
│ 收起)│                          │                             │
└──────┴──────────────────────────┴─────────────────────────────┘
```

### A.2 核心交互规则

**Tab 栏**
- Tab = **活跃会话**（建立了 Query 实例，不管跑没跑 agent）
- 点击 Tab → 切换聚焦 → 主界面左右栏根据该 Tab 所属工作区切换
- Tab 上的 StatusPulse 指示状态：蓝色=等待确认，橙色=运行中
- Tab 右上角 × → 释放 Query 连接，但不删对话数据
- 上限 **10 个活跃 Tab**，超了提示用户关闭一些

**对话列表（左侧）**
- 显示**当前聚焦会话所属工作区**的对话列表（或用户手动选中的工作区）
- 点击列表里的对话 → resume 建立 Query 连接 → 进 Tab → 激活聚焦
- 左侧列表整体可折叠（顺带需求）

**工作区切换（顶部下拉按钮）**
- 点击触发 shadcn **Command 组件**浮窗
- 列出所有工作区，点击即切换
- 底部 "[+] 添加工作区"，点击选文件夹 → 创建 → 切换过去
- 切换到新工作区后进入"无聚焦会话"状态（Tab 栏空，中间显示空态）
- **手动管理入口**（删除工作区、恢复孤儿、环境检查）放在设置页，不在浮窗里

**工作区规则按钮（顶部导航栏）**
- 点击弹 Dialog
- 编辑当前工作区的 `.claude/CLAUDE.md`（项目级规则）
- 简单 textarea 编辑器 + 保存按钮 + dirty 检测
- 原 WorkspaceConfigTab 里的 CLAUDE.md 编辑器功能迁移过来

**无聚焦会话状态**
- Tab 栏空
- 左侧对话列表+文件树正常显示（当前工作区的）
- 中间显示空态："选择一个对话开始，或 + 新建"
- 和"首次打开+已有工作区"时一样

**首次打开（零工作区）**
- 全屏引导卡片，居中，只有"创建你的第一个工作区"按钮
- 点击 → 文件夹选择 → 创建 → 进正常工作流

### A.3 关闭/删除语义

| 动作 | 效果 | UI 位置 |
|------|------|---------|
| 关闭 Tab | 释放 Query 连接，不删对话 | Tab 右上角 × |
| 删除对话 | 删除元数据 + SDK JSONL 历史，不可恢复 | 对话列表右键菜单 |
| 关闭独立会话窗口 | 和关闭 Tab 相同，释放连接 | 窗口关闭按钮 |
| 删除工作区 | 删除工作区全部数据（对话/书籍/记忆） | 设置页工作区管理 |

### A.4 独立会话窗口（保持现状）

- 独立窗口 = 单会话锁定（保持现有设计）
- 主窗口 Tab 右键菜单新增"弹出到独立窗口"
- 独立窗口内部：三栏布局保持（对话列表供浏览 + 聊天区锁定 + 文件树）
- 独立窗口**不引入 Tab 栏**，保持"专注工具"的定位

### A.5 全局入口按钮

顶部导航栏保留以下**不随工作区切换变化**的全局入口：
- 设置（全屏 overlay）
- Agent 监控（独立窗口）
- 自选股（独立窗口）
- 微信（Dialog）

新增：
- **工作区规则**（Dialog，编辑当前工作区 CLAUDE.md）

### A.6 Tab 持久化

**决策：不持久化**。
- 关闭应用后，Tab 栏清空
- 重新打开进入上次的默认工作区，显示"无聚焦会话"状态
- 用户从对话列表选择对话激活

原因：启动快、简单、符合"Tab = 活跃连接"的语义。

---

## 三、模块 A 实施细节

### A.7 后端改动

**最小改动**：`stores/workspace-store.ts` 的 `clearWorkspace()` 不再 closeAll。

```typescript
// 改前
clearWorkspace: async () => {
  // 关闭所有活跃 session
  const tabs = useSessionStore.getState().tabs;
  for (const tab of tabs) {
    if (tab.sessionId) {
      await client.closeQueryBasedSession({ sessionId: tab.sessionId });
    }
  }
  // ...其他 reset
}

// 改后
clearWorkspace: async () => {
  // session 继续在后端运行，不关闭
  // 只重置视图相关 store 到当前工作区的初始状态
  // 或者进入"无聚焦" 状态
}
```

**新增会话上限检查**：`electron/main/agents/query-based-session.ts` 的 `QueryBasedSessionManager` 加一个 `MAX_ACTIVE_SESSIONS = 10` 常量和 `getActiveCount()` 方法。创建新 session 前检查，超过则返回错误给前端提示。

**单实例锁 appUserModelId 区分**：`electron/main/index.ts`

```typescript
const isDev = process.env.NODE_ENV === 'development';
app.setAppUserModelId(isDev ? 'dogear-dev' : 'dogear');
// 这样 dev 和 prod 的 requestSingleInstanceLock 互相独立
```

### A.8 状态层改造（Store 层的 workspaceId 分片）

**核心问题**：当前 conversation-store、article-store、reference-store 等都是单例，只存"当前工作区"的状态。多工作区并存时会互相覆盖。

**路径 C 改造方案**（分片但一次只展示一个）：

```typescript
// stores/conversation-store.ts（改造示意）
interface ConversationStore {
  // 原：conversations: Conversation[]
  // 改：按 workspaceId 分片
  byWorkspace: Record<string, {
    conversations: Conversation[]
    selectedId: string | null
    conversationTree: ConversationTree
    // ...其他 per-workspace 状态
  }>

  // activeWorkspaceId 由 workspace-store 驱动
  // 组件通过 selector 只读当前激活工作区的分片
}
```

**实施要点**：
- 受影响 store：`conversation-store`、`article-store`、`reference-store`、`analysis-store`、`workspace-store`（files/selectedFile 部分）
- 不受影响 store：`settings-store`、`ui-store`、`confirm-store`、`slash-command-store`、`stock-store`（都是全局或独立窗口）
- `session-store` 特殊：Tab 栏是全局的，但每个 Tab 带 `workspaceId` 属性
- 所有组件的选择器改造：`useConversationStore(s => s.conversations)` → `useActiveConversations()` 包装 hook

**折中考虑**：如果改造量太大，可以做**降级版**——仍然单例 store，但切换工作区时不 reset，只更新 `workspace` 字段，同时 `loadConversations` 重新拉数据。坏处是切回工作区时状态（选中对话、文件选中等）会丢失。优先做完整版，如果卡住退化。

### A.9 新组件清单

| 组件 | 位置 | 职责 |
|------|------|------|
| `WorkspaceTabBar.tsx` | `components/` | 顶部 Tab 栏 |
| `WorkspaceSwitcherPopover.tsx` | `components/` | Command 浮窗切换器 |
| `WorkspaceRuleDialog.tsx` | `components/` | 工作区规则编辑 Dialog |
| `EmptyFocusState.tsx` | `components/` | 无聚焦会话空态视图 |
| `WelcomeFirstRun.tsx` | `components/` | 零工作区首次打开引导 |

### A.10 改造的现有文件

| 文件 | 改动 |
|------|------|
| `electron/main/index.ts` | 加 appUserModelId 区分 |
| `electron/main/agents/query-based-session.ts` | 加 MAX_ACTIVE_SESSIONS 检查 |
| `stores/workspace-store.ts` | 移除 clearWorkspace 的 closeAll |
| `stores/conversation-store.ts` | 分片改造 |
| `stores/article-store.ts` | 分片改造 |
| `stores/reference-store.ts` | 分片改造 |
| `stores/analysis-store.ts` | 分片改造 |
| `stores/session-store.ts` | Tab 加 workspaceId 字段 |
| `app/page.tsx` | 重构布局：加 Tab 栏、顶部规则按钮、空态切换逻辑 |
| `app/settings/WorkspaceConfigTab.tsx` | 移除 CLAUDE.md 编辑器（迁移到 WorkspaceRuleDialog） |
| `app/settings/page.tsx` | 新增"工作区管理" Tab |
| `components/workspace-selector.tsx` | 废弃或降级为欢迎页（首次打开）|

### A.11 设置页新增：工作区管理 Tab

**内容**：
- 完整工作区列表（含元数据：创建时间、对话数、文件数）
- 删除工作区（二次确认）
- 恢复孤儿工作区（从旧数据导入）— 原 WorkspaceSelector 的功能迁移
- 环境依赖检查（Python / 包依赖）— 原 WorkspaceSelector 的功能迁移

---

## 四、模块 B：规则和工具瘦身

### B.1 CLAUDE.md 瘦身

**用户级 `~/.claude/CLAUDE.md`**

**当前内容**：~200 行 RTK 工具集描述。

**改造为**：只保留通用协作偏好（约 30-50 行）。草稿：

```markdown
# 通用协作偏好

## 交流
- 使用中文回答
- 必要的地方添加注释，避免无意义的注释
- 代码引用用 `path/file.ts:line` 格式方便跳转

## 开发方式
- 偏好先规划再实现（brainstorming → plan → implement）
- 有 95% 以上把握再修改代码，拿不准先问
- 开发阶段不做兼容性代码（不保留废弃字段、不加迁移兼容层）

## 工具使用
- 优先使用专用工具（Read/Edit/Grep/Glob）而非 Bash
- 并行调用独立的工具以提升效率
```

**RTK 工具集的处理**：
- 不在 `~/.claude/CLAUDE.md` 里激活（取消全局默认引入）
- 需要时通过单独的 skill 形式引入（或在具体工作区的 CLAUDE.md 里选择性提到）
- 这样 RTK 不会污染所有 dogear 之外的项目上下文

**编辑入口**：设置页新增"全局规则" Tab（或放在现有 AI 行为 Tab），编辑 `~/.claude/CLAUDE.md`。提示文案说明"核心协作偏好，一般不会大改"。

**项目级 `.claude/CLAUDE.md`（工作区 CLAUDE.md）**

**当前内容**：~300 行，包括项目指南、技术栈、项目结构、核心文件功能索引、关键开发约定、禁止事项。

**改造为**：
- **保留**：基本规则、技术栈总览、关键开发约定、禁止事项、模块化与解耦原则（约 100-120 行）
- **移出**：详细的"核心文件功能索引"部分（当前约 150 行）
  - 新建 `docs/codebase-map.md`，把文件索引搬过去
  - agent 需要时通过 Glob/Grep 自己探索，或 Read 这个 map 文件
  - 保留一个 summary 段落在 CLAUDE.md 里："详细文件索引见 docs/codebase-map.md"

**编辑入口**：顶部导航栏"工作区规则"按钮 → WorkspaceRuleDialog（见 A.9）

### B.2 工具归属重新划分

当前自定义 MCP 工具 18 个，划分如下：

**保留为 MCP（高频基础工具，始终注册）**

| 工具 | 所属 | 理由 |
|------|------|------|
| RecallMemory | memory-tools | 每个会话都可能用，里程碑 1 已注册 |
| SaveMemory | memory-tools | 同上 |
| ForgetMemory | memory-tools | 同上 |
| SearchInChapters | book-qa-tools | 书籍问答场景的核心 |
| AnswerQuestion | book-qa-tools | 同上 |
| SearchStock | stock-tools | 股票场景的高频入口 |
| GetStockQuote | stock-tools | 看盘场景高频 |
| GetWatchlist | stock-tools | 看盘场景高频 |
| GetKLineData | stock-tools | 看盘场景高频 |
| ReadArticle | article-tools | 文章场景高频 |
| ListArticles | article-tools | 文章场景高频 |

**转为 Skill + 脚本（低频重计算工具，按需激活）**

| 当前工具 | 新归属 Skill | 脚本形态 |
|----------|-------------|---------|
| CalcIndicators | `stock-analysis` Skill | Python 脚本（已有） |
| ScreenStocks | `stock-analysis` Skill | Python 脚本（已有） |
| GetFinancials | `stock-analysis` Skill | Python 脚本（已有） |
| CompareIndustry | `stock-analysis` Skill | Python 脚本（已有） |
| DetectSignals | `stock-analysis` Skill | Python 脚本（已有） |
| EvalFormula | `stock-analysis` Skill | Python 脚本（已有） |
| SimpleBacktest | `stock-analysis` Skill | Python 脚本（已有） |
| SaveAnalysis | `book-analysis` Skill | TypeScript 脚本 |
| SaveChapterAnalysis | `book-analysis` Skill | TypeScript 脚本 |
| MarkComplete | `book-analysis` Skill | TypeScript 脚本 |
| ModifyWatchlist | 考虑保留 MCP | 增删自选股是中频操作，边界情况 |
| GetTimeline | 考虑保留 MCP | 看盘场景会用到 |

（ModifyWatchlist 和 GetTimeline 的归属待实施时二次评估）

### B.3 Skill 目录结构

**工作区级 Skill**（`<workspace>/.claude/skills/`）

```
<workspace>/.claude/skills/
├── stock-analysis/
│   ├── SKILL.md             # description + 触发场景 + 使用指令
│   └── scripts/
│       ├── calc_indicators.py
│       ├── screen.py
│       ├── financials.py
│       └── ...
├── book-analysis/
│   ├── SKILL.md
│   └── scripts/
│       └── ...
└── article-parser/
    ├── SKILL.md
    └── scripts/
        └── ...
```

**用户级 Skill**（`~/.claude/skills/`）：暂不使用，未来可放跨项目通用 Skill。

### B.4 SKILL.md 格式示例

```markdown
---
name: stock-analysis
description: 股票技术指标计算、条件筛选、财务分析、技术信号检测、简单回测。用户询问"筛选高 ROE 股票"、"这只股票的 MACD 金叉情况"、"回测某策略"等场景使用。
allowed-tools:
  - Bash(python scripts/*.py:*)
---

# 股票分析技能

## 何时使用

- 用户要求筛选股票（"帮我找出 PE < 20 且 ROE > 15% 的银行股"）
- 用户要求计算技术指标（"茅台的 MACD 现在什么状态"）
- 用户要求检测技术信号（"今天有哪些金叉股票"）
- 用户要求简单回测（"MACD 金叉买入策略近一年收益如何"）

## 可用脚本

### calc_indicators.py
计算指定股票的技术指标。用法：
```bash
python scripts/calc_indicators.py --code 600519 --indicators MA,MACD,RSI --period 60
```
返回 JSON：{"MA": [...], "MACD": [...], ...}

### screen.py
全市场条件筛选。用法：
```bash
python scripts/screen.py --filters '{"pe": "<20", "roe": ">15"}'
```
返回 JSON：[{"code": "600036", "name": "招商银行", ...}, ...]

（其他脚本类似）

## 输出风格

筛选/计算结果返回后，用表格形式展示关键字段，突出符合条件的股票。
```

### B.5 Skill 启用和权限

**用户控制面板**：设置页新增"Skill 管理" Tab。

- 列出工作区可用的 Skill（扫描 `.claude/skills/` 目录）
- 每个 Skill 有开关，默认未启用
- 启用后：
  - Skill 的 `allowed-tools` 声明自动合并进会话的 `allowedTools`
  - Skill 的 description 进 system prompt（让 agent 知道它存在）
  - 不触发运行时权限询问

**会话启动流程**（新）：
```
1. 读规则层（CLAUDE.md 三级）
2. 读记忆层（core-profile）
3. 读工作区启用的 Skill 列表
   → 合并 allowed-tools → allowedTools
   → 把 Skill description 加进 system prompt
4. 注册基础工具（MCP）
5. 启动 query()
```

### B.6 脚本迁移策略

**股票分析（核心改造）**：
- 现有 Python Bridge（`python-bridge.ts`）保留——Skill 的脚本通过它调用，避免每次启动 Python
- Python 脚本文件位置：`<dogear-root>/python/core/*.py`（已有），新增 `<dogear-root>/python/skills/stock-analysis/*.py` 作为 Skill 入口点（薄包装，调用 core 模块）
- Skill 里的脚本路径：符号链接或在 `.claude/skills/stock-analysis/scripts/` 下放薄包装脚本
- 每个 MCP 工具 handler（`stock-analysis-tools.ts` 里的）对应一个包装脚本

**书籍分析**：改造量类似，工具数量少

**文章解析**：最轻，可以第一个迁移试水

### B.7 旧 MCP 工具的处置

转 Skill 后，原 `electron/main/agents/tools/stock-analysis-tools.ts` 等文件**不删除**，而是**标记为 deprecated**并停止注册：
- 在 `tool-registry.ts` 注释掉这些工具的 register 调用
- 代码文件保留，方便 rollback 或参考

**实施验证**后（比如跑一两周没问题）再彻底删除文件。

---

## 五、实施步骤

### Phase 1：快速修复（0.5 天）

- [ ] **修复单实例锁**
  - `electron/main/index.ts` 加 `app.setAppUserModelId(isDev ? 'dogear-dev' : 'dogear')`
  - 构建打包版本，验证 dev 和 prod 可以同时运行

### Phase 2：模块 A 工作区交互重构（5-6 天）

- [ ] **Step A2.1**：后端会话保留（0.5 天）
  - 修改 `workspace-store.ts` 的 `clearWorkspace`，移除 closeAll 逻辑
  - `QueryBasedSessionManager` 新增 `MAX_ACTIVE_SESSIONS = 10` 和上限检查
  - 测试：手动切换工作区，会话继续存活

- [ ] **Step A2.2**：Store 分片改造（1.5-2 天）
  - `conversation-store`、`article-store`、`reference-store`、`analysis-store` 引入 `byWorkspace` 分片
  - 改造所有选择器为 `useActive*` 形式
  - `session-store` 的 Tab 加 `workspaceId` 字段
  - 测试：在两个工作区分别建对话，切换后状态不丢失

- [ ] **Step A2.3**：Tab 栏组件（1 天）
  - 新建 `WorkspaceTabBar.tsx`
  - Tab 点击切换聚焦 → 触发工作区切换（读 tab.workspaceId）
  - Tab × 按钮释放 session（调 `closeQueryBasedSession`）
  - 上限 10 的提示 UI

- [ ] **Step A2.4**：Command 浮窗切换器 + 首次打开引导（1 天）
  - 新建 `WorkspaceSwitcherPopover.tsx`（用 shadcn Command）
  - 顶部导航栏的工作区名改为可点击触发浮窗
  - 浮窗包含列表 + "添加工作区"
  - 新建 `WelcomeFirstRun.tsx` 零工作区引导卡片
  - 废弃或降级 `WorkspaceSelector`

- [ ] **Step A2.5**：空态和主界面布局（1 天）
  - 新建 `EmptyFocusState.tsx`
  - `app/page.tsx` 重构：根据 `activeTab` 有无 决定显示空态还是三栏
  - 左侧对话列表/文件树折叠按钮

- [ ] **Step A2.6**：工作区规则 Dialog（0.5 天）
  - 新建 `WorkspaceRuleDialog.tsx`（基于 shadcn Dialog）
  - 顶部导航栏新增"工作区规则"按钮
  - 迁移 WorkspaceConfigTab 的 CLAUDE.md 编辑器逻辑

- [ ] **Step A2.7**：设置页工作区管理 Tab（0.5 天）
  - 新建 `WorkspaceManagementTab.tsx`
  - 迁移原 WorkspaceSelector 的"孤儿恢复"、"环境检查"功能
  - 工作区列表 + 删除

- [ ] **Step A2.8**：独立会话窗口右键菜单（0.5 天）
  - Tab 右键菜单新增"弹出到独立窗口"
  - 确认独立窗口的三栏逻辑在新架构下仍然工作

- [ ] **Step A2.9**：联调和 bug 修复（1 天）

### Phase 3：模块 B Skill 瘦身（3-4 天）

可以和 Phase 2 部分并行（比如 Step B3.1 可以在 A 实施过程中穿插做）。

- [ ] **Step B3.1**：CLAUDE.md 瘦身（0.5 天）
  - 写新版 `~/.claude/CLAUDE.md`（通用协作偏好）
  - 写新版 `.claude/CLAUDE.md`（dogear 项目规则，砍掉文件索引）
  - 把原文件索引迁移到 `docs/codebase-map.md`
  - 全局规则编辑入口：设置页 AI 行为 Tab 加一个"用户级规则"卡片

- [ ] **Step B3.2**：Skill 目录和首个 Skill（1 天）
  - 建立 `.claude/skills/article-parser/` 目录（先从最轻的开始）
  - 写 SKILL.md + scripts/ 薄包装
  - 在 `tool-registry.ts` 注释掉原文章工具的 MCP 注册
  - 测试：agent 能识别 Skill 并调用脚本

- [ ] **Step B3.3**：股票分析 Skill 迁移（1.5 天）
  - 建立 `.claude/skills/stock-analysis/` 目录
  - 写 SKILL.md，包含 7 个脚本的 description 和用法
  - scripts/ 下放薄包装脚本，调用已有 `python/core/` 模块
  - 通过 Python Bridge 复用常驻进程
  - 注释掉原 stock-analysis-tools.ts 的 MCP 注册
  - 端到端测试：让 agent 做一次筛选

- [ ] **Step B3.4**：书籍分析 Skill 迁移（0.5 天）
  - 类似操作

- [ ] **Step B3.5**：Skill 管理 Tab（0.5 天）
  - 设置页新增"Skill 管理" Tab
  - 列出工作区可用 Skill + 启用开关
  - 启用的 Skill 的 allowed-tools 合并进 allowedTools（后端会话启动时读取）

---

## 六、风险和兜底

| 风险 | 可能性 | 影响 | 兜底 |
|------|-------|------|------|
| Store 分片改造牵连太多组件 | 高 | Phase 2 工期翻倍 | 降级为单例 + 每次切换重新 loadConversations（状态会丢失但功能可用） |
| Tab 栏切换工作区的 UX 反直觉（用户不习惯） | 中 | 需要调整或提供传统模式 | 提供设置开关"关闭多工作区模式" |
| 活跃会话 10 个不够用 | 中 | 用户频繁被提示 | 上限改为配置项 |
| Skill 的脚本路径在不同操作系统表现不一致 | 中 | 股票分析在 Windows 跑不起来 | 先在 Windows 上完整测试再推 |
| SKILL.md description 写不好，agent 不会激活 | 中 | Skill 功能失效 | 在真实对话中多测试，迭代 description |
| Python Bridge 进程挂掉，Skill 调用 Python 失败 | 低 | 错误处理兜底 | 保留 bridge 健康检查 + 自动重启 |
| 工作区删除误操作 | 低 | 数据丢失 | 二次确认 + 保留 trash（删到 `.dogear-trash/` 而非直接 rm） |

---

## 七、评审检查单（实施前自查）

- [ ] 所有新增组件 <300 行（超了要拆）
- [ ] Tab 栏组件独立不耦合其他业务（能单独测试）
- [ ] Store 分片后选择器性能正常（多个工作区状态不会全量 rerender）
- [ ] 单实例锁在 Windows 上验证过（macOS/Linux 后续再测）
- [ ] 开发/生产同时运行互不污染数据（`.dogear` vs `AppData/.../dogear`）
- [ ] 活跃会话上限的提示文案友好
- [ ] 工作区规则 Dialog 不能阻塞主界面（可随时 × 关闭）
- [ ] Skill 启用 → 工具自动允许的逻辑在不同权限模式下都正常（default / acceptEdits / bypassPermissions）
- [ ] 原 MCP 工具切换 Skill 时，历史会话 resume 不会因为工具消失而崩溃

---

## 八、里程碑 1.5 完成后的状态

### 用户体感
- 可以同时开发和使用 dogear，互不打架
- 切换工作区瞬时完成，会话保持运行
- 顶部随时能编辑当前工作区规则
- 设置页有完整的工作区管理、Skill 管理

### 技术收益
- system prompt 从 ~10k+ token 降到 ~3-4k token（估算）
- 每个会话加载的工具 schema 数从 18 个降到 ~6-8 个 + 按需激活
- 主会话上下文更聚焦，agent 表现预期提升

### 为后续里程碑准备了什么
- 里程碑 2（做梦系统）：可以安心在后台创建 sub-session 跑，不受主会话干扰
- 里程碑 5（Sub-Agent）：sub-agent 的工具白名单机制 = Skill 的 allowed-tools 延伸
- 里程碑 6（Teams）：多 agent 并存的基础设施已经就绪

---

## 九、修订历史

- 2026-05-07：初版。基于 2026-05-05 ~ 2026-05-07 的三轮讨论产出，整合工作区交互重构 + CLAUDE.md/工具瘦身 + 单实例锁修复三个主题。
