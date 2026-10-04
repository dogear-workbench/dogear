---
step: 6
title: UI 分组与用户勾选
status: done
---

## 目标
同步范围设置页分组展示（应用数据 / 用户文件勾选树 / 生成物置灰 / git 区提示），新增「任务」「文章库」开关，接通 userSyncPaths 读写。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.5（userSyncPaths/rev-LWW）、§2.6（分组 UI）
- 前置 step 产出：[step1-registry-settings-model.md] userSyncPaths 模型与 SYNC_ITEM_IDS 扩展；[step4-apply-guard-merge.md] 虚拟路径端到端已通
- 现状：`app/data-center/sync-settings.tsx` 已有 12 项开关列表（stocks/feishu 从独立键迁入统一列表的先例）；「同步范围」分组已有
- UI 文案要点：git 区提示「走你自己的 git」不可勾；生成物组置灰注明「自动识别二期」；用户文件组提示「勾选的目录将跨设备同步，敏感文件请勿勾选」；文章库/任务开关说明「工作区 .dogear 下的任务与文章数据」

## 计划改动
- [x] `app/data-center/sync-settings.tsx`：开关列表加「任务」「文章库」两项（走 disabledSyncItems，rev++）；新增分组结构
- [x] 新增工作区目录树勾选组件（大目录懒加载）：读 userSyncPaths 勾选态、切换写 setSyncOptions（rev++）；目录大小展示（提醒误勾巨型目录）
- [x] git 区检测（workspace.path 下有 `.git`）展示提示组
- [x] 渲染层确认走既有 IPC（setSyncOptions / workspace 列表），无新 IPC 路由则不碰 tipc
- [x] 手动验证：开关与勾选落盘正确、rev 递增、重启后状态保持

## 实施回填（做完后填）

### 实际改动
- 与计划差异：git 区提示未做独立分组，改为用户文件组内 per-workspace 提示条（多工作区下有的有 git 有的没有，独立组无法表达；「走你自己的 git」文案与不可勾语义均符合设计）；目录大小改为勾选时异步统计（列出时不递归，与懒加载不矛盾），2 万文件截断；手动验证项已全部改为自动化测试（app/ 下无组件测试基建，纯函数 + store/IPC 层覆盖）
- 改动文件清单：electron/main/services/settings-service.ts（applySyncOptionsPatch 加 userSyncPaths + rev 判定）；electron/main/services/sync/apply.ts（computeMergedSettings rev 组补 userSyncPaths——原实现重建 syncOptions 时该键缺失，一轮合并后勾选会被清空，本步修复）；electron/main/tipc/sync.ts（setSyncOptions 防呆放行 userSyncPaths + 新增 getSyncWorkspaceDir/getSyncWorkspaceDirStats）；新文件 electron/main/services/sync/ws-tree.ts（单层列目录/子树规模统计/.git 检测，段级防穿越）；electron/main/services/settings-types.ts（tasks/articles 文案「工作区 .dogear 下的任务/文章库数据」）；新文件 app/data-center/user-sync-paths.ts（勾选纯函数）；新文件 app/data-center/sync-user-paths-tree.tsx（懒加载树 + 三态 Checkbox + 大小统计提醒）；新文件 app/data-center/sync-user-paths.tsx（工作区选择 + 敏感提示 + 保存）；app/data-center/sync-settings.tsx（应用数据/用户文件/生成物 三组结构）；测试：sync-options-merge.test.ts 扩展 + 新文件 app/data-center/user-sync-paths.test.ts

### 给下一步的接力棒
- 关键签名 / 数据结构：tipc getSyncWorkspaceDir({workspaceId, relPath?}) → {hasGit, entries: SyncTreeNode[], error?}；getSyncWorkspaceDirStats({workspaceId, relPath}) → {fileCount, totalBytes, truncated, error?}；勾选语义 = 列表条目整树声明（祖先在列则子孙冗余），纯函数在 app/data-center/user-sync-paths.ts
- 下个 step 该从哪里继续：userSyncPaths 端到端已全通（UI 写 rev++ → rev-LWW 合并 → manifest 收集 → push guard 放行），Step 7 收口可做双机实测：Win 勾选 → 同步 → Mac 确认勾选状态与文件落地一致
- 待办或已知限制：① settings 层 normalize 只做形态清洗，.. 段穿越由 manifest/push-guard 层防御（与 Step 4 分层一致）；② 目录统计 2 万文件截断后 totalBytes 不完整（UI 已有文案）；③ 生成物自动识别二期。详细交付：共享区 step6-delivery.md
