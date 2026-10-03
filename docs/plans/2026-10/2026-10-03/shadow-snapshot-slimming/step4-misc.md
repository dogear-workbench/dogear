---
step: 4
title: 历史面板空态可解释 + 备份 personal 过滤
status: pending
---

## 目标
文件历史面板对无历史的文件给出可解释空态（区分「从未被编辑」vs「未受快照保护+原因」）；备份不再把 `workspaces/personal/` 当工作区。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step3-settings-ui.md] 阈值/排除目录配置已可在 UI 读取
- 当前关键文件状态：`components/FileHistoryPanel.tsx` 空态目前无区分；`electron/main/services/backup-service/categories.ts:78-87` 的 listWorkspaceIds 直接 readdir
- 关键决策回顾：不做文件树逐文件标记（讨论否决），可解释性收敛在历史面板空态

## 计划改动
- [ ] IPC：新增（或扩展）判断接口——输入文件路径，返回 `{ protected: boolean, reason?: 'size' | 'excluded' | 'disabled' }`（size=超阈值、excluded=命中排除目录、disabled=工作区快照已关）；逻辑放 `shadow.ts` 或 `git-service` 内复用 step1 的过滤判定
- [ ] `components/FileHistoryPanel.tsx`：entries 为空时调上述接口——`protected: true` 显示「该文件从未被编辑过」；`protected: false` 显示「未受快照保护（原因）」；用户 git 源有历史时不受影响（双源合并已有）
- [ ] `electron/main/services/backup-service/categories.ts`：listWorkspaceIds 对照 workspaces.json 注册表（读 `workspaces/` 下 workspaces.json 的已注册 id）过滤掉 `personal` 等未注册目录

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
