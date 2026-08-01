---
date: 2026-08-01
topic: pi 主会话 Skill 加载机制 + CLAUDE.md 精简
status: draft
prev: ../2026-07/2026-07-30/pi-main-session-migration-design.md
---

# pi 主会话 Skill 加载机制 + CLAUDE.md 精简 设计

## 背景

pi 主会话迁移整体到 Step 7，会话生命周期基础已就位。当前两个突出问题：

**1. Skill 加载机制不完整**

- 现有 `electron/main/agents/pi-session/skill-loader.ts` 是手写简陋版（~100 行），硬编码只扫 `.dogear/skills/article-parser/` 和 `.dogear/skills/review/` 两个目录
- 项目级 `.claude/skills/`（7 个流程性 skill）和用户级 `~/.claude/skills/` 完全不扫
- SDK 时代靠 spawn 真实 `claude` CLI 自动发现 skill；pi 无对应机制
- pi-main-session-migration-design.md（2026-07-30）当时主动放弃了 pi-agent-core 的 `AgentHarness` 整包（捆绑 Session 数据模型），但**也漏掉了 `harness/skills.js` 这个独立模块**——可以脱离 AgentHarness 单独使用，dogear 已实现的 `ExecutionEnv` 接口（`workspace-execution-env.ts`）可直接喂给它，零成本接入

**2. CLAUDE.md 不被 pi 读取**

- SDK 通过 `settingSources: ['user','project','local']` 自动注入 cwd 下的 CLAUDE.md，pi 完全没有对应机制
- 现状：pi 主会话的 systemPrompt 几乎是空的（只有外部传入的 `config.systemPrompt` + skill 索引），用户写在 `.claude/CLAUDE.md` 上的项目规则、红线、约定完全无效
- SDK 的 systemPrompt 是 preset + append 多源拼接（session-append-templates.ts 那 6 段隐形契约），pi 不想沿用这套重的设计

## 目标

- 用 pi-agent-core 的 `loadSkills` 模块替换手写 skill-loader，扫描多个目录
- pi 主会话启动时主动读 `.claude/CLAUDE.md` + `~/.claude/CLAUDE.md` 拼进 systemPrompt
- CLAUDE.md 精简到 ~45 行（砍常识 / 评估性内容 / 细节，留约束 / 示警 / 硬决策）
- `codebase-map` 从 `.claude/rules/` 提升为 `.claude/skills/codebase-map/SKILL.md`，让 skill loader 能发现
- 预留 `conversation.mode: 'project' | 'clean'` 字段，当前只实现 `project`，`clean` 留作后续 step

## 架构

### 核心做法

**systemPrompt 极简策略**：pi 的 `systemPrompt` 字段 = CLAUDE.md 精简版（启动时 fs.readFile 一次）+ skill 索引（loadSkills 自动生成）。两段，到此为止。

明确**不学** SDK 的多源拼接：

- ❌ preset + append + settingSources 多源模板
- ❌ `session-append-templates.ts` 那 6 段隐形系统契约（REFERENCE_APPEND / groupAppend / NOTES_GUIDANCE / subAgentContract 等）全部不迁移
- ❌ persona / temp_prompt 拼接——pi 主会话第一阶段不接，留作后续 step（未来若要做，persona 作为用户消息第一条注入，不进 systemPrompt）

**Skill 加载策略**：用 pi-agent-core 的 `loadSkills(env, dirs)` 替换手写 loader。白嫖完整能力（递归扫描 / .gitignore / yaml 解析 / name 校验 / 多源来源标记 / 错误诊断聚合）。`ExecutionEnv` 接口 dogear 已在 `workspace-execution-env.ts` 实现，零成本接入。

扫描目录（顺序敏感，后到覆盖前者）：

1. `.claude/skills/`（项目级，现有 7 个流程性 skill）
2. `~/.claude/skills/`（用户级，跨项目复用）
3. `.dogear/skills/article-parser/` + `.dogear/skills/review/`（现有两个本地 skill）

### 排除的选项

| 选项 | 排除原因 |
|---|---|
| 升级到 AgentHarness 整包 | 强制 Session 数据模型，与 dogear 现有 conversation 数据模型（`conversations.json` + SDK jsonl + `conversation-tree.json`）双轨打架。**留作 pi 迁移最后阶段统一重构**。 |
| 按模块拆 N 个 skill（数据存储 / 状态管理 / Agent 开发 / IPC...） | 粒度精细但索引文本长、维护成本高；模块约定本质是 codebase-map 的一部分，单独拆冗余 |
| 1 个大 "dogear 开发约定" skill | description 要写得很宽（"任何代码修改都触发"），跟放 systemPrompt 区别不大，但多一次工具调用 |
| SDK 风格 preset + append 多源 systemPrompt | 用户明确反对；pi 的 systemPrompt 字段就一个字符串，不学 SDK 拼接 |
| 引入按消息内容 / 文件路径自动触发 rules 的机制 | pi 没机制；SDK 那套 path-based 触发是 spawn 真实 claude CLI 的产物，pi 重写代价大、收益小。接受"按需触发靠 agent 看 skill description 主观判断"。**这是 pi 迁移必然丢的能力**，但用户场景是项目内会话占多数，规则默认加载即可；少数题外话场景后续走纯净模式 |

## 模块边界

### 新增 / 修改文件

- **`electron/main/agents/pi-session/skill-loader.ts`** —— 重写：删除手写 `loadSkillIndex` / `formatSkillIndexForPrompt` / `createSkillTool`，改为薄封装 pi-agent-core 的 `loadSkills` + `formatSkillInvocation`。保留对外签名（函数名 + 入参 / 出参类型）不变，只换内部实现，避免影响 pi-session.ts 调用方。

- **`electron/main/agents/pi-session/pi-session.ts`** —— 修改：
  - `start()` 内增加 CLAUDE.md 读取逻辑（项目级 + 用户级，按存在性过滤）
  - `loadSkillIndex` 调用扩到 4 个目录
  - systemPrompt 拼装顺序：`CLAUDE.md 内容 + 用户级 CLAUDE.md（可选）+ skill 索引文本`（移除其他拼接源）

- **`.claude/skills/codebase-map/SKILL.md`** —— 新增：从 `.claude/rules/codebase-map.md` 提升而来，加 frontmatter（`name: codebase-map`，description 写"当你不清楚某个文件 / 模块在哪、要做什么时主动调用"）

- **`.claude/CLAUDE.md`** —— 修改：精简到 ~45 行（详见"CLAUDE.md 精简方案"段）

- **`types/electron-api.ts` / `electron/main/agents/task-types.ts`**（如需）—— 预留 `conversation.mode: 'project' | 'clean'` 字段，默认 `'project'`。本次只定义不消费。

### 不动文件

- `.claude/skills/brainstorming/` / `systematic-debugging/` / `staged-impl/` / `staged-execution/` / `stock-picking/` / `doc-sync/` / `shadcn/` —— 现有 7 个项目级 skill 不动，直接被新 skill loader 发现
- `electron/main/agents/pi-session/workspace-execution-env.ts` —— ExecutionEnv 实现，复用
- `electron/main/services/claude-config-service.ts` —— 现有 CLAUDE.md 读写服务（前端编辑器用），复用
- `.claude/rules/codebase-map.md` 及其他 rules 文件 —— SDK 时代遗物，本次不动，等 pi 主会话迁移收尾时统一清理

## 数据流

### 启动时 systemPrompt 拼装（项目模式）

```
PiSession.start()
  ├─ loadSettings()
  ├─ resolvePiModel()
  ├─ fs.readFile('.claude/CLAUDE.md')           ← 项目级（精简版 ~45 行）
  ├─ fs.readFile('~/.claude/CLAUDE.md')          ← 用户级（可选，失败静默）
  ├─ loadSkills(env, [
  │     '.claude/skills',
  │     '~/.claude/skills',
  │     '.dogear/skills/article-parser',
  │     '.dogear/skills/review',
  │   ])                                          ← pi-agent-core 完整扫描
  ├─ formatSkillIndexForPrompt(skills)            ← 生成 <available_skills> 索引文本
  └─ systemPrompt = [
       claudeMdContent,
       userClaudeMdContent,                       ← 可能为空
       skillIndexText,
     ].filter(Boolean).join('\n\n')
```

### Skill 工具命中（按需加载）

```
LLM 决定调用 Skill(name='codebase-map')
  └─ createSkillTool 的 handler
       ├─ 从 skillEntries 找到对应 entry
       ├─ 返回 SKILL.md 全文作为工具结果
       └─ LLM 拿到详细内容继续推理
```

## CLAUDE.md 精简方案

### 砍掉的内容

- "不要引入重复库" / "不要自行实现 SDK 已提供的功能"（常识，模型本来就不会做）
- "开发阶段不做兼容性代码"（项目哲学但偏抽象）
- "UI 交互状态用组件内 state"（细节）
- "TypeScript 配置"整段（细节，进 codebase-map skill）
- "模块化解耦原则"整段（评估性，进 codebase-map skill 让 agent 评估代码时主动调）
- "代码地图"段（已经是引用，转 skill 入口）

### 保留的内容（精简后 ~45 行）

```markdown
# Dogear 项目指南

## 项目身份
AI 驱动个人工作台（文章阅读 + 股票分析）。包管理 Bun。

## 技术栈速查
[原表格保留]

## 常用命令
bun run dev / dev:renderer / build:electron / build / dist / lint

## 硬约束
- 中文回答
- 修改前 95% 把握，否则先问
- 不写注释（WHY 非显而易见时加一行）
- 不留半成品（写完清理，不留 TODO / 空 stub）
- 单文件 / 单函数 >300 行考虑拆分
- 代码引用用 path:line 格式

## 红线
- 不绕过 tipc 直接用 ipcMain/ipcRenderer
- 不在渲染层操作文件系统，必须 IPC 调主进程
- 不用 window.confirm / prompt（用 confirm-store.ts 的 showConfirm）
- Vite 前端不用 require()（用 import()）
- Bash 命令的 RTK 包装由 hooks 自动处理

## 项目级硬决策
- 持久化用 JSON 文件（不用 SQLite），通过 getConfigDir() 获取
- Store 放 stores/，命名 xxx-store.ts；循环依赖用 await import()
- 新增 Agent 工具：文件末尾调 registerTools()；前端走 client.getRegisteredTools()
- 工具命名 mcp__{server}__{tool}；输入用 zod schema；错误返回 isError: true（不抛异常）

## 详细参考
代码地图、模块约定、流程指引走 Skill 工具加载（codebase-map / brainstorming / systematic-debugging 等）。
```

砍了 ~80% 内容。剩下全是"约束 + 示警 + 硬决策"，没有废话。

## 错误处理 / 边界情况

- **`.claude/CLAUDE.md` 不存在**：fs.readFile 失败静默跳过（项目级可能未初始化）；systemPrompt 仍有 skill 索引兜底
- **`~/.claude/CLAUDE.md` 不存在**：同上，常见情况（用户没写过用户级指令）
- **skill 目录不存在 / 为空**：loadSkills 内置处理（diagnostics 警告，不抛错）
- **SKILL.md frontmatter 缺 name/description**：loadSkills 内置 name 校验（lowercase / 长度 / 字符），不合规的 skill 进 diagnostics 不进索引
- **skill 同名冲突**：loadSkills 不去重，按目录扫描顺序后到的覆盖前者。扫描顺序固定（项目 → 用户 → 本地），项目级优先级最低，本地优先级最高。**未决**：是否需要显式去重 + 警告，见下
- **大 systemPrompt**：CLAUDE.md ~45 行 + skill 索引（每 skill 2-3 行 × ~10 个 ≈ 30 行）≈ 75 行，~3K token。可接受
- **CLAUDE.md 修改后如何生效**：现有会话用旧 systemPrompt，新会话才读新 CLAUDE.md。需要"重启 pi 会话"按钮触发 setModel 链路——pi-session.ts 的 setModel 已经支持 needsRestart，可以复用现有 IPC 链路

## 未决问题

- **skill 同名冲突策略**：是后到覆盖（loadSkills 现状）还是显式报错？建议初版接受后到覆盖，实际遇到再优化
- **persona / temp_prompt 迁移**：本次设计不覆盖。pi 主会话第一阶段不支持人设切换，留作后续 step
- **纯净会话模式（`conversation.mode === 'clean'`）**：本次设计预留字段，不实现。后续 step 处理（不读 CLAUDE.md、不带项目 skill 索引、可选少量通用 skill）
- **`codebase-map` skill 的 description 写法**：要写得让 agent 在"不知道某个文件 / 模块在哪"时主动调。初版先用 "当你不清楚某个文件/模块在哪、要做什么时主动调用"，看实际命中率再调
- **现有 `.claude/rules/` 其他文件（agent-development.md 等）**：本次不动。pi 主会话迁移收尾时统一清理（SDK 时代遗物，pi 不读）
- **跨工作区 CLAUDE.md 缓存**：CLAUDE.md 启动时读一次进 systemPrompt，工作区切换时是否需要重读？短期不优化（dogear 单工作区为主），长期如果有工作区热切换场景再做
