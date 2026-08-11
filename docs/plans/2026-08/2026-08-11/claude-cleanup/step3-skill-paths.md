---
step: 3
title: skill 加载路径迁移
status: done
---

## 目标

pi-session 的 skill 扫描目录从 `.claude/skills/` 改为模板源 + 工作区自定义目录，删除"订阅复制"和"物理重命名禁用"机制。

## 依赖上下文（接力棒输入）

- Step 1 产出：`workspace-config-service.ts` 提供 `getWorkspaceConfig(workspaceId)` 返回 `{ enabledSkills: string[], ... }`
- pi-session 当前 skill 扫描代码：`pi-session.ts:329-360`
- skill 加载链路：`pi-session.ts` → `skill-loader.ts` → `pi-agent-core loadSkills(dirs)`
- `skill-template-service.ts` 的 `getTemplatesDir()` 返回模板源路径

## 计划改动

### 3.1 pi-session skill 扫描目录迁移

- [ ] `electron/main/agents/pi-session/pi-session.ts:329-360`
  - 扫描目录从 `.claude/skills` 改为：
    ```ts
    const builtinSkillsDir = getTemplatesDir();  // resources/skill-templates/
    const customSkillsDir = path.join(getConfigDir(), 'workspaces', this.config.workspaceId, 'skills');
    const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    ```
  - 删除 `articleParserSkillsDir` 和 `reviewSkillsDir`（article-parser 统一到模板体系）
  - `loadSkillIndex([builtinSkillsDir, customSkillsDir, userSkillsDir])` 不变
  - 扫描结果用工作区 config 的 `enabledSkills` 过滤：
    ```ts
    const wsConfig = await getWorkspaceConfig(this.config.workspaceId);
    skillEntries = allSkillEntries.filter(e => wsConfig.enabledSkills.includes(e.name));
    ```
  - 子会话的 `filterSkillsForSubAgent` 输入也改为过滤后的列表

### 3.2 skill-service.ts 改造

- [ ] `electron/main/services/skill-service.ts`
  - `SkillSource` 类型加 `'builtin'` 和 `'custom'`（替换 `'plugin'` 和 `'workspace'`）
  - `listSkills(workspaceId)` 扫描逻辑改为：
    - `builtin`：扫 `getTemplatesDir()`
    - `custom`：扫 `.dogear/workspaces/<id>/skills/`
    - `user`：扫 `~/.claude/skills/`（保留）
  - 每条 entry 标注 source + `enabled`（enabled = `workspaceConfig.enabledSkills.includes(name)`）
  - 删除 `scanMarketplaceSkills` 和 plugin 相关逻辑
  - `setSkillEnabled` 改为读写 `workspace-config-service` 的 `enabledSkills` 数组

### 3.3 skill-template-service.ts 精简

- [ ] `electron/main/services/skill-template-service.ts`
  - 删除 `subscribeSkillTemplate` / `restoreSkillTemplate` / `EXTRA_FILES`
  - 保留 `listSkillTemplates` / `getTemplateContent` / `getTemplatesDir`（导出给 pi-session 用）

### 3.4 article-parser 统一

- [ ] `electron/main/services/article-parser-skills-service.ts`
  - 删除 `getArticleParserSkillsDir()` 和相关独立路径逻辑
  - article-parser 作为 `resources/skill-templates/article-parser/` 的模板存在
- [ ] `electron/main/services/memory/review-skill-service.ts`
  - `getReviewSkillDir()` 如果指向独立目录，改为返回模板源路径或合并到模板体系

### 3.5 tipc 路由清理

- [ ] `electron/main/tipc/claude-config.ts`
  - 删除 `subscribeSkillTemplate` 路由
- [ ] `electron/main/tipc/skill.ts`
  - `setSkillEnabled` 路由改为调用 workspace-config-service

## 实施回填（做完后填）

### 实际改动

**3.1 pi-session.ts**
- 删除 `getArticleParserSkillsDir` / `getReviewSkillDir` 导入，新增 `getTemplatesDir` / `getWorkspaceConfig` 导入
- `start()` skill 扫描目录改为 `getTemplatesDir()` (builtin) + `.dogear/workspaces/<id>/skills/` (custom) + `~/.claude/skills/` (user)
- 扫描结果用 `wsConfig.enabledSkills` 过滤后再传给 `filterSkillsForSubAgent` 或直接使用
- `filterSkillsForSubAgent` 签名改为 `{ builtin, custom, user }`；builtin 段对 article-parser / cross-session-review 做特殊能力检查，其余 builtin + custom 按 `skills[]` 匹配，user 按 `customSkills[]` 匹配

**3.2 skill-service.ts**
- `SkillSource` 类型从 `'workspace'|'user'|'plugin'|'marketplace'` 改为 `'builtin'|'custom'|'user'`
- 删除全部 plugin/marketplace 逻辑（`scanMarketplaceSkills` / `listEnabledMarketplacePluginPaths` / `resolveEnabledMarketplacePlugins` / `readEnabledPlugins` 等）
- `listSkills(workspaceId)` 扫描三个来源目录，用 `getWorkspaceConfig(workspaceId).enabledSkills` 标注每条 entry 的 enabled
- `setSkillEnabled(skillName, enabled, workspaceId)` 改为读写 `workspace-config-service` 的 `enabledSkills` 数组
- 删除物理重命名（SKILL.md ↔ SKILL.md.disabled）逻辑

**3.3 skill-template-service.ts**
- 导出 `getTemplatesDir()`（原为私有函数）
- 删除 `subscribeSkillTemplate` / `restoreSkillTemplate` / `EXTRA_FILES`
- 保留 `listSkillTemplates` / `getTemplateContent` / `getTemplatesDir`
- 同步更新 `stock-analysis-skills-service.ts` 的 re-export（删除 subscribe/restore）

**3.4 article-parser-skills-service.ts + review-skill-service.ts**
- `article-parser-skills-service.ts`：保留 `getArticleParserSkillsDir()`（article-service.ts / tipc/article.ts 运行时依赖）；`ensureSkillsInitialized()` 不再复制 SKILL.md / common.md，仅初始化 wechat.py + history.jsonl
- `review-skill-service.ts`：`ensureReviewSkillInitialized()` 改为 no-op（skill 由 pi-session 直接读模板源）；`getReviewSkillDir()` 保留导出但不再被 pi-session 使用

**3.5 tipc 路由清理**
- `claude-config.ts`：删除 `subscribeSkillTemplate` 路由和对应 import
- `skill.ts`：`listSkills` 输入改为 `{ workspaceId }`（不再需要 resolveWorkspacePath）；`setSkillEnabled` 输入改为 `{ name, enabled, workspaceId }`，调用 workspace-config-service

**偏差说明**
- 计划要求删除 `getArticleParserSkillsDir()`，但该函数被 article-service.ts 和 tipc/article.ts 用于运行时 Python 脚本路径，这两个文件不在 step3 范围内。保留该函数，仅从 pi-session.ts 和 skill-service.ts 的 skill 扫描路径中移除。

### 给下一步的接力棒

- `enabledSkills` 过滤已生效：空数组 = 不挂任何 skill，非空 = 只挂列表中的
- `getTemplatesDir()` 已从 skill-template-service.ts 导出，可直接消费
- tipc `setSkillEnabled` 的 input schema 变了（`dir` → `name` + `workspaceId`），前端调用方需同步更新（如果有）
- article-parser 和 cross-session-review 模板必须存在于 `resources/skill-templates/` 下才能被 pi-session 扫描到
