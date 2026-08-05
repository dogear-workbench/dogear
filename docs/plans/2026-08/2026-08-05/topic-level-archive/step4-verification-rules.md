---
step: 4
title: 完整性验收与规则固化
status: pending
---

## 目标

验证归档/删除迁移的所有持久化与 UI 边界，并将删除类改动的覆盖范围固化为项目规则。

## 依赖上下文（接力棒输入）

- 前置 step 产出：话题归档与删除统一经过生命周期协调层；UI 不再暴露单会话归档。
- 验收重点不是“列表消失”，而是 conversations 索引、Harness/旧 SDK 历史、usage、groups、tree、smart categories、digest/background/shared 目录均符合操作语义。

## 计划改动

- [ ] 用隔离的 `.dogear` 测试数据或可恢复备份验证：单会话删除、最后会话删除、话题归档/恢复、话题永久删除、运行中归档、旧归档迁移、重复迁移。
- [ ] 对每个场景检查 JSON 索引、会话文件、用量 JSONL、`conversation-tree.json`、`smart-categories.json`、`groups/<groupId>/` 和左侧三个视图。
- [ ] 搜索并移除旧 API、`archivedAt` 产品语义、`ArchivePanel`、单会话归档文案及遗留调用；保留仅为迁移读取所需的最小兼容代码并标明删除条件。
- [ ] 运行 `bun run lint`、`bun run build:electron`、`bun run build`，记录既有 warning 与新增错误的区别。
- [ ] 新建 `.claude/rules/data-lifecycle.md`：要求删除/归档/迁移改动先列出索引、文件、引用、运行时、重复执行五类影响面和验收矩阵。
- [ ] 更新 `.claude/rules/codebase-map.md` 与相关项目文档，注明归档唯一粒度为话题及其关键入口。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
