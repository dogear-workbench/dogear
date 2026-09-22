---
step: 3
title: agent 工具组与历史意识注入
status: pending
---

## 目标
九个 `dogear__Git*` 工具上线（权限分级生效），并在系统提示注入「出方案前先查 git 历史」的意识段——历史感知诉求的落地。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 git-service 全部 API 签名
- 关键现状：工具组范式参考 `agents/tools/task-tools.ts`（defineTool + zod + 末尾 registerTools() 注册元数据）；能力包挂靠参考 `agents/ability-registry.ts`（ABILITY_PACKS + resolveAbilities + TOOL_PACK_TO_ABILITY 反查）；权限 ask 的挂法参考 permission-rules.ts 现有工具包判定链
- 工具 handler 需 workspacePath/workspaceId 注入：确认工具组工厂的注入链（参考 delegation-tools 等带工作区工具的现有做法），git 工具组要同时拿 workspaceId（影子仓库定位）与 workspacePath（用户仓库定位）

## 计划改动
- [ ] `agents/tools/git-tools.ts`（新增）：
  - 只读：`dogear__GitStatus` / `GitDiff`（默认工作区 vs HEAD，可传 ref）/ `GitLog`（relPath? + messageKeyword? 搜索）/ `GitShow`（ref）/ `GitBlame`（relPath）
  - 提交：`dogear__GitCommit`（message 必填，paths? 可选限定）
  - 破坏性：`dogear__GitRevert`（ref + relPath?）——挂 permission ask
  - 影子层：`dogear__GitSnapshotList`（relPath?）/ `GitSnapshotRestore`（ref + relPath?，恢复前自动快照）
  - 末尾 `registerTools()` 注册元数据
- [ ] `ability-registry.ts`：新能力包（如 `workspaceGit`），触发条件=会话有工作区；git 工具组挂 TOOL_PACK 映射
- [ ] 权限：`permission-rules.ts` 把 `dogear__GitRevert` 加入 ask 名单
- [ ] `session-append-templates.ts`：新增 git 历史意识段（条件注入=workspaceGit 包激活）：出方案/改代码前先 `GitLog` 查相关文件与关键词的既有实现与演变，避免重复造轮子；描述双层语义（影子=快照账本、用户仓库=正式历史）与「不 push」边界
- [ ] 验证：dev 里让 agent 查 dogear 仓库「归档功能什么时候加的」→ 走 GitLog；让 agent 改个文件并 GitCommit → 用户仓库 log 出现；GitRevert → 弹权限确认

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
