---
step: 2
title: pi-session 接入 CLAUDE.md + 扩 skill 扫描目录
status: pending
---

## 目标

`electron/main/agents/pi-session/pi-session.ts` 的 `start()` 内做两件事：

1. **读 CLAUDE.md**：fs.readFile 项目级 `.claude/CLAUDE.md` + 用户级 `~/.claude/CLAUDE.md`，失败静默
2. **扩 skill 扫描目录**：从现有 2 个目录扩到 4 个

重构 systemPrompt 拼装顺序为：`项目级 CLAUDE.md + 用户级 CLAUDE.md（可选）+ skill 索引文本`，移除其他拼接源（外部传入的 `config.systemPrompt` 是已有通道，保留）。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：[step1-rewrite-skill-loader.md] 已重写 skill-loader 内部用 `loadSkills`，对外签名 `loadSkillIndex(dirs, env?)` 扩了可选 `env` 参数，`SkillEntry` 加了内部 `content?` 字段。
- **当前 pi-session.ts:135-137 关键代码**：
  ```ts
  const skillEntries = await loadSkillIndex([getArticleParserSkillsDir(), getReviewSkillDir()]);
  const skillIndexText = formatSkillIndexForPrompt(skillEntries);
  const systemPrompt = [this.config.systemPrompt ?? '', skillIndexText].filter(Boolean).join('\n\n');
  ```
- **CLAUDE.md 路径解析**：参考 `electron/main/services/claude-config-service.ts`：
  - 项目级：`path.join(workspacePath, '.claude', 'CLAUDE.md')`
  - 用户级：`path.join(os.homedir(), '.claude', 'CLAUDE.md')`
  - workspacePath 已在 `PiSessionConfig.workspacePath`（pi-session.ts:44），直接用
- **现有 systemPrompt 字段**：`PiSessionConfig.systemPrompt?` 是外部传入（tipc 那边拼好的，含 SDK preset + append 模板）。本 step **不动 config.systemPrompt 的来源**，只改 pi-session.ts 内部拼装顺序——tipc 那边的 systemPrompt 来源后续 step 单独清理（不在本次计划范围）。
- **用户主目录**：用 `os.homedir()`（Node 内置），跨平台兼容
- **WorkspaceExecutionEnv 已实现**：`workspace-execution-env.ts:20`，构造时传 workspacePath；Step 1 后 `loadSkillIndex` 接受可选 env 参数，这里传入 `WorkspaceExecutionEnv` 让 .gitignore 用工作区相对路径正确解析

## 计划改动

- [ ] `electron/main/agents/pi-session/pi-session.ts` 顶部新增 import：
  - `os` from `node:os`
  - `WorkspaceExecutionEnv` from `./workspace-execution-env.js`
- [ ] `start()` 内（pi-session.ts:114-165）重构：
  - 在 `loadSkillIndex` 调用前先读两个 CLAUDE.md：
    ```ts
    const projectClaudeMd = await readTextFileSafe(path.join(this.config.workspacePath, '.claude', 'CLAUDE.md'));
    const userClaudeMd = await readTextFileSafe(path.join(os.homedir(), '.claude', 'CLAUDE.md'));
    ```
  - `readTextFileSafe` 是模块内辅助函数（fs.readFile 失败返回 `''`，不抛错）
  - 扩 `loadSkillIndex` 调用到 4 个目录：
    ```ts
    const env = new WorkspaceExecutionEnv(this.config.workspacePath);
    const skillEntries = await loadSkillIndex([
      path.join(this.config.workspacePath, '.claude', 'skills'),
      path.join(os.homedir(), '.claude', 'skills'),
      getArticleParserSkillsDir(),
      getReviewSkillDir(),
    ], env);
    ```
  - systemPrompt 拼装顺序改为：
    ```ts
    const systemPrompt = [
      this.config.systemPrompt ?? '',       // 外部传入（tipc 拼的 preset）
      projectClaudeMd,                      // 项目级 CLAUDE.md（精简版）
      userClaudeMd,                         // 用户级（可能为空）
      skillIndexText,                       // skill 索引
    ].filter(Boolean).join('\n\n');
    ```
- [ ] 新增模块级辅助 `readTextFileSafe(filePath: string): Promise<string>`，try/catch 包 fs.readFile，失败返回 `''`
- [ ] **diagnostics 处理**：Step 1 把 `loadSkills` 的 diagnostics 走 `mainLogger.warn` 单条输出，本 step 不再处理
- [ ] 完成日志（pi-session.ts:164）补 `claudeMd: { project: !!projectClaudeMd, user: !!userClaudeMd }` 字段方便排查
- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] 手测：启动 pi 会话，看日志里 `skills` 字段含 8+ 个 skill 名字（article-parser + cross-session-review + 现有 7 个 .claude/skills + 可能的 codebase-map，codebase-map 要等 Step 3 才有）

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- **systemPrompt 最终拼装顺序**：`config.systemPrompt + 项目 CLAUDE.md + 用户 CLAUDE.md + skill 索引`，filter(Boolean) 去空段
- **手测验证点**：日志里看 `skills: [...]` 数组长度，预期 ≥ 9（article-parser + cross-session-review + 7 个 .claude/skills）。如果 `.claude/skills/` 下的 SKILL.md frontmatter 不合规（name 含大写字母 / 长度超限），会被 loadSkills 的 name 校验丢掉，对应减少——这种情况要看 mainLogger.warn 输出找原因。
- **`config.systemPrompt` 来源未清理**：tipc 那边还在传 SDK preset+append 模板，pi 这边虽然拼进去了但是冗余。**留给后续 step**（不在本次计划），到时直接把 `PiSessionConfig.systemPrompt` 字段废弃，让 pi-session.ts 完全自给自足读 CLAUDE.md。
- 下个 step 该从哪里继续：`codebase-map` skill 化（独立改 .claude/ 目录，不影响 pi-session.ts）
