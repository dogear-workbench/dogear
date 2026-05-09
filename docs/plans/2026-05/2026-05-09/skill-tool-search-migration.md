# Tool Search 迁移方案 + 工具包统一管理

> 创建日期：2026-05-09
> 状态：设计中（待评审 → 实施）
> 关联里程碑：1.5 Phase 3 模块 B（B3.3 二次修订）
> 前置：上一版方案 `skill-on-demand-mcp-loading.md`（动态 MCP + PreToolUse hook）实施后验证失败
> 预估工作量：0.5-1 天（不含 Layer 4）

---

## 一、为什么要再次重做

### 上一版方案的失败现象

`skill-on-demand-mcp-loading.md` 提出"PreToolUse hook 拦截 → 动态 `setMcpServers` 挂载"，实施后实测：

- Hook 触发挂载后，Agent **始终找不到新挂上的 MCP 工具**
- 推测原因：SDK 的 query 在 `query()` 调用瞬间已经把 mcpServers 列表固化到上下文里，运行时 setMcpServers 改的状态没有同步给当前正在运行的推理上下文，下一轮才生效，但下一轮 Agent 的"工具集合"心智模型已经定了
- 即便能挂上，工具描述也不会进系统提示，Agent 没有主动调用的依据

### 找到了官方推荐路径：Tool Search

`claude_code_doc_md/sdk-^0.2.119/使用工具扩展/使用工具搜索扩展到多个工具.md` 给出了 Anthropic 设计的"上千工具"标准玩法 —— **Tool Search**，关键事实：

| 事实 | 含义 |
|------|------|
| Tool Search **默认开启**（`ENABLE_TOOL_SEARCH` unset = always on） | 不需要主动配置 |
| 工具的完整 input schema **默认不进上下文** | 基础 token 直接节省 |
| 上下文里只有"工具目录摘要"（name + 一行描述，每个工具几十 token） | Agent 知道有什么、但不知道详细参数 |
| Agent 需要时主动调用内置 `tool_search` → 返回 3-5 个最相关工具的完整定义 | 一次 round-trip 换取常驻 token 节省 |
| 后续轮次工具仍可用，直到 SDK compact 把它压缩掉 | 不会重复 search |
| 适用于 Sonnet 4 / Opus 4，不支持 Haiku | dogear 默认 Sonnet 4，没问题 |

### 与 Skill 的关系澄清（重要）

**Tool Search 只搜 MCP 工具，跟 Skill 完全无关**。两套机制各自管不同的东西：

| 机制 | 管什么 | 上下文里是什么 |
|------|--------|----------------|
| Tool Search | MCP 工具的 input schema | 默认隐藏完整 schema，只留目录摘要，按需加载 |
| Skill | 一段流程说明书 + 可选脚本/资源 | SKILL.md 的 metadata（~100 token）一直在 system prompt，正文按需加载 |

**Skill 的真正定位**是给 Agent 看的"操作手册 / SOP"，解决"应该按什么流程做这件事"，**不是"我有什么能力"**。Anthropic 官方的 pptx/docx skill 看起来像"工具"，但其实是"流程 + 一次性可执行脚本"——Agent 通过 Bash 执行 skill 目录里的 Python 脚本，**不是通过 MCP 调用工具**。

当前 dogear 的 `stock-analysis` SKILL.md 主要描述了工具列表，这是错误用法（是上一版动态 MCP 方案的妥协设计）。本次方案先不重写 SKILL.md（Layer 4 后续单独做），先把架构纠正过来。

---

## 二、新方案：Tool Search + 工具包统一开关

### 核心思路

不再做"动态挂 MCP" —— 改为：

1. **会话启动时一次性注册全部启用的工具包对应的 MCP server**
2. **Tool Search 默认开启**，工具 schema 不进上下文，Agent 按需 search
3. **设置页用一个开关管"工具包"**：开 = 注册 MCP + 默认允许所有工具，关 = 完全不注册（Agent 连目录都看不到）
4. **System prompt 里注入"工具导览"**，告诉 Agent 哪些类目的工具可以搜，提升命中率

### 新的工具分层

```
常驻工具（永远注册，永远默认允许）
├── memory          每个会话都用，定位为"内置常驻"
└── （未来其他必备的小工具）

可选工具包（按 enabledToolPacks 开关）
├── book-qa         书籍问答（依赖工作区有书籍）
├── article         文章管理（依赖工作区）
├── stock-quote     股票行情（实时报价、K线、自选股）
└── stock-analysis  股票分析（技术指标、筛选、公式、回测）

SDK 自带工具（保留细粒度权限管理）
├── Read / Write / Edit
├── Bash
├── Grep / Glob
├── Task
└── Skill / SlashCommand 等
```

### 单一开关语义

**"开启工具包" = 注册 MCP server + 把 `mcp__<server-name>__*` 加入 allowedTools**

不再让用户管包内单个工具的 allow/deny —— 我们自家 MCP，全开就好。
SDK 自带工具的细粒度权限管理保留。

---

## 三、代码改动清单（Layer 1-3）

### Layer 1：MCP 注册策略

**文件**：`electron/main/services/optional-skills.ts`
- 文件改名为 `tool-packs.ts`
- 类型 `OptionalSkillMeta` 改名为 `ToolPackMeta`
- 常量 `OPTIONAL_SKILLS` 改名为 `OPTIONAL_TOOL_PACKS`
- 移除字段：`mcpServerFactory`（不再延迟）、`autoApproveOnTrigger`（统一规则）
- 保留字段：`name`, `label`, `description`, `mcpServerName`, `toolCount`, `requirements`
- 扩展条目：把 `book-qa`、`article`、`stock-quote`、`stock-analysis` 全部纳入

**文件**：`electron/main/services/conversation-runtime-service.ts`
- 移除：当前的"按 enabledSkills 挂 plugin + PreToolUse hook" 逻辑
- 重写 mcpServers 构造：
  - 常驻：`memory` 永远注册
  - 可选：遍历 `OPTIONAL_TOOL_PACKS`，按 `appSettings.enabledToolPacks.includes(name)` 决定是否注册
- 重写 allowedTools 构造：
  - 基础：`['Read', 'Glob', 'Grep']`（保持不变）
  - 常驻包通配符：`mcp__dogear-memory__*`
  - 已开启的工具包 → 追加 `mcp__<mcpServerName>__*` 通配符
- 不显式设置 `ENABLE_TOOL_SEARCH`，用 SDK 默认（always on）

**文件**：`electron/main/agents/query-based-session.ts`
- 移除上一版加的 PreToolUse hook 中"动态挂 MCP" 那一段
- 移除 `enabledSkillsForOnDemand` 配置项（如有）

**文件**：`types/settings.ts`
- 字段重命名：`enabledSkills: string[]` → `enabledToolPacks: string[]`
- 不做兼容（开发阶段，符合项目偏好）

**文件**：`electron/main/services/settings-types.ts`
- 同步重命名

**文件**：`electron/main/services/settings-service.ts`
- 默认值同步：`enabledToolPacks: []`（默认全关，用户主动开启）

### Layer 2：System Prompt 工具导览

**新文件**：`electron/main/agents/tool-pack-guide.ts`
```typescript
import { OPTIONAL_TOOL_PACKS } from '../services/tool-packs.js';

export function buildToolPackGuide(
  enabledToolPacks: string[],
  hasWorkspace: boolean,
): string {
  const lines: string[] = [];
  lines.push('你可以搜索以下类目的工具：');
  lines.push('- 记忆系统：跨会话保存用户偏好和反馈（memory_*）');

  for (const pack of OPTIONAL_TOOL_PACKS) {
    if (!enabledToolPacks.includes(pack.name)) continue;
    if (pack.requiresWorkspace && !hasWorkspace) continue;
    lines.push(`- ${pack.label}：${pack.description}`);
  }

  lines.push('');
  lines.push('需要时调用对应类目工具，会自动加载详细参数说明。');
  return lines.join('\n');
}
```

**文件**：`electron/main/agents/query-based-session.ts`
- 在组装 systemPrompt append 链路中加入这段导览
- 顺序：`defaultSystemPrompt → persona.prompt → tempPrompt → systemPromptAppend → toolPackGuide`
- 注意：导览放最后是为了确保 Agent 看到的最新工具集合（persona/tempPrompt 可能不知道当前工具开关）

### Layer 3：设置页改造

**文件改名**：`app/settings/SkillsTab.tsx` → `app/settings/ToolPacksTab.tsx`

**修改内容**：
- Tab 标题：「Skill 管理」→「工具包」
- 顶部说明文字：
  ```
  开启工具包后，对话中的 AI 可以搜索并调用其中的工具。
  开启即默认允许包内所有工具调用，不需要单独管理权限。
  ```
- 列出所有可选工具包：每行一个开关 + 名称 + 描述 + 工具数量徽标
- 不再展示包内工具列表（因为不再做单工具管理）
- 保留 `requirements` 字段展示（如 stock-analysis 的 Python 依赖说明）

**文件**：`app/settings/page.tsx`
- 引用 `ToolPacksTab` 替换 `SkillsTab`
- Tab 名称同步

**文件**：原"工具权限"Tab 保留
- 只展示 SDK 自带工具的 allow/deny（Read/Write/Bash/...）
- 移除其中所有 MCP 工具相关的展示（因为现在归"工具包"管）

### Layer 4（本轮不做）

后续单独一轮：重写 `stock-analysis` SKILL.md 为流程指引（不再描述工具列表，改为"做股票分析时的标准 SOP"）。
其他工具包按需要决定是否加 SKILL.md（很多可能根本不需要）。

---

## 四、回退说明（针对上一版方案）

### 需要回退的代码点

1. `electron/main/services/optional-skills.ts` 中的 `mcpServerFactory` 和 `autoApproveOnTrigger` 字段（连同延迟挂载逻辑）
2. `query-based-session.ts` 中"PreToolUse hook 动态挂 MCP" 的整段实现（具体函数名待 grep 确认）
3. `conversation-runtime-service.ts` 中的 `enabledSkillsForOnDemand` 数组传递
4. 上一版方案文档不删除，标记为「已废弃，被 skill-tool-search-migration.md 取代」

### 保留的部分

- `enabledSkills`（即将改名为 `enabledToolPacks`）的存储字段——只是语义和 UI 改了
- `stock-analysis-skills-service.ts` 的目录初始化——仍然有用（SKILL.md 文件还在，Layer 4 重写）

---

## 五、Token 收益估算

假设全部工具包开启的极端场景（实际用户通常只开 1-2 个）：

| 项目 | 上一版方案 | 新方案 |
|------|-----------|--------|
| MCP 工具 schema | 启动注入 ~3000 token（开启的包） | 不进上下文 |
| 工具目录摘要 | 无 | ~500 token（17 个工具 × ~30 token） |
| SKILL.md frontmatter | 100 token | 100 token |
| 工具导览（system prompt） | 无 | ~150 token |
| **基础上下文总计** | **~3100 token** | **~750 token** |
| 首次调用某工具 | 已加载，无延迟 | 多 1 次 search round-trip（~200ms） |

**典型场景**（用户只开 stock-quote）：
- 上一版：~1500 token 起步
- 新方案：~250 token 起步

**额外收益**：
- 工具选择准确率提升（文档明确指出 >30 个工具会下降）
- 关掉的工具包 Agent 完全看不到 → 不会误调用
- 设置页面 UX 更直观

---

## 六、实施顺序

1. **写完本文档** ← 当前步骤，等用户 review
2. **Layer 1 + 字段重命名** —— 一次性改完，会跑通基础流程
3. **Layer 2 工具导览** —— 看 Agent 实际命中率，必要时调整描述
4. **Layer 3 设置页** —— 最后做，避免设计期间 UI 反复
5. **手动验证**：
   - 关闭所有工具包 → 启动会话，确认基础工具仍可用
   - 开启 stock-quote → 问"帮我看下贵州茅台"，确认 Agent 能搜到 stock_quote 并调用
   - 开启 stock-analysis → 问"今天有什么金叉"，确认搜到 calculate_indicators / detect_signals
6. **Layer 4** —— 单独一轮，重写 SKILL.md 为流程指引

---

## 七、风险与待观察项

- **Tool Search 命中率**：依赖工具 name/description 的关键词质量。如果命中率不理想，需要逐个工具优化描述（参考文档第 109-115 行：用 `search_slack_messages` 这种动词+对象+实体的命名）
- **首次调用延迟**：每个工具第一次被需要时多一次 search round-trip。如果观察到高频工具被反复 search（compact 后丢失再搜），可以考虑后续把高频工具改为预加载
- **Sonnet/Opus 限制**：用户切到 Haiku 模型时 Tool Search 不可用，需要在 UI 提示或自动降级到全量加载（暂不处理，dogear 默认 Sonnet）
- **导览文本污染**：工具导览注入到 system prompt 末尾，如果用户写的 persona 提到"工具"可能会冲突，需要观察实际效果
