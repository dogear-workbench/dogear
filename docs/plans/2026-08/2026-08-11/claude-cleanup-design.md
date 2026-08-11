# 清除 .claude 目录依赖 + 能力配置按工作区分开

## 背景

项目已从 Claude Code SDK 迁移到 pi 运行时，但 `.claude/` 目录仍作为 skill 加载路径存在。当前设计是"订阅 = 复制模板文件到 `.claude/skills/`"，既浪费又不必要——pi 的 `loadSkills` 能扫描任意目录。同时，能力配置（`enabledToolPacks`、skill 挂载状态）存在全局 `settings.json` 里，所有工作区共享，不符合多工作区隔离的需求。

此外，rtk 命令重写依赖 `.claude/hooks/rtk-rewrite.ps1`（Claude Code 的 PreToolUse hook），pi 运行时完全不读这个配置，该功能已失效。

## 目标

1. 内置 skill 直接从打包资源 `resources/skill-templates/` 扫描，不再复制到工作区
2. 自定义 skill 存到 `.dogear/workspaces/<id>/skills/`
3. 能力配置（enabledToolPacks + enabledSkills）从全局 settings 拆到工作区级
4. rtk 重写从 PowerShell hook 移植到 `createBashTool` 的 `prepare` 回调

## 架构

### skill 加载路径迁移

**当前数据流**：
```
resources/skill-templates/  ──订阅(复制)──→  .claude/skills/  ──pi扫描──→  loadSkillIndex
```

**改造后**：
```
resources/skill-templates/  ──pi直接扫描──→  loadSkillIndex  ──工作区配置过滤──→  最终生效
.dogear/workspaces/<id>/skills/  ──pi直接扫描──→
```

- `resources/skill-templates/` 是内置 skill 的唯一只读源（开发时读源文件，打包后 `process.resourcesPath/skill-templates/`）
- `.dogear/workspaces/<id>/skills/<name>/SKILL.md` 是自定义 skill 的存储位置
- pi-session 启动时扫描这两个目录 → 用工作区 config 的 `enabledSkills` 过滤 → 传给 `loadSkillIndex`
- article-parser 不再走单独的 plugin 常驻路径，统一纳入模板体系

### 能力配置按工作区分开

**新增工作区级配置文件**：
```
.dogear/workspaces/<id>/config.json
{
  enabledToolPacks: ['stock-analysis', ...],
  enabledSkills: ['codebase-map', 'brainstorming', ...],
}
```

**分类与默认值**：

| 分类 | 示例 | 新建工作区默认 |
|------|------|---------------|
| 常驻（代码写死，不需要配置） | 基础文件工具、memory、group、review、delegation、Grep/Glob | 总是加载 |
| 可选工具包（OPTIONAL_TOOL_PACKS） | article、stock-quote、stock-analysis、stock-announcement、stock-picking | 不挂载（`[]`） |
| 可选 Skill | brainstorming、codebase-map、doc-sync、staged-execution、staged-impl、systematic-debugging | 不挂载（`[]`） |

**从全局 settings.json 移除**：`enabledToolPacks` 字段

### rtk 重写

在 `builtin-tools.ts` 里用 `createBashTool` 的 `prepare` 回调替代 PowerShell hook：

```ts
createBashTool({
  prepare(execution) {
    execution.command = rewriteWithRtk(execution.command);
  },
})
```

`rewriteWithRtk` 移植 `rtk-rewrite.ps1` 的逻辑：按 `&& || ; |` 拆分命令，对 git/bun/grep/ls 等工具加 `rtk ` 前缀。全局硬编码，不需要配置。跨平台 TypeScript 实现，不再依赖 PowerShell。

`.claude/hooks/`、`.claude/settings.json`、`.claude/settings.local.json` 的清理由用户手动处理。

## 模块边界

### 新增

- **`workspace-config-service.ts`**（或并入 `workspace-json-service.ts`）— 读写 `.dogear/workspaces/<id>/config.json`，提供 `getWorkspaceConfig(workspaceId)` / `updateWorkspaceConfig(workspaceId, partial)` 接口
- **`rewriteWithRtk(command: string): string`** — rtk 命令重写函数，放在 `agents/pi-session/` 下

### 修改

| 文件 | 改动 |
|------|------|
| `pi-session.ts:332-340` | skill 扫描目录从 `.claude/skills` 改为 `resources/skill-templates/` + `.dogear/workspaces/<id>/skills/` |
| `pi-session.ts:441-470` | `enabledToolPacks` 读取来源从全局 settings 改为工作区 config |
| `skill-template-service.ts` | 删掉 `subscribeSkillTemplate` / `restoreSkillTemplate`，只保留 `listSkillTemplates` + `getTemplateContent` |
| `skill-service.ts` | `listSkills` 扫描目录跟着改；`setSkillEnabled` 改为读写工作区 config 的 `enabledSkills` 数组，不再物理重命名文件 |
| `settings-types.ts` | `AppSettings` 删掉 `enabledToolPacks` 字段 |
| `conversation-runtime-service.ts:93` | `enabledToolPacks` 从全局 settings 改为读工作区 config |
| `builtin-tools.ts` | `createBashTool` 传入 `prepare` 回调做 rtk 重写 |
| `claude-config.ts`（tipc） | 删掉 `subscribeSkillTemplate` 路由 |
| `skill.ts`（tipc） | `setSkillEnabled` 改为读写工作区 config |
| `AbilityTab.tsx` | "订阅/取消订阅"按钮改为"启用/禁用"开关 |
| `article-parser-skills-service.ts` | 不再作为 plugin 常驻路径，统一到模板体系 |

### 删除（代码层面）

- `subscribeSkillTemplate` / `restoreSkillTemplate` 函数及相关 tipc 路由
- `SKILL.md ↔ SKILL.md.disabled` 物理重命名机制
- `article-parser-skills-service.ts` 中 `getArticleParserSkillsDir()` 的独立路径逻辑

## 数据流

### skill 加载（改造后）

```
pi-session.start()
  → 读取工作区 config.json → 获取 enabledSkills
  → loadSkillIndex([
      resources/skill-templates/,        // 内置模板
      .dogear/workspaces/<id>/skills/,   // 自定义
    ])
  → 用 enabledSkills 过滤（enabledSkills 为空则全部不挂）
  → formatSkillIndexForPrompt → 注入 systemPrompt
```

### 能力开关（改造后）

```
设置页切换工具包/skill
  → client.updateWorkspaceConfig(workspaceId, { enabledToolPacks / enabledSkills })
  → 写入 .dogear/workspaces/<id>/config.json
  → 下次会话启动时读取生效
```

## 迁移策略

首次启动时检测旧配置：

1. 读取全局 `settings.json` 的 `enabledToolPacks`
2. 遍历所有已注册工作区，把 `enabledToolPacks` 写入各自的 `config.json`
3. 扫描 `.claude/skills/` 下已存在的 skill（非 `.disabled`）→ 写入各工作区 `enabledSkills`
4. 从全局 `settings.json` 删除 `enabledToolPacks` 字段
5. 迁移标记写入 `settings.json`（如 `migrated.workspaceConfig: true`），避免重复执行

## 错误处理 / 边界情况

- 工作区 config.json 不存在时返回默认值（`enabledToolPacks: []`, `enabledSkills: []`）
- `enabledSkills` 中引用了不存在的 skill（模板源已删）→ loadSkillIndex 扫不到自然过滤掉，不报错
- 自定义 skill 目录为空 → 正常，只是扫不到东西
- `rewriteWithRtk` 中 rtk 不在 PATH → 直接放行原命令（与 PowerShell 脚本行为一致）

## 未决问题

- CLAUDE.md / agent.md 的关系：pi 已经在读 `.dogear/workspaces/<id>/agent.md`，`.claude/CLAUDE.md` 是历史遗留，不在本次改动范围
- `.claude/rules/` 和 `.claude/agents/` 的清理由用户手动处理
- 全局 settings 中其他字段（AI 模型、人设、子会话 Profile）保持全局，不拆到工作区级
