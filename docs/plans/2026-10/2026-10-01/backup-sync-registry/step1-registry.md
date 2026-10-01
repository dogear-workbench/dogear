---
step: 1
title: data-registry 模块
status: pending
---

## 目标
建立唯一事实源模块：全部数据项定义 + 备份分类源派生 + 同步范围派生，带单测锁定派生输出。

## 依赖上下文（接力棒输入）
- （执行时由上一步/规划回填）规划依据：设计文档 [../backup-sync-registry-design.md](../backup-sync-registry-design.md)「架构 §1」

## 计划改动
- [ ] 新建 `electron/main/services/data-registry.ts`：
  - `DataItem`：`{ id, paths: string[]（相对 configDir）, external?: 'workspace-tasks'（声明 configDir 外）, sensitive?: boolean, mergePolicy: 'file' | 'records' | 'settings-fields', backupCategory?: BackupCategoryKey, syncItemId?: string }`
  - 数据项全集（对照审计范围表）：`workspaces/<id>/{notes/, groups/, groups.json, conversations.json, config.json, agent.md, memory/, sessions/}`、`memory/`、`conversations/`、`settings.json`、`plans.json`、`notifications.json`、`login-accounts.json`、外部 tasks.json、`usage/`、`article-parser/`、`site-knowledge/`、`run-history/`、`stocks/`、`feishu/`
  - 派生函数：`backupSourcesFor(category, scope): Promise<string[]>`（含外部锚点：读 workspaces.json → 每个 workspace.path/.dogear/tasks.json）、`registrySyncItems()`、`sensitiveRelPaths()`（login-accounts.json 等）
- [ ] 新建 `electron/main/services/data-registry.test.ts`：断言派生输出覆盖审计对照表全部行（特别是 tasks 外部路径、groups.json 归属 notes-groups、app-config 四文件）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
