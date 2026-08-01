---
step: 1
title: 重写 skill-loader 用 loadSkills 替换手写
status: done
---

## 目标

把 `electron/main/agents/pi-session/skill-loader.ts` 内部实现从「手写 frontmatter 解析 + 自造索引文本 + 自造 Skill 工具」改为「薄封装 pi-agent-core 的 `loadSkills` + `formatSkillInvocation`」，白嫖完整能力（递归扫描 / .gitignore / yaml 解析 / name 校验 / 错误诊断聚合）。**对外签名保持不变**，避免影响 pi-session.ts 调用方。

## 依赖上下文（接力棒输入）

- **设计文档**：[pi-skill-loader-and-claude-md-design.md](../../pi-skill-loader-and-claude-md-design.md) 「Skill 加载策略」一节定下用 `loadSkills`，排除手写 loader 和 AgentHarness 整包
- **pi-agent-core 的 loadSkills 签名**（`node_modules/@earendil-works/pi-agent-core/dist/harness/skills.d.ts`）：
  - `loadSkills(env: ExecutionEnv, dirs: string | string[]): Promise<{ skills: Skill[], diagnostics: SkillDiagnostic[] }>`
  - `formatSkillInvocation(skill: Skill, additionalInstructions?: string): string`（命中后调用，把 SKILL.md 内容包成 `<skill>` 块）
  - `Skill` 类型：`{ name, description, content, filePath, disableModelInvocation? }`
- **ExecutionEnv 已实现**：`electron/main/agents/pi-session/workspace-execution-env.ts:20-21` 实现 `ExecutionEnv` 接口，`NodeExecutionEnv` 也从 `pi-agent-core/node` 导入。本 step 直接复用 `WorkspaceExecutionEnv`，构造时传入 workspacePath 即可。
- **当前调用方**：`pi-session.ts:135` 是 `loadSkillIndex([getArticleParserSkillsDir(), getReviewSkillDir()])`；`pi-session.ts:142` 是 `createSkillTool(skillEntries)`；`pi-session.ts:136` 是 `formatSkillIndexForPrompt(skillEntries)`。这三个函数的签名必须保留。
- **导入路径**：从 `@earendil-works/pi-agent-core` 顶层导入。具体子路径可能要试 `@earendil-works/pi-agent-core/harness/skills` 或从顶层 `dist/index.js` 看 re-export（实施时先尝试顶层导入，失败再走子路径）。

## 计划改动

- [x] `electron/main/agents/pi-session/skill-loader.ts` 重写：
  - 删除 `FRONTMATTER_RE` / `parseFrontmatterFields` / 手写 `loadSkillIndex` 的 fs.readFile + frontmatter 切分逻辑
  - 删除手写的 `<available_skills>` 索引拼装，改用 `loadSkills` 返回的 `Skill[]` + 简单 map
  - `loadSkillIndex(dirs: string[]): Promise<SkillEntry[]>` 内部改为：构造 `WorkspaceExecutionEnv`（或 `NodeExecutionEnv`）→ 调 `loadSkills(env, dirs)` → 把 `Skill[]` 映射成 `SkillEntry[]`（保留 `{ name, description, dir, bodyPath }` 形状，dir/bodyPath 从 `Skill.filePath` 推导）
  - `formatSkillIndexForPrompt(entries)` 保留对外签名，内部用 `loadSkills` 的产物重新组织（或继续手写 `<available_skills>` 文本——这段文本格式不影响 pi-agent-core，是 dogear 自己决定的，**保留现有格式即可**）
  - `createSkillTool(entries)` 保留对外签名，handler 内部改用 `formatSkillInvocation(entry)` 包输出（不再手拼正文），但要适配 `SkillEntry` 和 `Skill` 的字段差异（content 直接从 SKILL.md 读 vs Skill.content 已加载）
  - diagnostics 走 `mainLogger.warn`，单条 warn 含 path + code + message
- [x] 处理 `SkillEntry` 与 `Skill` 的字段映射：
  - `SkillEntry.dir` = `path.dirname(Skill.filePath)`
  - `SkillEntry.bodyPath` = `Skill.filePath`
  - `SkillEntry` 内部加一个可选字段 `content?: string` 缓存 `Skill.content`，避免 `createSkillTool` 命中时再 fs.readFile 一次（`loadSkills` 已经把 content 读到内存了）
- [x] 处理 ExecutionEnv 构造：`loadSkillIndex` 当前是模块级纯函数，没有 workspacePath。**方案**：`loadSkillIndex` 签名扩成 `(dirs: string[], env?: ExecutionEnv)`，env 缺省时用 `NodeExecutionEnv`（从 `@earendil-works/pi-agent-core/node` 导入）；调用方（pi-session.ts）传 `WorkspaceExecutionEnv` 进来更好，但本 step 不动调用方，先让 env 可选 + 默认 Node 实现。
- [x] `bun run build:electron` + `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - **loadSkills 是从顶层 `@earendil-works/pi-agent-core` 导入**（`export * from "./harness/skills.ts"` + `export * from "./harness/types.ts"`），不是子路径。`formatSkillInvocation` / `Skill` / `SkillDiagnostic` / `ExecutionEnv` 同样从顶层导入。`NodeExecutionEnv` 走 `@earendil-works/pi-agent-core/node`（package.json exports 只允许 `.` 和 `./node`，无 `./harness/skills` 子路径）。
  - **SkillEntry 形状完全按计划**：对外 `{ name, description, dir, bodyPath }`，内部加 `content?: string` 缓存 `Skill.content`。`createSkillTool` 命中时优先用 `entry.content`，缺失 fs.readFile 兜底（兜底分支理论上不会走到，但保留作防御）。
  - **formatSkillInvocation 接收的是 `Skill` 不是 `SkillEntry`**：命中工具时用 entry 字段重新组装 `{ name, description, content, filePath: bodyPath }` 喂给 `formatSkillInvocation`。
  - **formatSkillIndexForPrompt 完全保留原 `<available_skills>` 文本格式**（计划允许，dogear 自决）。
  - **未碰 pi-session.ts**：现有 `loadSkillIndex([getArticleParserSkillsDir(), getReviewSkillDir()])` 调用不传 env，走 NodeExecutionEnv(process.cwd()) 兜底，行为与改造前等价。Step 2 改 pi-session.ts 时再扩 4 目录 + 接入 CLAUDE.md + 显式传 WorkspaceExecutionEnv。
- 改动文件清单：
  - `electron/main/agents/pi-session/skill-loader.ts`（完整重写，~100 行 → ~95 行）

### 给下一步的接力棒

- **`loadSkillIndex` 新签名**：`loadSkillIndex(dirs: string[], env?: ExecutionEnv): Promise<SkillEntry[]>`。Step 2 改 pi-session.ts 时建议显式传入 `WorkspaceExecutionEnv` 实例（dogear 已实现，能让 .gitignore 用工作区相对路径正确解析）。
- **`SkillEntry` 字段**：保留对外 `{ name, description, dir, bodyPath }`，内部加 `content?: string` 缓存。`createSkillTool` 命中时优先用 `entry.content`，缺失再 fs.readFile 兜底。
- **导入 loadSkills 的实际路径**：`@earendil-works/pi-agent-core`（顶层 re-export）。`NodeExecutionEnv` 从 `@earendil-works/pi-agent-core/node`。**注意**：package.json exports 只允许 `.` / `./node` / `./package.json`，不能走 `./harness/skills` 子路径。
- **diagnostics 是否聚合上报**：是。`loadSkillIndex` 内部循环 `mainLogger.warn('skill-loader diagnostic', { code, path, message })` 单条输出每条 diagnostic（含 file_info_failed / list_failed / read_failed / parse_failed / invalid_metadata 五种 code）。当前未聚合到事件总线或前端，纯日志。
- **Windows 路径分隔符注意**：`formatSkillInvocation` 内部 `dirnameEnvPath` 用 `/` 切分，在 Windows 下 `References are relative to ...` 段会显示 `/`（上游 bug，本 step 不处理）。skill 的 `location="${filePath}"` 字段是完整 Windows 路径，模型仍可识别。
- **`cross-session-review` 名字 vs 目录名 `review`**：loadSkills 会 emit invalid_metadata warning（name 不等于父目录名），但 skill 仍会被加载并使用 frontmatter.name。Step 4 精简 CLAUDE.md 时如果同时重命名目录或 frontmatter，记得这条 warning 会消失。
- 下个 step 该从哪里继续：`pi-session.ts:135` 的 `loadSkillIndex` 调用，扩到 4 个目录 + 接入 CLAUDE.md 读取
