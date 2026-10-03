---
step: 3
title: 设置页快照状态卡与配置
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
