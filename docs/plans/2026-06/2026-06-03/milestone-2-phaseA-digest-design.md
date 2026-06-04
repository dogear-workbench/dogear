# 里程碑 2 · Phase A 实现设计：会话清洗 + 提炼闭环（A1 + A2 + A3）

> 创建日期：2026-06-03
> 上位计划：`../2026-06-02/milestone-2-memory-copilot.md`（本文件落实其 Phase A）
> 状态：✅ Phase A（A1+A2+A3）已实现并提交（2026-06-04），代码全绿（build + lint 0 error + bun:test 全通过）；运行时端到端验收待用户在真实 GUI + API key 下确认
> 范围：本轮一次性做完 A1（清洗）+ A2（提炼闭环，含三触发点）+ A3（设置页巡检）

---

## 一、本轮锁定的决策（在上位计划 8 条之外，新增的实现级决策）

| # | 决策 | 说明 |
|---|------|------|
| A | 清洗用 **TS MCP 工具**（主进程），不用 Python / 松散脚本 | 最确定，打包必跑；脚本求稳少改，迭代留给 prompt |
| B | **单个 headless query 包干**：同一 agent 跳清洗 + 出摘要 | 照 article-parser 的 `PARSE_ARTICLE` 范式 |
| C | 干净稿**内联返回**给 agent，**同时落一份留底**到磁盘 | 留底用于质量排查：差摘要时回看是清洗还是提炼出问题 |
| D | 干净稿**保留极简一行工具骨架**；**丢 thinking**；**丢子 agent(isSidechain)** | vibe-coding 里「做了什么」靠工具骨架确认 |
| E | uuid **完整保全**，不截断 | 省不了多少 token，不值得牺牲回溯可靠性 |
| F | agent 写卡用 **SaveDigest 结构化工具**，非通用 Write | frontmatter / 回溯结构由工具保证，格式不漂 |
| G | 摘要卡**不打标签**，只留会话内容（概述 + 想法/注意/决策） | 主题联动整体留给 ③，本轮不碰 |
| H | **提示词模板** → 全局单份 `<configDir>/digest-prompt.md`；**提炼模型选项** → 设置页 | 模板集中在软件目录、所有工作区共用；模型选项在 MemoryTab |
| I | 脏检查用 **JSONL 文件 mtime** 比对，非逐字解析 | 扫描期只 stat + 读 frontmatter，便宜 |
| J | digests **挂靠软件管理的工作区数据** `<configDir>/workspaces/<workspaceId>/` | 与会话索引同居、集中在软件目录、天然每工作区；不埋进用户内容文件夹 |
| K | 会话定位**复用** `getClaudeConfigDir` / `getSdkSessionsDir`（agent.ts） | 不重造路径解析；枚举经 `<configDir>/workspaces/<wsId>/conversations.json` |

---

## 二、整体数据流

```
脏检查扫描（3 触发点）
   │  发现脏会话(sessionId)
   ▼
起 DIGEST_SESSION 任务（agent-manager worker，一次性 query）
   │  挂 MCP server: dogear-memory-digest
   │  prompt = 模板文件(可编辑) + 注入 sessionId/工作区上下文
   ▼
agent 自主执行：
   ① CleanTranscript(sessionId) → 内联干净稿 + 落留底
   ② ReadExistingDigest(sessionId) → 旧摘要(若有)，对比新旧
   ③ SaveDigest({...}) → 确定性写摘要卡
   ▼
摘要卡落盘 <工作区>/.dogear/memory/digests/<sessionId>.md
   │
   ▼
A3：设置页 MemoryTab 巡检（看卡 + 回溯跳原文 + 选提炼模型）

回溯链：摘要卡条目带 uuid →(sessionId, uuid)→ 按需读那行 JSONL
```

---

## 三、A1 · 会话清洗

### 3.1 真相源定位（复用现有 helper）

- 复用 `electron/main/tipc/agent.ts` 的：
  - `getClaudeConfigDir()` → `<appDir>/.dogear/conversations`（`isPackaged` 自动适配）
  - `getSdkSessionsDir(workspacePath)` → `<configDir>/projects/<编码工作区路径>/`（`\`→`-`、`:`→`-`）
  - 这两个目前是 agent.ts 内部函数 → **抽到共享 util**（如 `electron/main/services/memory/session-paths.ts` 或复用导出），cleaner 与 agent.ts 共用。
- 单会话 JSONL：`getSdkSessionsDir(workspacePath)/<sdkSessionId>.jsonl`
- 只读，不改原 JSONL。

### 3.2 模块拆分

- `electron/main/services/memory/transcript-cleaner.ts`：纯逻辑 `cleanTranscript(sessionId)`，只读 JSONL → 返回 `CleanedTranscript`。可单测。
- 留底副作用放 MCP 工具包装层，不进纯函数。

### 3.3 去噪规则（基于实测）

**整行丢弃**：
- 非 `user|assistant` 行：`custom-title` / `queue-operation` / `attachment` / `last-prompt` / `summary` 等
- `isSidechain === true`（子 agent）
- `isMeta === true`（skill / 系统注入）

**user 行**：
- content 是字符串 → 真实发言，**留**；剥掉内嵌 `<system-reminder>` / `<command-name>` / `<command-message>` / `<local-command-stdout>` 标签块；剥完为空则整行丢
- content 是数组（`tool_result` 块）→ **丢**

**assistant 行**（content 数组逐块）：
- `text` → **留**
- `thinking` → **丢**
- `tool_use` → 压成一行骨架 `[工具名 关键参数]`，关键参数取值表：

| 工具 | 关键参数 |
|------|----------|
| Read / Edit / Write / NotebookEdit | `file_path`（basename） |
| Bash | `description`（无则 `command` 截断 60 字） |
| Grep / Glob | `pattern` |
| Skill | `skill` |
| TaskCreate | `subject` ／ TaskUpdate | `status` |
| Agent / Task | `description` |
| WebFetch | `url` |
| `mcp__x__Y` | 工具名 |
| 兜底 | 仅工具名 |

每个保留 turn 带**完整 uuid** + timestamp。

### 3.4 产物格式

```
## [user · 2026-06-02T14:23:01 · 8f3a1c2d-...完整uuid] 用户原话……

## [assistant · 2026-06-02T14:24:10 · d4e15678-...完整uuid] 助手文字回复……
[Edit query-based-session.ts]
[Bash 编译主进程]
```

```ts
interface CleanedTranscript {
  sessionId: string
  transcript: string       // 上面的文本
  turnCount: number        // 保留的 user+assistant 轮数
  lastTimestamp: string    // 末条消息 timestamp（参考）
  sourceMtime: number      // JSONL 文件 mtimeMs（脏检查依据）
  stats: { originalBytes: number; cleanedChars: number; ratio: number }
}
```

---

## 四、A2 · 提炼闭环

### 4.1 起 agent

- 新增 `TaskType.DIGEST_SESSION` + `DigestSessionPayload { sessionId, workspacePath, configDir, ... }`
- agent-worker 新增 `handleDigestSessionTask`，照 `handleParseArticleTask` 写：
  - 一次性 `query()`，`permissionMode: 'dontAsk'`
  - 模型 / effort 从「提炼模型」配置取（决策 H，缺省回退 baseConfig）
  - 挂 MCP server `dogear-memory-digest`
  - allowedTools 白名单：仅三个 digest MCP 工具
- 由脏检查触发（见 4.5），不占常驻进程。

### 4.2 MCP 工具（`dogear-memory-digest` server）

- `CleanTranscript(sessionId)` → 内联干净稿（A1）+ 落留底到 `digests/_cleaned/<sessionId>.md`
- `ReadExistingDigest(sessionId)` → 读旧摘要正文（无则空），供模型对比新旧决定重写/增补
- `SaveDigest({ sessionId, title, topics, summary, items })` → 确定性写卡：
  - frontmatter / 回溯结构由工具拼装，agent 只填内容字段
  - `items`：`[{ kind: '决策'|'想法'|'注意'|'搁置', text, uuid }]`

### 4.3 摘要卡结构

```markdown
---
sessionId: <完整uuid>
conversationId: <反查 conversations.json，可空>
title: 一句话标题
createdAt: <iso>
sourceMtime: <JSONL mtimeMs>   # 脏检查依据
turnCount: N
---

## 概述
这次会话做了 N 件事：……

## 想法 / 注意 / 决策
- [决策] …… ⟶ <uuid>
- [想法] …… ⟶ <uuid>
- [搁置] …… ⟶ <uuid>
```

（决策 G：不写 topics 标签。）

### 4.4 存储（决策 J：挂靠软件管理的工作区数据）

- 摘要卡：`<configDir>/workspaces/<workspaceId>/digests/<sessionId>.md`，重提炼**覆盖**
- 留底干净稿：`<configDir>/workspaces/<workspaceId>/digests/_cleaned/<sessionId>.md`
- 提示词模板：`<configDir>/digest-prompt.md`（**全局单份**），首次缺失时由代码默认模板**播种**，之后用户可改
- 这些都在软件管理目录（与 `conversations.json` 同居 `<configDir>/workspaces/<workspaceId>/`），不进用户内容文件夹，无需改 `.gitignore`
- 里程碑1 的 `<工作区>/.dogear/memory/` 本轮**不动**

### 4.5 脏检查 + 三触发点（决策 4）

- **脏条件**：摘要卡不存在 `||` `frontmatter.sourceMtime !== JSONL.mtimeMs`
- **扫描**：读 `<configDir>/workspaces/<wsId>/conversations.json` 拿该工作区所有 `sdkSessionId` → 用工作区 `path` 经 `getSdkSessionsDir` 定位 JSONL → 逐个 stat + 读卡 frontmatter，便宜
- **三触发点**：
  1. 开软件扫一遍（启动后台扫描；存量 ~30 会话天然命中，完成 backfill）
  2. 晚上定时（主进程内定时器，仅软件开着时；缺省本地 03:xx，软件关即停）
  3. 手动关会话时只扫这一个（conversation 关闭 hook）
- 软件关闭即停，不留后台守护进程。

---

## 五、A3 · 设置页巡检

- MemoryTab 新增「会话摘要」区：
  - 摘要卡列表（标题 / topics / 时间），点开看正文
  - 条目回溯链接：点 uuid 跳到原会话对应消息（复用现有消息定位能力）
  - **提炼模型下拉**（从已配置 model profile 选，缺省便宜模型）→ 写 settings

---

## 六、跨阶段约束（沿用上位计划第五节）

- 不独立后台服务、不切框架、不引向量库
- 不复制原始会话进记忆层——只存提炼产物 + 留底 + 回溯指针
- 文件 IO 沿用 `safe-json`；IPC 走 tipc；新增文件 <300 行拆分
- 系统 B（SDK auto-memory）不依赖、不修改

---

## 七、实现顺序（TDD）

1. A1 `transcript-cleaner.ts` 纯函数 + vitest（真实 fixture，断言去噪 + 压缩比）
2. A1 `CleanTranscript` MCP 工具（内联返回 + 留底）
3. A2 `SaveDigest` / `ReadExistingDigest` MCP 工具 + 卡结构
4. A2 `DIGEST_SESSION` 任务 + `handleDigestSessionTask` + 默认提示词模板播种
5. A2 脏检查 + 三触发点接线
6. A3 MemoryTab 巡检视图 + 提炼模型下拉
7. 端到端：对真实会话跑一遍，人看留底 + 摘要卡质量

---

## 修订历史

- 2026-06-03：初版。落实 Phase A 的 A1+A2+A3 完整实现设计，锁定 11 条实现级决策（A–K）。
  - 复核 history 加载链路后修正：digests 挂靠 `<configDir>/workspaces/<wsId>/`（决策 J），路径复用 `getClaudeConfigDir`/`getSdkSessionsDir`（决策 K），摘要卡不打标签（决策 G 调整），提示词模板全局单份（决策 H 调整）。
</content>
</invoke>
