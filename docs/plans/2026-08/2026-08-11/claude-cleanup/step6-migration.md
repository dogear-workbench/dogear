---
step: 6
title: 迁移逻辑 + 清理
status: done
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

- [x] `electron/main/services/migration-workspace-config.ts`（新建）
  - `migrateWorkspaceConfig(): Promise<void>`
  - 检查 `settings.json` 是否有 `migrated.workspaceConfig: true`，有则跳过
  - 读取全局 `settings.json` 的 `enabledToolPacks`
  - 遍历所有已注册工作区（`workspace-json-service.getAll()`）：
    1. 写入 `config.json` 的 `enabledToolPacks`（从全局 settings 复制）
    2. 扫描该工作区 `.claude/skills/` 下已启用（非 `.disabled`）的 skill name → 写入 `enabledSkills`
  - 写入迁移标记到 `settings.json`：`migrated.workspaceConfig: true`
- [x] `settings-types.ts` 添加 `migrated` 字段到 AppSettings + DEFAULT_SETTINGS

- [x] 迁移触发点
  - 在 app 启动流程中调用（`electron/main/index.ts` 的初始化阶段，与其他 migration 并列）
  - 参考 `migration-p3.ts` / `migration-session-id.ts` 的调用方式

### 6.2 废弃代码清理

- [x] `electron/main/services/article-parser-skills-service.ts`
  - 确认 `getArticleParserSkillsDir()` 仍被 `article-service.ts` 和 `tipc/article.ts` 引用 → 保留（运行时 Python 脚本路径需要）
- [x] `electron/main/tipc/claude-config.ts`
  - 确认 `subscribeSkillTemplate` 路由已删除 ✓
  - `listSkillTemplates` / `getSkillContent` 保留 ✓

- [x] `electron/main/services/skill-service.ts`
  - 确认以下已删除：`scanMarketplaceSkills`、plugin 相关逻辑、`SKILL.md.disabled` 重命名逻辑 ✓
  - `listEnabledMarketplacePluginPaths` 已不在源码中 ✓

- [x] `plugin-bridge-service.ts` — 已删除
  - 全项目无源码引用（仅 dist/ 有旧构建残留），marketplace 桥接机制不再需要

### 6.3 构建验证

- [x] `bun run build:electron` 编译通过
- [x] `bun run lint` 无新增错误（pre-existing 4172 problems 均为历史遗留）
- [ ] `bun run dev` 启动验证（需用户手动验证）：
  - 设置页能力 Tab 正常展示
  - 切换工具包开关 → 新会话生效
  - 切换 skill 开关 → 新会话生效
  - Bash 工具 rtk 重写生效（执行 `git status` 查看是否自动变成 `rtk git status`）

## 实施回填（做完后填）

### 实际改动

**6.1 迁移逻辑**

1. `electron/main/services/settings-types.ts`
   - `AppSettings` 接口新增 `migrated?: { workspaceConfig?: boolean }` 字段
   - `DEFAULT_SETTINGS` 新增 `migrated: {}`

2. `electron/main/services/migration-workspace-config.ts`（新建）
   - `migrateWorkspaceConfig()` 函数
   - 幂等：检查 `settings.json` 的 `migrated.workspaceConfig === true` 则跳过
   - 读取原始 settings.json 的 `enabledToolPacks`（Step 4 已从类型删除但磁盘数据可能还有）
   - 遍历所有工作区：写入 `enabledToolPacks` + 扫描 `.claude/skills/` 下 SKILL.md（非 .disabled）→ `enabledSkills`
   - 如 workspace config 已有非空数据则保留（防止覆盖用户 Step 5 之后的手动配置）
   - 写入迁移标记

3. `electron/main/index.ts`
   - 在 session-id 迁移之后、Phase 3 迁移之前插入 `migrateWorkspaceConfig()` 调用

**6.2 废弃代码清理**

4. `electron/main/services/plugin-bridge-service.ts` — 删除
   - 全项目无源码引用，marketplace 插件桥接机制已不再需要

### 完成总结

Step 6 实施完成。迁移逻辑为已存在用户提供 enabledToolPacks + enabledSkills 的自动迁移；废弃的 plugin-bridge-service.ts 已清理。其余 6.2 清理项确认在前置 Step 中已完成。`bun run build:electron` 编译通过，lint 无新增错误。
