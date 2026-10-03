---
step: 3
title: 设置页快照状态卡与配置
status: done
---

## 目标
设置-工作区管理 tab：每工作区一张快照状态卡（开关/体积/条数/上次快照时间）+ 全局推荐配置区（阈值/排除目录/窗口）+ 恢复默认。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-retention.md] 裁剪已生效；SnapshotSettings 结构以 step1 回填为准
- 当前关键文件状态：`app/settings/WorkspaceManagementTab.tsx` 现为工作区列表管理；`electron/main/tipc/git.ts:86` 已有 `getShadowRepoSizeBytes` 体积上报
- 关键决策回顾：管理入口归设置页，文件树零改动；「立即瘦身」按钮本步不做（step5）

## 计划改动
- [ ] `electron/main/tipc/git.ts`：体积上报扩展为汇总（sizeBytes + 快照条数 + 最近快照时间），或新增 `getShadowSnapshotSummary` 路由；按工作区查询
- [ ] 快照开关 IPC：读写 SnapshotSettings.disabledWorkspaces（复用 settings 读写通道，无需新路由则不加）
- [ ] `app/settings/WorkspaceManagementTab.tsx`：每工作区行内嵌快照状态区（开关 Switch、体积、条数、上次时间）；页面底部或独立 Section 放全局配置（阈值数字输入、排除目录标签编辑、窗口档位选择）
- [ ] 恢复默认按钮：一键将 snapshot 配置还原为 SNAPSHOT_SETTING_DEFAULTS（对齐备份配置的交互习惯，参考 `app/data-center` 备份设置区）
- [ ] 渲染层类型：`types/electron-api` 补对应接口定义

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 渲染层类型不走 types/electron-api 手动接口：types/electron-api.ts 头部注释已声明「IPC 类型安全由 tipc 提供，不再手动定义 API 接口」，改用现有 Extract 推导模式（同 backup-meta.ts）；`SnapshotSettings` 类型由前端 types/settings.ts 从主进程 settings-types `import type` 导入（单一来源不设镜像）
  - formatBytes 复用 `app/data-center/version-backup/backup-meta.ts` 现有导出，不新写第二份；相对时间格式化为 SnapshotWorkspaceCell 本地小函数
  - 保存链路：设置页为防抖自动保存模式（page.tsx local/setLocal → updateSettings），WorkspaceManagementTab 接入该模式传参，与 BehaviorTab/ProfilesTab/SubAgentTab 一致；无新增 settings IPC 路由
  - saveSettings 不做 normalize（仅 loadSettings 链归一化），前端写入时自行 clamp（阈值 ≥1 字节、天数 ≥1、totalDays ≥ recentDays、目录去重）
- 改动文件清单：
  - `electron/main/services/git-service/shadow.ts`：新增 `ShadowSnapshotSummary` 接口 + `getShadowSnapshotSummary(workspaceId, workspacePath)`（rev-list --count + log -1 快速取，复用 enqueue/fileExists/hasShadowHead 封装；git 缺失/仓库不存在降级空统计）
  - `electron/main/tipc/git.ts`：新增 `getShadowSnapshotSummary` 路由（`{ workspaceId } → { snapshotCount, lastTime, sizeBytes } | { error }`，降级风格对齐 getWorkspaceGitSummary）
  - `types/settings.ts`：AppSettings 补 `snapshot?: SnapshotSettings`（import type 自 '@/electron/main/services/settings-types'）
  - `app/settings/SnapshotWorkspaceCell.tsx`（新）：行内快照状态+开关（体积/条数/相对时间；git 缺失时开关禁用）
  - `app/settings/SnapshotConfigSection.tsx`（新）：全局配置区（阈值 MB 输入、排除目录标签式编辑、保留窗口双数字输入、恢复默认按钮带 showConfirm）
  - `app/settings/WorkspaceManagementTab.tsx`：接 local/setLocal props；每工作区行内嵌 SnapshotWorkspaceCell；列表区下方挂 SnapshotConfigSection；快照汇总批量加载（getGitCapability + Promise.all）
  - `app/settings/page.tsx`：WorkspaceManagementTab 传 local/setLocal

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - IPC：`getShadowSnapshotSummary({ workspaceId })` → `{ snapshotCount: number; lastTime: string | null; sizeBytes: number }` 或 `{ error: string }`；前端类型 `Extract<Awaited<ReturnType<typeof client.getShadowSnapshotSummary>>, { snapshotCount: unknown }>`（SnapshotWorkspaceCell.tsx 导出）
  - 配置读写：前端直接改 `settings.snapshot`（结构恒定完整，page.tsx 防抖 500ms 落盘）；主进程 loadSettings 链 normalizeSnapshotSettings 兑底
  - 恢复默认 = `setLocal(prev => ({ ...prev, snapshot: structuredClone(SNAPSHOT_SETTING_DEFAULTS) }))`（含 disabledWorkspaces 清空 = 全部工作区重新开启）
- 下个 step 该从哪里继续：step4 FileHistoryPanel 空态可解释（区分未编辑 vs 不受保护），可读 settings.snapshot 判断原因（超阈值/在排除目录/开关关闭）；step5 「立即瘦身」按钮加在 SnapshotConfigSection（复用 pruneSnapshotHistory + 确认交互）
- 待办或已知限制：
  - 快照开关切换后 summaries 不重拉（开关不影响统计数据，仅影响后续快照行为）；体积/条数变化在下次进设置页时刷新
  - 行内状态加载中显示为空白（拉取很快，未加 spinner）
