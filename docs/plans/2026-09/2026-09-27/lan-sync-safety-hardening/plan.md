# LAN 同步安全加固 实施计划

**目标**：堵住 2026-09-27 同步事故暴露的数据安全隐患，并落实用户对同步方向与工作区映射的诉求：① 孤儿导入永不删源目录；② 冲突不自动裁决、提供处理手段（按大类批量 + 回测副本）；③ 同步方向三档、默认仅拉取（对端永不被修改）；④ 记录型 JSON 条目级合并；⑤ 工作区显式映射（首次交接/两端分叉）+ 按工作区选择性同步（全局恒同步）。

**设计**：见 [design.md](./design.md)（问题清单 P1-P4、决策 D1-D5、风险与确认项）。

**涉及模块**：`electron/main/services/sync/`（orchestrator.ts、apply.ts、manifest.ts、protocol.ts、server.ts、client.ts、sync-state.ts）、`electron/main/tipc/sync.ts`、`electron/main/tipc/workspace.ts`、`electron/main/services/workspace-recovery-service.ts`、`stores/sync-store.ts`、`app/data-center/sync-panel.tsx`、`app/data-center/sync-peer-card.tsx`、`app/data-center/sync-result.tsx`、`app/settings/WorkspaceManagementTab.tsx`

## 步骤索引

- [x] [Step 1: 止血——孤儿导入不删目录、冲突挂起待选、同步方向三档](./step1-stopbleed.md)
- [x] [Step 2: 记录型文件条目级合并](./step2-record-merge.md)
- [ ] [Step 3: 工作区映射与选择性同步](./step3-workspace-identity.md)

## 全局决策

- 冲突语义变更：`SyncReport.conflicts` 从「已按 LWW 裁决的文件」改为「**待用户处理的冲突**」（本轮已跳过）；结果面板文案同步改。
- 单侧修改路径（本端未改→pull 覆盖）保持 3-way 正确行为，不动。
- `settings.json` 现有 `mergeIncomingSettings` 并入统一 merge registry，行为不变。
- 同步仍无删除传播（对端删除的文件会被推回），本期不改，design.md 已记录。
- 类型定义若前后端双份（如 SyncReport / RunSyncOptions），两侧手改同步，不引共享模块（沿袭仓库惯例）。

## 依赖关系

step1 与 step2 代码上独立但都动 orchestrator/SyncReport，按序执行避免互相踩；step3 依赖 step2 的记录文件条目合并（分叉收敛靠它）与 step1 的 SyncReport 语义（待映射清单复用报告通道）。
