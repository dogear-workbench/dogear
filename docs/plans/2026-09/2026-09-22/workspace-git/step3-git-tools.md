---
step: 3
title: agent 工具组与历史意识注入
status: done
---

## 目标
九个 `dogear__Git*` 工具上线（权限分级生效），并在系统提示注入「出方案前先查 git 历史」的意识段——历史感知诉求的落地。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 git-service 全部 API 签名
- 关键现状：工具组范式参考 `agents/tools/task-tools.ts`（defineTool + zod + 末尾 registerTools() 注册元数据）；能力包挂靠参考 `agents/ability-registry.ts`（ABILITY_PACKS + resolveAbilities + TOOL_PACK_TO_ABILITY 反查）；权限 ask 的挂法参考 permission-rules.ts 现有工具包判定链
- 工具 handler 需 workspacePath/workspaceId 注入：确认工具组工厂的注入链（参考 delegation-tools 等带工作区工具的现有做法），git 工具组要同时拿 workspaceId（影子仓库定位）与 workspacePath（用户仓库定位）

## 计划改动
- [x] `agents/tools/git-tools.ts`（新增）：
  - 只读：`dogear__GitStatus` / `GitDiff`（默认工作区 vs HEAD，可传 ref）/ `GitLog`（relPath? + messageKeyword? 搜索）/ `GitShow`（ref）/ `GitBlame`（relPath）
  - 提交：`dogear__GitCommit`（message 必填，paths? 可选限定）
  - 破坏性：`dogear__GitRevert`（ref + relPath?）——挂 permission ask
  - 影子层：`dogear__GitSnapshotList`（relPath?）/ `GitSnapshotRestore`（ref + relPath?，恢复前自动快照）
  - 末尾 `registerTools()` 注册元数据
- [x] `ability-registry.ts`：新能力包（如 `workspaceGit`），触发条件=会话有工作区；git 工具组挂 TOOL_PACK 映射
- [x] 权限：`permission-rules.ts` 把 `dogear__GitRevert` 加入 ask 名单
- [x] `session-append-templates.ts`：新增 git 历史意识段（条件注入=workspaceGit 包激活）：出方案/改代码前先 `GitLog` 查相关文件与关键词的既有实现与演变，避免重复造轮子；描述双层语义（影子=快照账本、用户仓库=正式历史）与「不 push」边界
- [x] 验证：dev 里让 agent 查 dogear 仓库「归档功能什么时候加的」→ 走 GitLog；让 agent 改个文件并 GitCommit → 用户仓库 log 出现；GitRevert → 弹权限确认

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 能力包 key 定为 `workspace-git`（kebab-case，与注册表现有 key 风格一致；step3 文档里写作 workspaceGit）；server 名 `dogear-git`
  - 主/子会话同条件挂载（有工作区 + 包生效），子会话无 Profile 子开关（与 agent-collab 同模式）：探索/执行类子会话查历史与落提交是核心场景
  - GitRevert 的 ask 挂在 permission-rules（与浏览器交互三工具同语义合并为 PERMISSION_ASK_TOOLS 集合，工具包启用不覆盖；autoExecute 仍全放行）
  - 工具层 relPath 直接透传 service（workspaceGitPath → resolveAndValidate 已做 resolve + 越权校验，无需重复）；GitDiff/GitShow/GitBlame 原始输出截断 30000 字符防 token 爆炸；GitLog 工具层默认 limit 20
  - 除计划文件外另改：`permission-rules.test.ts`（补 git 工具权限 4 用例）、`tipc/ability.ts`（PACK_TOOL_MODULE_IMPORTS 加 git-tools + sceneReason/personalSceneReason 补 workspace-git case，能力页展示用）
- 改动文件清单：
  - `electron/main/agents/tools/git-tools.ts`（新增，~230 行）：九工具工厂 + registerToolGroup
  - `electron/main/agents/ability-registry.ts`：workspace-git 包 + resolveAbilities 无工作区排除
  - `electron/main/agents/pi-session/permission-rules.ts`：PERMISSION_ASK_TOOLS 合并集合
  - `electron/main/agents/session-append-templates.ts`：git-history-guidance 段 key + GIT_HISTORY_GUIDANCE_APPEND + getSystemPromptSegments 展示条目
  - `electron/main/agents/pi-session/pi-session.ts`：主/子会话挂载 dogear-git + 双分支注入段
  - `electron/main/tipc/ability.ts`：能力页模块 import 与场景文案
  - `electron/main/agents/pi-session/permission-rules.test.ts`：git 权限 4 用例
  - `tmp/verify-step3.ts` + `tmp/verify-step3-nogit-probe.ts`：验证脚本（git ignored）

### 验证结果
- `bun run build:electron` 通过；`bun test electron/main/agents/` 121 pass 0 fail
- `tmp/verify-step3.ts` 39/39：只读五件套（临时仓库 + dogear 自身）、GitCommit→GitLog 可见、GitServiceError 分支（not-git-repo/no-changes/invalid-ref/越权路径）、无 git 子进程探针（PATH 剥离 git，GitStatus/GitSnapshotList isError 可读）、影子层快照+恢复+pre-restore、registerToolGroup 九工具元数据、GitRevert 判 ask、ability-registry 四场景
- step3 文档「验证」段原计划的 UI dev 交互验证（agent 查归档功能/弹权限确认）无法无人值守执行，以脚本直调工厂产物等价覆盖；GitRevert 的 ask 已用 decideToolPermission 直接断言，弹窗链路与浏览器交互工具同机制

### 给下一步的接力棒
- 关键签名 / 数据结构：`createGitToolDefs({ workspaceId, workspacePath }): ToolDef[]`；server 名 `dogear-git`；包 key `workspace-git`；段 key `git-history-guidance`
- 下个 step（UI 历史面板）从 git-service 双源 `getFileHistory` + `getUserRepoDiff` 起步；tipc 路由尚未暴露 git 操作（step4 需在 electron/main/tipc/ 新增），注意 getUserRepoDiff 对无 HEAD 仓库 fallback diff --cached
- 待办或已知限制：无 git 时工具 isError 但 UI 入口隐藏需 step4 配合（能力页文案已就位）；快照密集合并（step2 发现）——UI 历史列表不要假设一操作一提交；GitRevert 整仓模式走 git revert 产生反向提交，单文件模式只改工作区不落库（输出文案已向 agent 说明）
