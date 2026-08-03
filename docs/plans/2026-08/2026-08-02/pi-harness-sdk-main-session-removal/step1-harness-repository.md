---
step: 1
title: 验证 Harness 依赖与会话仓库
status: pending
---

## 目标

接入并以实际类型验证 AgentHarness API，建立唯一的、按工作区隔离的 Harness session repository，覆盖创建、打开、删除和 fork 的基础操作。

## 依赖上下文（接力棒输入）

- 当前 pi 主会话以裸 `Agent` 运行，入口在 `electron/main/agents/pi-session/pi-session.ts`。
- 当前 PiSession 无持久化，`getSdkSessionId()` 固定返回 `undefined`；PiSessionManager 仅维护进程内 `sessionId → PiSession` 映射，见 `electron/main/agents/pi-session/pi-session-manager.ts`。
- 新 session 文件目标路径为 `<configDir>/workspaces/<workspaceId>/sessions/<sessionId>.jsonl`。
- 本步骤必须以已安装 Harness 版本的源码和 TypeScript 类型为准；调研文档中的 API 名称不能直接假定正确。

## 计划改动

- [ ] 检查当前 `package.json`、lockfile 与已安装包版本，补充 AgentHarness 所需依赖；仅使用 Bun 管理依赖。
- [ ] 查阅已安装 `@earendil-works/pi-agent-core` 的 AgentHarness、JsonlSessionRepo、JsonlSessionStorage 与 FileSystem 类型定义，记录实际的 create/open/list/delete/fork、事件订阅、flush 和 hook API。
- [ ] 新建 `electron/main/agents/pi-session/pi-session-repository.ts`，封装按 workspaceId 获取 repo、创建 session、打开 session、删除 session、fork session 和解析 session 文件路径的操作。
- [ ] repository 不返回给 TIPC 或 renderer 的 Harness 原始类型；对外仅暴露 Dogear 自定义的 session ID、路径和必要的内部 adapter 类型。
- [ ] 确定 repository 初始化所需 FileSystem 实现；复用现有 `WorkspaceExecutionEnv` 仅在其职责和 Harness FileSystem 契约匹配时，否则新增最小的 config-dir 文件系统适配器。
- [ ] 添加可执行的最小验证流程：create 后确认 JSONL 落在预期目录；open 可恢复同一 session；fork 与 delete 的真实行为符合后续需求。
- [ ] 执行 `bun run build:electron`。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 实际 Harness 初始化与事件订阅签名：
- repository 公开方法及参数：
- session create/open 后可获得的对象和持久化时机：
- hook 的确切签名、阻断与参数改写能力：
- 下个 step 入口：
- 待办或已知限制：
