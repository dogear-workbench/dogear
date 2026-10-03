---
step: 4
title: 历史面板空态可解释 + 备份 personal 过滤
status: done
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
  - 判定逻辑落在独立纯函数模块 `git-service/shadow-protection.ts`（不在 shadow.ts 内联），便于单测（shadow-protection.test.ts，11 例）
  - 排除判定逐段匹配含末段：git pathspec `:(exclude)dir` 对同名文件路径同样生效，故文件名与排除目录同名也报 excluded（比计划「任一目录段」更贴合实际保护行为）
  - 备份过滤用 `workspaceJsonService.getAll()` 取注册 id（它自带「personal 即使被误注册也过滤」语义），与 readdir 结果取交集
- 改动文件清单：
  - `electron/main/services/git-service/shadow-protection.ts`（新增，纯函数判定）
  - `electron/main/services/git-service/shadow.ts`（新增 getSnapshotProtection 异步包装）
  - `electron/main/services/git-service/index.ts`（导出新模块）
  - `electron/main/tipc/git.ts`（新增 getSnapshotProtection 路由）
  - `components/FileHistoryPanel.tsx`（空态三分支渲染 + 静默降级）
  - `electron/main/services/backup-service/categories.ts`（listWorkspaceIds 对照注册表过滤）
  - `electron/main/services/git-service/shadow-protection.test.ts`（新增单测）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - IPC：`getSnapshotProtection({ workspaceId, relPath }) → SnapshotProtection | { error }`；`SnapshotProtection = { protected: boolean; reason?: 'size' | 'excluded' | 'disabled' }`（优先级 disabled > excluded > size）
  - 纯函数：`judgeSnapshotProtection(workspaceId, relPath, settings, fileSizeBytes: number | null)`；fileSizeBytes 为 null（文件不存在/非普通文件）不算超限
- 下个 step 该从哪里继续：step5（存量瘦身）在 WorkspaceManagementTab 的「立即瘦身」入口，瘦身服务可复用 shadow.ts 的按工作区串行队列
- 待办或已知限制：
  - 空态判定不看 git 是否缺失/影子仓库是否存在：git 缺失时 protected 文件也显示「从未被编辑过」（轻微不准确，可接受）
  - 判定是静态的：排除规则调整前已入快照的历史仍会展示（符合设计：由「立即瘦身」手动消化）
