---
step: 1
title: data-registry 模块
status: done
---

## 目标
建立唯一事实源模块：全部数据项定义 + 备份分类源派生 + 同步范围派生，带单测锁定派生输出。

## 依赖上下文（接力棒输入）
- （执行时由上一步/规划回填）规划依据：设计文档 [../backup-sync-registry-design.md](../backup-sync-registry-design.md)「架构 §1」

## 计划改动
- [x] 新建 `electron/main/services/data-registry.ts`：
  - `DataItem`：`{ id, paths: string[]（相对 configDir）, external?: 'workspace-tasks'（声明 configDir 外）, sensitive?: boolean, mergePolicy: 'file' | 'records' | 'settings-fields', backupCategory?: BackupCategoryKey, syncItemId?: string }`
  - 数据项全集（对照审计范围表）：`workspaces/<id>/{notes/, groups/, groups.json, conversations.json, config.json, agent.md, memory/, sessions/}`、`memory/`、`conversations/`、`settings.json`、`plans.json`、`notifications.json`、`login-accounts.json`、外部 tasks.json、`usage/`、`article-parser/`、`site-knowledge/`、`run-history/`、`stocks/`、`feishu/`
  - 派生函数：`backupSourcesFor(category, scope): Promise<string[]>`（含外部锚点：读 workspaces.json → 每个 workspace.path/.dogear/tasks.json）、`registrySyncItems()`、`sensitiveRelPaths()`（login-accounts.json 等）
- [x] 新建 `electron/main/services/data-registry.test.ts`：断言派生输出覆盖审计对照表全部行（特别是 tasks 外部路径、groups.json 归属 notes-groups、app-config 四文件）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - **app-config 备份源 6 文件（主会话已拍板认可）**：计划 4 文件之外追加 `workspaces/workspaces.json`（审计漏备点 + 恢复外部锚点的反解依据，不备则恢复链路不完整）与全局 `agent.md`（pi-session.ts:417、claude-config-service.ts:111 有真实读取链）
  - `sessions 源追加 conversations/` 未加 DataItem 字段，用派生规则实现：全局条目默认只进 global scope，分类无 global 去处时并入每个 workspace zip（单测锁定）
  - 多两个派生工具 `toArchiveRelPath(abs)` / `resolveArchiveRelPath(zipRel)`：虚拟前缀知识唯一封装在 registry，zip 内路径计算与反解都用它
  - `resolveArchiveRelPath` 对全部条目统一拒绝穿越/绝对/反斜杠/空段（返工加固，防恶意 zip 写 configDir 外）
  - `GLOBAL_SCOPE`/`BackupScope`/scope 校验在 registry 独立定义（与 categories.ts 暂两处并存，step2 收敛 import）
- 改动文件清单：
  - 新建 `electron/main/services/data-registry.ts`（约 170 行）
  - 新建 `electron/main/services/data-registry.test.ts`（17 例）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `BACKUP_CATEGORY_KEYS = ['notes-groups','memory','tasks','sessions','app-config']`；`BACKUP_CATEGORY_SCOPES`：notes-groups/sessions=['workspace']、memory=both、tasks/app-config=['global']
  - `backupSourcesFor(category, scope): Promise<string[]>` 返回绝对路径；tasks×global → `configDir/__ws-external__/<wsid>/.dogear/tasks.json` 虚拟路径（workspaces.json 损坏安全降级为空）；sessions×ws → `[ws/sessions, configDir/conversations]`；不适用组合抛错
  - `registrySyncItems()` 派生 syncItemId 集合 == SYNC_ITEM_IDS 12 项（单测锁定）；`sensitiveRelPaths()` = ['login-accounts.json']
  - `toArchiveRelPath(abs)`：绝对路径 → zip 内 posix rel；`resolveArchiveRelPath(rel)`：外部锚点按 workspaces.json 反解，未注册/非法段 → null（跳过并警告）
  - mergePolicy 锁定：settings=settings-fields；groups.json/conversations.json/workspaces.json/plans.json/notifications.json=records；其余 file
- 下个 step 该从哪里继续：categories.ts 删手写 switch 改调 backupSourcesFor；BACKUP_CATEGORIES 增 app-config（scopes 取 BACKUP_CATEGORY_SCOPES，daily/keep10）；GLOBAL_SCOPE/BackupScope/assertScope 改从 registry import 删本地定义；notes-groups 显示名改「笔记与工作区」；zip-pack.ts 用 toArchiveRelPath 算 zip 内路径、读取时经 resolveArchiveRelPath 反解；index.ts restoreBackup 同理，null 跳过并警告
- 待办或已知限制：
  - personal 工作区不入 workspaces.json → 无 tasks 外部锚点（按设计执行）
  - settings.json 未标 sensitive（required 同步项，sensitive 语义限定同步须排除的凭据类）
  - stocks/feishu ↔ settings 键名映射留在 manifest.ts（键名非路径知识，step5 接 F1 时消费 registrySyncItems）
  - registry 有意未收录：digest-activity.json/window-state.json（低价值）、shadow-git/browser-profile/logs/backups（排除项）、sync-state.json（引擎状态）
