# 设备同步数据语义分类与真空地带补齐 实施计划

**目标**：tasks.json / 文章库补进设备同步（真空地带补齐），settings 字段按白名单传播制治理（机器亲和不再跨端），同步范围 UI 分组 + 用户可勾选工作区子树同步。

**架构思路**：按写入者裁决同步语义（应用数据默认同步 / 用户文件默认不动可勾选 / 生成物排除）；工作区数据经 `__ws-external__/{wsid}/` 虚拟路径进同步协议（backup-service 同形式先例），wsid 经 workspace-map per-peer 映射翻译；settings 三方合并改白名单传播制。设计全文见 [../sync-data-semantics-design.md](../sync-data-semantics-design.md)，各步骤引用其 § 节号。

**涉及模块**：`electron/main/services/data-registry.ts`、`sync/`（manifest / apply / push-guard / protocol / workspace-map / orchestrator）、`task-store.ts`、`settings-types.ts`、`settings-service.ts`、`app/data-center/sync-settings.tsx`

## 步骤索引

- [x] [Step 1: 数据层地基（registry 补录 + settings 模型）](./step1-registry-settings-model.md) — registry 补 ws-tasks/ws-articles 同步项，syncOptions 加 userSyncPaths，立传播白名单常量
- [x] [Step 2: task-store planPath 相对化](./step2-planpath-relative.md) — 存相对路径 + version 2→3 存量迁移，读写两侧 resolve
- [x] [Step 3: 虚拟路径进清单与映射](./step3-manifest-virtual-paths.md) — 协议版本 +1，buildManifest 收虚拟条目，wsid 翻译，旧版本 gating
- [x] [Step 4: 虚拟路径落盘与守卫 + tasks 条目合并](./step4-apply-guard-merge.md) — apply 反解落盘、push-guard 放行、MERGE_PATTERNS 加 tasks.json、orchestrator 流转
- [x] [Step 5: settings 白名单传播制](./step5-settings-propagation.md) — 逐字段核对定稿分类表，mergeFieldsThreeWay 改白名单合并
- [x] [Step 6: UI 分组与用户勾选](./step6-ui-grouping-picker.md) — 同步范围分组展示 + 新开关项 + 目录树勾选
- [x] [Step 7: 收口验证与文档同步](./step7-verify-docsync.md) — 双机手测清单、doc-sync、完成总结

## 完成总结

**实施完成**（2026-10-04，7/7 step，全部验收通过）。全仓 605 tests / 0 fail，build:electron / 前端构建 / lint 全过。

### 实际改动汇总（7 个 commit）

| Commit | 内容 |
|---|---|
| d6675de4 step1 | registry 补 ws-tasks(syncItemId 'tasks')/ws-articles(syncItemId 'articles') 虚拟路径同步项；SyncItemId 扩 14 项；syncOptions.userSyncPaths 模型与清洗；SETTINGS_SYNC_FIELDS 白名单草案（9 项，去已迁移的 enabledToolPacks） |
| b85c3c90 step2 | task-store planPath 相对化：存 posix 相对路径，version 2→3 迁移（withFileLock 内，工作区外保持绝对），读侧 resolvePlanPath 按本端根还原 |
| 2a0e1a73 step3 | 协议 v3→v4；buildManifest 收虚拟条目（registry×注册表×userSyncPaths）；workspace-map 虚拟路径对称折算；旧版本对端双向 gating；tombstone enabled 守卫防误删；server 响应侧过滤；apply 过渡态守卫 |
| c222557a step4 | resolveExternalRelPath 反解原语（防穿越）；apply/server/tombstone 统一落盘读盘入口；push-guard 白名单放行；虚拟 tasks.json 条目级合并 mergeArrayFile('tasks','id') |
| 6cd75f7a step5 | settings 三方合并改白名单传播制（定稿=草案 9 项，ai 无敏感值）；非白名单含未知字段保本端；无基线退化路径同步改白名单制；基线收敛无振荡 |
| d1de76ba step6 | 同步范围三分组 UI；任务/文章库开关；工作区目录树懒加载勾选（userSyncPaths rev++ 接线，修复合并丢键真空 bug）；git 工作区提示；新增 ws-tree 服务与 2 个 tipc |
| （本次）step7 | revealSyncFile 接虚拟路径（Step 4 遗留）；doc-sync 五分域更新；双机手测清单整理 |

### 与计划偏差

1. SYNC_ITEM_IDS 非代码派生而是手写列表+双侧测试锁定（settings-types 无 electron 依赖不能 import data-registry）
2. 白名单草案去 enabledToolPacks（已迁工作区 config）；定稿=草案 9 项无增删
3. Step 3 计划外配套 4 处：server 响应侧 gating / apply 过渡态守卫 / tombstone enabled 守卫（数据安全）/ lan-sync-service userSyncPaths 接线
4. Step 4 反解原语落 data-registry（多消费方公共层）而非 apply.ts；guard 额外放行 tasks.json 冲突副本形态
5. Step 5 无基线退化路径同步改白名单制（原 `{...incoming}` 会污染 snapshot/webMcpApiKey）
6. Step 6 git 区未做独立分组改 per-workspace 提示条（多工作区事实无法用独立组表达）；目录大小改勾选时异步统计
7. 行为变化：profiles（AI 供应商 apiKey）不再跨设备，新设备需各配一次；update.serverUrl 跨端传播（同仓发布，将来双机不同源需移出）

### 遗留待办

- **双机手测**（需 Mac 真机，清单 9 项见 step7 交付文档）：任务跨端/条目合并/文章库首轮体积/勾选目录收敛/snapshot 保本端/白名单收敛/旧端垃圾防护/冲突副本定位/删除传播
- 同步引擎直写工作区 tasks.json 不经 task-store withFileLock（与 plans.json 既有竞态模式一致，未扩大处理）
- orchestrator 双端真 HTTP 全链路虚拟条目集成测试未建（各环节单测 + server 端到端已覆盖）
- 生成物自动识别二期（设计明确本期不做）
- 版本 gating 判据 `>= SYNC_PROTOCOL_VERSION`，将来 v5 需重新评估

## 全局决策

- **同步项 id**：新增 `'tasks'`、`'articles'` 两个 SyncItemId（进 disabledSyncItems 语义；isExcluded 对 `__ws-external__/{wsid}/.dogear/tasks.json` 与 `.../.dogear/articles/**` 分别匹配）
- **虚拟路径前缀**：复用 `data-registry.ts` 的 `EXTERNAL_ANCHOR_PREFIX = '__ws-external__'`（单一来源，勿在 sync 模块重写常量）
- **tasks.json 文件版本**：3（planPath 相对化迁移）；迁移在 withFileLock 内做，失败路径保持绝对不回归
- **协议版本**：`SYNC_PROTOCOL_VERSION` +1（Step 3 内改，之后所有步骤按新版本语义）
- **settings 传播白名单**：常量放 settings 层（Step 1 立草案，Step 5 核对定稿）；非白名单字段一律保本端（含未知新字段）
- **安全边界**：虚拟路径反解后的落盘/读盘路径必须仍在该工作区注册路径之下（path resolve 后前缀校验），防穿越
- 主进程改动需 `build:electron`；不写注释，WHY 非显而易见时一行
