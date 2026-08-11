---
step: 3
title: skill 加载路径迁移
status: pending
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

（待填）

### 给下一步的接力棒

（待填）
