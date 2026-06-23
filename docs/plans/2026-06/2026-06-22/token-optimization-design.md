# Token 优化方案设计

## 背景

dogear 使用 Claude Agent SDK 与 Claude API 交互（API key 计费模式），每个会话累积的 token 成本由几个因素叠加：

1. **system prompt 占比大**：CLAUDE.md（含约 80 行 RTK 规则段）+ codebase-map + auto-memory MEMORY.md + skill 列表 + 工具 schema，常驻不变即"白付一次写缓存"
2. **缓存命中率不高**：API key 模式默认 5min TTL，长讨论场景里思考间隔常超 5 分钟，缓存失效后整段前缀重写（按 1.25x base 计费）
3. **重复工具调用**：Read 同一文件可能重复发生（原因未明：可能是 compact 后丢失、可能是大文件首次截断、可能是模型策略性确认）
4. **Bash 命令未压缩**：RTK 项目在 Windows 上未提供自动改写 hook，靠 CLAUDE.md 规则段引导模型加 `rtk` 前缀，模型不一定遵守

**关键认知**：

- 上下文（messages）≠ 提示缓存（prompt cache）。缓存失效不影响模型看到内容，只影响计费
- 5min 缓存命中会续期，所以高速循环场景 5min 比 1h 更划算
- 长讨论 / 思考间隔 > 5 分钟的场景，1h 缓存（2x base 写入）比反复重写 5min（1.25x base × N 次）更划算

## 目标

1. **下线 CLAUDE.md 中的 RTK 规则段**（节省常驻 system token + 提高缓存稳定性）
2. **建立缓存策略的可控性**（按会话类型选择 5min / 1h）
3. **细化 usage 观察维度**，为后续优化决策提供数据基础
4. **大文件 Read 默认截断**，避免一口气吞超大文件

## 架构

### 整体策略：Hook 驱动 + 数据驱动

- **Hook 驱动**：能用 Claude Code hook 解决的，不靠 prompt 引导（确定性强、可关闭、不占 system token）
- **数据驱动**：拿不准的优化（如"重读文件是否真的高频"），先加观测维度，跑数据再决定是否做拦截

### 排除的方案及原因

- ❌ **WSL 跨边界转发 RTK**：路径转换 + WSL 启动延迟，不值得
- ❌ **Claude Code 整个迁到 WSL**：dogear 是 Electron 项目，开发栈迁移代价过大
- ❌ **PreToolUse hook deny 重复 Read**：不如 `updatedInput` 改成最小读取 + additionalContext 提醒来得优雅
- ❌ **per-request 切换 cachePolicy**：`ENABLE_PROMPT_CACHING_1H` 是 SDK 启动 env，无法 per-request 切换
- ❌ **盲目做 Read 去重 hook**：可能是过早优化，先观察数据

## Phase 1：RTK Hook 自动化（独立先做）

### 模块边界

- 新增 `.claude/hooks/rtk-rewrite.ps1`（PowerShell 脚本）
- 修改 `.claude/settings.json`（注册 PreToolUse hook）
- 修改 `.claude/CLAUDE.md`（删除 RTK 整段，留一行说明 "Bash 命令的 RTK 包装由 hook 自动处理"）

### 数据流

```
模型发出 Bash 调用 → PreToolUse 触发 → rtk-rewrite.ps1 接收 JSON：
  - 解析 tool_input.command
  - 按 && / | / ; 拆分子命令
  - 每段子命令检查：是否在 RTK 支持列表（git/pnpm/vitest/grep/ls/...），是否已有 rtk 前缀
  - 命中且未加前缀 → 加 rtk
  - 拼回完整命令 → updatedInput.command 返回
→ Claude Code 用改写后的命令执行 Bash
```

### 错误处理 / 边界情况

- **rtk.exe 未安装**：hook 检测不到 rtk 命令时降级为不改写，仅 stderr 警告（不阻塞执行）
- **命令解析失败**（复杂 quoting）：保留原命令不改写，不报错
- **stdout/stdin UTF-8**：脚本头部强制 `[Console]::InputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8`
- **命令已有 rtk 前缀**：检测后跳过（避免 `rtk rtk git status` 双重套）

### 风险点

- Claude Code `updatedInput` 是 v2.0.10+ 才支持，先确认本地版本
- RTK 支持命令列表需要从 RTK 项目的 rtk-rewrite.sh 移植，后续 RTK 更新支持新命令时要同步

## Phase 2：Usage 观察细化（并行）

### 模块边界

- 修改 `electron/main/services/usage/usage-extractor.ts`（增加 Read 工具调用元数据提取）
- 修改 `types/usage.ts`（扩展 ConversationUsageEntry 结构）
- 修改 `components/agent-chat/usage-badge/`（新增展示维度）

### 新增观察维度

1. **Read 重复读取统计**：
   - 按 file_path 聚合本会话 Read 次数
   - 每次重读时记录"距上次 Read 隔多少轮"+"中间是否有 compact 事件"
2. **缓存类型分布**：
   - 区分 cache_creation_5m / cache_creation_1h（如果 SDK 能拿到 ttl 信息）
   - 命中率按 5m vs 1h 分别展示
3. **重读文件清单**：
   - UsageHoverCard 加一个折叠区"重读文件"
   - 展示文件路径 + 重复次数 + 间隔分析

### 数据流

```
SDK result → usage-extractor.extractUsage()
  → 遍历 messages 中的 tool_use blocks
  → 命中 Read 工具 → 提取 file_path + 累加重读计数
  → 写入 ConversationUsageEntry.readActivity 字段
→ usage-service 落 JSONL
→ usage-badge 拉取并展示
```

### 决策路径

跑 1-2 周数据后判断：

- 如果**重读绝大多数发生在 compact 后** → Phase 4 改方向为 compact 控制
- 如果**纯重复读小文件高频** → Phase 4 增加 Read 去重 hook
- 如果**重读发生但合理**（确实需要新版本） → Phase 4 仅做大文件首次截断（已规划），不做去重

## Phase 3：缓存策略基础设施

### 模块边界

- 修改 `types/electron-api.ts`（Conversation 加 `cachePolicy: '5m' | '1h'` 字段）
- 修改 `electron/main/services/conversation-service.ts`（持久化字段）
- 修改 `electron/main/agents/agent-query-config.ts`（根据 cachePolicy 设置 ENABLE_PROMPT_CACHING_1H env）
- 修改 `electron/main/tipc/agent.ts`（新增 setSessionCachePolicy RPC，返回 needsRestart）
- 修改 `components/agent-chat/ChatInputArea.tsx`（输入框工具栏加缓存策略选择器）
- 修改 `.claude/skills/brainstorming/SKILL.md`（顶部加"建议开 1h 缓存"提示）

### 数据流

```
新建对话 → conversation-service.create() 默认 cachePolicy = '5m'
SDK 启动时 → agent-query-config 根据 cachePolicy 设 env → SDK 写入对应 ttl

用户切换缓存策略：
ChatInputArea 缓存选择器 → setSessionCachePolicy IPC
  → 后端写库 → 返回 { needsRestart: true }
  → 前端弹"将重启会话"确认（复用模型切换的 UI 模式）
  → 触发 sessionRestartTrigger → 用户重发上一条
```

### 错误处理 / 边界情况

- **worker 任务**（digest/review/categorize）：强制 5min，不读 conversation.cachePolicy
- **fork 子对话**：继承父对话 cachePolicy
- **切换冲突 pendingState != idle**：禁用切换器，hover 提示"对话进行中无法切换"

### UI 设计

- 输入框工具栏增加缓存策略徽章（小标签：5m / 1h）
- 点击展开下拉，跟模型选择器同款交互
- 当前 cachePolicy 与默认值不同时，徽章高亮提示

### Skill 提示

```markdown
# brainstorming/SKILL.md 顶部追加
> 💡 长对话提示：本次进入头脑风暴模式，可能持续 10+ 分钟。
> 如果当前会话是 5min 缓存策略，建议关闭后重开会话并切到 1h
> （输入框工具栏的缓存徽章可切换）。
```

## Phase 4：大文件 Read 截断 hook

### 模块边界

- 新增 `.claude/hooks/read-truncate.ps1`
- 修改 `.claude/settings.json`（注册 PreToolUse hook for Read）

### 数据流

```
模型发出 Read 调用 → PreToolUse 触发 → read-truncate.ps1：
  - 读 tool_input.file_path
  - 检查文件实际行数（wc -l 或等价）
  - 若行数 > 1000 且调用没指定 limit
  → updatedInput.limit = 500
  → additionalContext: "文件 X 行，已截到前 500 行。需更多请用 offset/limit 继续。"
→ Claude Code 用改写后参数执行 Read
```

### 错误处理 / 边界情况

- **文件不存在**：不改写，让 Read 自己报错
- **二进制文件**（图片 / PDF）：检测扩展名，不改写
- **用户明确传 limit**：尊重用户意图，不覆盖
- **PowerShell 行数统计 UTF-8 编码**：用 `Get-Content -ReadCount 0` 或 `(Get-Content $path | Measure-Object -Line).Lines`

### 风险点

- 文件 IO 增加 hook 启动开销（~10-50ms），对小文件影响不大，大文件本身就要读，可接受
- 截断后模型可能 follow-up 多次 Read 同一文件不同区段 → Phase 2 观察数据若显示这种模式高频，再考虑优化

## 阶段依赖与顺序

```
Phase 1 (RTK Hook) ──┐
                     ├──> 落地稳定后
Phase 3 (cachePolicy) ┘    │
                           ▼
Phase 2 (Usage 观察) ──> 跑 1-2 周数据 ──> 决定 Phase 4 范围
                                              │
                           Phase 4 (Read 截断) ┘
```

- **Phase 1 / 2 / 3 可并行实施**（互不耦合）
- **Phase 4 等 Phase 2 数据出来再决定具体范围**

## CLAUDE.md 后续调整

### 删除

整个 "RTK (Rust Token Killer) - Token-Optimized Commands" 章节（约 80 行）

### 新增（1 行）

```markdown
- Bash 命令的 RTK 包装由 `.claude/hooks/rtk-rewrite.ps1` 自动处理，无需手动加前缀
```

## 未决问题

1. **Phase 1 的 RTK 支持命令完整列表**：实施时从 RTK 项目最新版 rtk-rewrite.sh 移植，需要确认 RTK 项目仓库地址和当前版本
2. **Phase 3 cachePolicy 切换是否要支持快速路径**：当前设计要重启会话，是否值得做 "SDK 进程级热切换"（涉及到 SDK 重连，代价大）—— 默认不做，等用户反馈
3. **Phase 4 大文件阈值**：当前定 1000 行 / 截 500 行，实际值要 Phase 2 数据出来后调优
4. **Phase 2 数据驱动决策的判断标准**：什么算"重读频率高"？建议先跑数据看分布，按 95 分位数决定
5. **跨平台 hook**：当前 PowerShell 实现仅 Windows，未来若有 macOS / Linux 用户需要 .sh 版本（dogear 当前定位 Windows，暂不考虑）
6. **OpenTelemetry 重型方案备选**：Claude Code CLI 内置 OTel instrumentation（`claude_code.tool.execution` / `tool.blocked_on_user` / `llm_request` 等 span，自带耗时和子代理嵌套）。当前不引入：单机桌面应用无 collector 场景 + console exporter 会污染 SDK stdout。仅借鉴字段命名（`toolActivity` / `permissionWaits`）。若未来需要工具耗时、子代理委派链可视化等更精细维度，可考虑嵌入式 collector 方案

## 验证方式

- **Phase 1**：装完 hook 后跑 5-10 条常见 Bash 命令（git status / pnpm install / vitest），看 dogear 日志里实际执行的命令是否带 rtk 前缀
- **Phase 2**：开 3-5 个真实会话跑一周，导出 usage JSONL 看新维度数据
- **Phase 3**：建新会话默认 5min，切到 1h 后看会话日志确认 SDK 启动 env 变化；usage 数据里 cache_creation 计费比率变化
- **Phase 4**：故意读个 3000 行的文件，看 hook 是否截到 500 行 + 注入提示

## 关联事项

- **切模型 race condition bug**（用户报告）：切换模型后第一次发送被拦截，需要重新输入再发。独立任务，走 systematic-debugging skill 修复，跟本设计无依赖关系。
