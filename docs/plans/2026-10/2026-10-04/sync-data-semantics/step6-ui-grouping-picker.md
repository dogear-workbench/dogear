---
step: 6
title: UI 分组与用户勾选
status: pending
---

## 目标
同步范围设置页分组展示（应用数据 / 用户文件勾选树 / 生成物置灰 / git 区提示），新增「任务」「文章库」开关，接通 userSyncPaths 读写。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.5（userSyncPaths/rev-LWW）、§2.6（分组 UI）
- 前置 step 产出：[step1-registry-settings-model.md] userSyncPaths 模型与 SYNC_ITEM_IDS 扩展；[step4-apply-guard-merge.md] 虚拟路径端到端已通
- 现状：`app/data-center/sync-settings.tsx` 已有 12 项开关列表（stocks/feishu 从独立键迁入统一列表的先例）；「同步范围」分组已有
- UI 文案要点：git 区提示「走你自己的 git」不可勾；生成物组置灰注明「自动识别二期」；用户文件组提示「勾选的目录将跨设备同步，敏感文件请勿勾选」；文章库/任务开关说明「工作区 .dogear 下的任务与文章数据」

## 计划改动
- [ ] `app/data-center/sync-settings.tsx`：开关列表加「任务」「文章库」两项（走 disabledSyncItems，rev++）；新增分组结构
- [ ] 新增工作区目录树勾选组件（大目录懒加载）：读 userSyncPaths 勾选态、切换写 setSyncOptions（rev++）；目录大小展示（提醒误勾巨型目录）
- [ ] git 区检测（workspace.path 下有 `.git`）展示提示组
- [ ] 渲染层确认走既有 IPC（setSyncOptions / workspace 列表），无新 IPC 路由则不碰 tipc
- [ ] 手动验证：开关与勾选落盘正确、rev 递增、重启后状态保持

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
