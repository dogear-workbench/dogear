# 清除 .claude 目录依赖 + 能力配置按工作区分开

**目标**：把 skill 加载、工具包开关从 `.claude/` + 全局 settings 迁移到 `.dogear/` 工作区级配置，同时把 rtk 重写从 PowerShell hook 移植到代码层。

**架构思路**：内置 skill 从打包资源直接扫（不复制），自定义 skill 放 `.dogear/workspaces/<id>/skills/`，能力配置存 `.dogear/workspaces/<id>/config.json`。rtk 用 `createBashTool` 的 `prepare` 回调实现。

**涉及模块**：`pi-session.ts` / `skill-template-service.ts` / `skill-service.ts` / `settings-types.ts` / `conversation-runtime-service.ts` / `builtin-tools.ts` / tipc 路由 / 前端 AbilityTab

## 步骤索引

- [ ] [Step 1: 工作区级配置服务](./step1-workspace-config.md) — 新建 workspace-config-service，读写 `.dogear/workspaces/<id>/config.json`
- [ ] [Step 2: rtk 重写移植](./step2-rtk-rewrite.md) — `createBashTool` 的 `prepare` 回调替代 PowerShell hook
- [ ] [Step 3: skill 加载路径迁移](./step3-skill-paths.md) — pi-session 扫描目录改为模板源 + 工作区自定义目录，删掉订阅复制机制
- [ ] [Step 4: 能力配置拆到工作区级](./step4-workspace-abilities.md) — enabledToolPacks 从全局 settings 移到工作区 config，全链路改造
- [ ] [Step 5: 前端设置页改造](./step5-frontend.md) — AbilityTab 从订阅/重命名模型改为配置读写模型
- [ ] [Step 6: 迁移逻辑 + 清理](./step6-migration.md) — 旧数据迁移到工作区 config，删除废弃代码和 `.claude` 依赖

## 全局决策

### 数据结构

```ts
// .dogear/workspaces/<id>/config.json
interface WorkspaceConfig {
  enabledToolPacks: string[];   // 对齐 OPTIONAL_TOOL_PACKS[].name
  enabledSkills: string[];      // skill name（frontmatter 里的 name 字段）
}
```

新建工作区默认值：`{ enabledToolPacks: [], enabledSkills: [] }`

### skill 来源分类

| source | 目录 | 说明 |
|--------|------|------|
| `builtin` | `resources/skill-templates/`（打包后 `process.resourcesPath/skill-templates/`） | 只读模板源 |
| `custom` | `.dogear/workspaces/<id>/skills/` | 用户自定义 skill |
| `user` | `~/.claude/skills/` | 保留——用户级全局 skill，跨工作区共享 |

### skill 过滤逻辑

- pi-session 启动时：扫描 builtin + custom + user 三个目录 → 用工作区 config 的 `enabledSkills` 过滤
- `enabledSkills` 为空 → 全部不挂（包括 user 级）
- `enabledSkills` 非空 → 只挂列表中的
- article-parser 不再走独立 plugin 常驻路径，统一到模板体系

### 不动的范围

- 全局 settings 中的 AI 模型、人设、子会话 Profile、权限模式等保持全局
- `.claude/hooks/`、`.claude/settings.json`、`.claude/settings.local.json` 的清理由用户手动处理
