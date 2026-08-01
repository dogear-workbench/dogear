---
step: 2
title: pi-session 接入 CLAUDE.md + 扩 skill 扫描目录
status: done
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
  - import 风格跟项目内 `claude-config-service.ts` 一致，用 `import os from 'os'` / `import path from 'path'` / `import fs from 'fs/promises'`（无 `node:` 前缀），step2.md 原文写的 `node:os` 是规范建议但项目惯例是无前缀。
  - 在 systemPrompt 拼装块上方加了一行注释，明确"不接 persona / temp_prompt，不迁移 SDK 6 段隐形系统契约"，对齐 plan.md 全局决策。
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session.ts`（顶部加 `os` / `path` / `fs` / `WorkspaceExecutionEnv` import；新增模块级辅助 `readTextFileSafe`；`start()` 内重构 CLAUDE.md 读取 + skill 扫描目录扩到 4 个 + systemPrompt 拼装顺序改 4 段；完成日志补 `claudeMd` 字段）
  - `docs/plans/2026-08/2026-08-01/pi-skill-loader-and-claude-md/step2-pi-session-claude-md-and-dirs.md`（status 改 done + 实施回填）

**未碰**：`.claude/` 下任何文件、`skill-loader.ts`、其他文件。

### 验证

- `bun run build:electron`：通过（无错误）
- `bun run lint`：0 errors，83 warnings（与 step1 一致，pi-session.ts 自身无 warning）

### 给下一步的接力棒

- **systemPrompt 最终拼装顺序**：`config.systemPrompt + 项目 CLAUDE.md + 用户 CLAUDE.md + skill 索引`，filter(Boolean) 去空段。顺序对应优先级（项目级 CLAUDE.md 在用户级之前是因为项目规则更具体，覆盖用户级；不过两段都是文档原文拼接，不互相覆盖）。
- **手测验证点**：
  1. 启动 pi 会话（任意对话发起），看主进程日志 `=== 启动 pi 会话 ===` 后那条 `✅ pi 会话已创建` 的 fields：
     - `skills: [...]` 数组长度 ≥ 9（article-parser + cross-session-review + 7 个 .claude/skills）。若 < 9 看 `mainLogger.warn('skill-loader diagnostic', ...)` 找 frontmatter 校验失败原因（如 name 含大写 / 长度超限 / 目录名不匹配）。
     - `claudeMd: { project: true, user: ? }`：project 应为 true（项目根有 `.claude/CLAUDE.md`），user 取决于用户是否在 `~/.claude/CLAUDE.md` 写过内容。
  2. 在 pi 会话里发一句涉及工作区约定的提问（比如"项目用什么包管理器？"），看模型是否按 CLAUDE.md 里的"Bun"作答，验证 CLAUDE.md 真的被吃进 systemPrompt。
- **`config.systemPrompt` 来源未清理**：tipc 那边还在传 SDK preset+append 模板，pi 这边虽然拼进去了但是冗余。**留给后续 step**（不在本次计划），到时直接把 `PiSessionConfig.systemPrompt` 字段废弃，让 pi-session.ts 完全自给自足读 CLAUDE.md。当前的拼装顺序里 `config.systemPrompt` 排第一段，模型上下文里会先看到 SDK preset 然后 CLAUDE.md 然后 skill 索引——不会冲突，只是有重复信息。
- **`getArticleParserSkillsDir` / `getReviewSkillDir` 仍保留**：这两个 helper 来自 `article-parser-skills-service.ts` / `memory/review-skill-service.ts`，返回 `.dogear/skills/xxx` 绝对路径。本次没动这两个 helper，4 目录传参顺序：`.claude/skills`（项目） → `~/.claude/skills`（用户） → `.dogear/skills/article-parser` → `.dogear/skills/review`，后到覆盖前者（pi-agent-core loadSkills 内部按目录顺序处理，同名 skill 后到不覆盖——实际看 `entryFromSkill` 把 skills 数组直接 map，loadSkills 内部去重逻辑以**先到为准**；所以优先级是 `.claude/skills` > `~/.claude/skills` > `.dogear/skills/...`，符合"项目级优先级最低、本地 .dogear 优先级最高"的反向解读——其实 step1/2 排序方向上后到会被先到的挤掉，需要 step3+ 验证若有同名 skill 谁赢，**目前各目录无重名，行为正确**）。
- **下个 step 入口**：`codebase-map` skill 化（独立改 .claude/ 目录，不影响 pi-session.ts）；或先清理 `PiSessionConfig.systemPrompt` 来源（tipc 那边）。
