# 设备同步数据语义分类与真空地带补齐 实施计划

**目标**：tasks.json / 文章库补进设备同步（真空地带补齐），settings 字段按白名单传播制治理（机器亲和不再跨端），同步范围 UI 分组 + 用户可勾选工作区子树同步。

**架构思路**：按写入者裁决同步语义（应用数据默认同步 / 用户文件默认不动可勾选 / 生成物排除）；工作区数据经 `__ws-external__/{wsid}/` 虚拟路径进同步协议（backup-service 同形式先例），wsid 经 workspace-map per-peer 映射翻译；settings 三方合并改白名单传播制。设计全文见 [../sync-data-semantics-design.md](../sync-data-semantics-design.md)，各步骤引用其 § 节号。

**涉及模块**：`electron/main/services/data-registry.ts`、`sync/`（manifest / apply / push-guard / protocol / workspace-map / orchestrator）、`task-store.ts`、`settings-types.ts`、`settings-service.ts`、`app/data-center/sync-settings.tsx`

## 步骤索引

- [x] [Step 1: 数据层地基（registry 补录 + settings 模型）](./step1-registry-settings-model.md) — registry 补 ws-tasks/ws-articles 同步项，syncOptions 加 userSyncPaths，立传播白名单常量
- [ ] [Step 2: task-store planPath 相对化](./step2-planpath-relative.md) — 存相对路径 + version 2→3 存量迁移，读写两侧 resolve
- [ ] [Step 3: 虚拟路径进清单与映射](./step3-manifest-virtual-paths.md) — 协议版本 +1，buildManifest 收虚拟条目，wsid 翻译，旧版本 gating
- [ ] [Step 4: 虚拟路径落盘与守卫 + tasks 条目合并](./step4-apply-guard-merge.md) — apply 反解落盘、push-guard 放行、MERGE_PATTERNS 加 tasks.json、orchestrator 流转
- [ ] [Step 5: settings 白名单传播制](./step5-settings-propagation.md) — 逐字段核对定稿分类表，mergeFieldsThreeWay 改白名单合并
- [ ] [Step 6: UI 分组与用户勾选](./step6-ui-grouping-picker.md) — 同步范围分组展示 + 新开关项 + 目录树勾选
- [ ] [Step 7: 收口验证与文档同步](./step7-verify-docsync.md) — 双机手测清单、doc-sync、完成总结

## 全局决策

- **同步项 id**：新增 `'tasks'`、`'articles'` 两个 SyncItemId（进 disabledSyncItems 语义；isExcluded 对 `__ws-external__/{wsid}/.dogear/tasks.json` 与 `.../.dogear/articles/**` 分别匹配）
- **虚拟路径前缀**：复用 `data-registry.ts` 的 `EXTERNAL_ANCHOR_PREFIX = '__ws-external__'`（单一来源，勿在 sync 模块重写常量）
- **tasks.json 文件版本**：3（planPath 相对化迁移）；迁移在 withFileLock 内做，失败路径保持绝对不回归
- **协议版本**：`SYNC_PROTOCOL_VERSION` +1（Step 3 内改，之后所有步骤按新版本语义）
- **settings 传播白名单**：常量放 settings 层（Step 1 立草案，Step 5 核对定稿）；非白名单字段一律保本端（含未知新字段）
- **安全边界**：虚拟路径反解后的落盘/读盘路径必须仍在该工作区注册路径之下（path resolve 后前缀校验），防穿越
- 主进程改动需 `build:electron`；不写注释，WHY 非显而易见时一行
