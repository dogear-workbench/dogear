# Step 6 交付：迁移逻辑 + 清理

## 6.1 迁移逻辑

### 1. `electron/main/services/settings-types.ts`

- `AppSettings` 接口新增 `migrated?: { workspaceConfig?: boolean }` 字段
- `DEFAULT_SETTINGS` 新增 `migrated: {}`

### 2. `electron/main/services/migration-workspace-config.ts`（新建）

核心函数 `migrateWorkspaceConfig(): Promise<void>`：

- **幂等检查**：读取 `settings.json` 的 `migrated.workspaceConfig === true` 则跳过
- **读取旧 enabledToolPacks**：直接读原始 JSON（Step 4 已从 AppSettings 类型删除，但磁盘上旧用户数据可能还有此字段）
- **遍历所有工作区**（`workspace-json-service.getAll()`）：
  1. 写入 `config.json` 的 `enabledToolPacks`（从全局 settings 复制）
  2. 扫描该工作区 `.claude/skills/<name>/SKILL.md`（存在=启用，`.disabled`=禁用）→ 收集 enabled skill names → 写入 `enabledSkills`
  3. 如果 workspace config 已有非空数据则保留（防止覆盖用户在 Step 5 之后的手动配置）
- **写入迁移标记**：`settings.json` 的 `migrated.workspaceConfig = true`

### 3. `electron/main/index.ts`

在 session-id 迁移之后、Phase 3 迁移之前插入 `migrateWorkspaceConfig()` 调用，try/catch 包裹，失败不阻塞启动。

## 6.2 废弃代码清理

| 文件 | 状态 | 说明 |
|------|------|------|
| `article-parser-skills-service.ts` | 保留 | `getArticleParserSkillsDir()` 仍被 `article-service.ts:269` 和 `tipc/article.ts:64,97,312` 引用（运行时 Python 脚本路径需要） |
| `tipc/claude-config.ts` | 确认 | `subscribeSkillTemplate` 路由已在 Step 3 删除 ✓；`listSkillTemplates`/`getSkillContent` 保留 ✓ |
| `skill-service.ts` | 确认 | `scanMarketplaceSkills`、plugin 逻辑、`SKILL.md.disabled` 重命名逻辑均已在 Step 3 删除 ✓；`listEnabledMarketplacePluginPaths` 已不存在 ✓ |
| **`plugin-bridge-service.ts`** | **已删除** | 全项目无源码引用（仅 dist/ 有旧构建残留），marketplace 桥接机制不再需要 |

## 6.3 构建验证

- `bun run build:electron` — 编译通过 ✓
- `bun run lint` — 无新增错误（4172 个 pre-existing problems 均为历史遗留，涉及文件均为旧代码） ✓
- `bun run dev` 启动验证 — 需用户手动验证（设置页能力 Tab、工具包开关、skill 开关、rtk 重写）
