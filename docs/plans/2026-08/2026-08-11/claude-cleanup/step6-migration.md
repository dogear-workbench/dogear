---
step: 6
title: 迁移逻辑 + 清理
status: pending
---

## 目标

为已存在的用户提供数据迁移，清理废弃的 `.claude` 目录依赖代码，确保新旧平滑过渡。

## 依赖上下文（接力棒输入）

- Step 1-5 全部完成
- 旧数据位置：
  - 全局 `settings.json` 中的 `enabledToolPacks`
  - `.claude/skills/<name>/SKILL.md`（启用）或 `.claude/skills/<name>/SKILL.md.disabled`（禁用）
- 新数据位置：`.dogear/workspaces/<id>/config.json`

## 计划改动

### 6.1 迁移逻辑

- [ ] `electron/main/services/migration-workspace-config.ts`（新建）
  - `migrateWorkspaceConfig(): Promise<void>`
  - 检查 `settings.json` 是否有 `migrated.workspaceConfig: true`，有则跳过
  - 读取全局 `settings.json` 的 `enabledToolPacks`
  - 遍历所有已注册工作区（`workspace-json-service.getAll()`）：
    1. 写入 `config.json` 的 `enabledToolPacks`（从全局 settings 复制）
    2. 扫描该工作区 `.claude/skills/` 下已启用（非 `.disabled`）的 skill name → 写入 `enabledSkills`
  - 写入迁移标记到 `settings.json`：`migrated.workspaceConfig: true`

- [ ] 迁移触发点
  - 在 app 启动流程中调用（`electron/main/index.ts` 的初始化阶段，与其他 migration 并列）
  - 参考 `migration-p3.ts` / `migration-session-id.ts` 的调用方式

### 6.2 废弃代码清理

- [ ] `electron/main/services/article-parser-skills-service.ts`
  - 如果 Step 3 还没完全删掉，确认 `getArticleParserSkillsDir()` 不再被任何代码引用
- [ ] `electron/main/tipc/claude-config.ts`
  - 确认 `subscribeSkillTemplate` 路由已删除
  - `listSkillTemplates` / `getSkillContent` 保留（前端展示模板列表还需要）

- [ ] `electron/main/services/skill-service.ts`
  - 确认以下已删除：`scanMarketplaceSkills`、plugin 相关逻辑、`SKILL.md.disabled` 重命名逻辑
  - `listEnabledMarketplacePluginPaths` 如果还被引用则保留

- [ ] 确认 `plugin-bridge-service.ts` 是否还有意义（它读 `.claude/settings.local.json` 和 `.claude/settings.json`）
  - 如果 marketplace 机制不再需要，可以清理
  - 如果还有引用则保留

### 6.3 构建验证

- [ ] `bun run build:electron` 编译通过
- [ ] `bun run lint` 通过
- [ ] `bun run dev` 启动验证：
  - 设置页能力 Tab 正常展示
  - 切换工具包开关 → 新会话生效
  - 切换 skill 开关 → 新会话生效
  - Bash 工具 rtk 重写生效（执行 `git status` 查看是否自动变成 `rtk git status`）

## 实施回填（做完后填）

### 实际改动

（待填）

### 完成总结

（待填）
