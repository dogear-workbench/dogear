---
step: 6
title: 共享区 MCP 工具
status: pending
---

## 目标

把共享区能力暴露给 agent：4 个 MCP 工具 `ReadGroupFile` / `WriteGroupFile` / `ListGroupFiles` / `AddGroupReference`。**组上下文（groupId / workspaceId）由 session 框架自动注入，agent 不需要传**。

## 依赖上下文（执行时填）

- 前置 step 产出：[step4] group-shared-service 函数签名 / 路径校验函数 / IPC 列表
- 当前关键文件状态：执行前读 `electron/main/agents/tools/article-tools.ts`（参考 MCP 工具注册模式 + registerTools 调用）/ `electron/main/agents/tools/tool-registry.ts`（注册中枢）/ `electron/main/agents/query-based-session.ts`（看 MCP server 怎么挂载、ctx 怎么传给工具）
- 关键决策回顾：工具名 PascalCase；agent 不传 groupId/workspaceId，由会话框架自动注入

## 计划改动

### 工具实现
- 新增 `electron/main/agents/tools/group-tools.ts`：
  - 创建 `dogear-group` MCP server，注册 4 个工具：
    - `ListGroupFiles`：参数无（或 `{ section?: 'native' | 'references' | 'all' }`，默认 all），返回 `{ native: NativeFileEntry[], references: SharedReference[] }`
    - `ReadGroupFile`：参数 `{ relPath: string }` 或 `{ refId: string }`（discriminated union）。relPath 走 native，refId 走 reference
    - `WriteGroupFile`：参数 `{ relPath: string, content: string }`（只写原生项，引用项是只读引用 workspace 内文件，不允许写）
    - `AddGroupReference`：参数 `{ path: string, label?: string }`（path 必须是 workspace 内绝对路径或相对 workspace 根的路径——选一种约定）
  - 工具内部从 ctx/closure 拿 `workspaceId` + `groupId`，再调 group-shared-service
  - 错误（路径越界/文件不存在/引用项 path 非法）转成工具 error 字符串返回
  - 在文件末尾调用 `registerTools()` 注册元数据（标题/描述/输入 schema），让设置页 IPC 能列出来

### 会话框架接入
- 修改 `electron/main/agents/query-based-session.ts`：
  - 创建 session 时拿 `conversation.groupId` + `conversation.workspaceId`
  - 通过 closure 或 ctx 传给 group-tools server 实例（每个 session 一个实例）
  - 把 group-tools server 加入 MCP servers 列表（默认所有会话启用）

### 工具注册表
- 修改 `electron/main/agents/tools/tool-registry.ts`：
  - 注册新工具元数据（与设置页/代理编辑页联动）
  - 默认启用（IPC `getRegisteredTools` 调用时新工具出现在列表）

## 验证

- `bun run build:electron` / `bun run lint` 通过
- `bun run dev` 启动后：
  - 任意会话发消息让 agent 列出"我们组共享区有什么"，agent 调 `ListGroupFiles` 返回内容
  - 让 agent 写一个 markdown，调 `WriteGroupFile({ relPath: 'notes.md', content: '...' })`，右侧面板刷新能看到
  - 让 agent 调 `ReadGroupFile({ relPath: 'notes.md' })` 能返回内容
  - 试越界路径（`../../escape.md`）→ agent 拿到 error 返回
  - 设置页 / 代理编辑页能看到这 4 个工具

## 实施回填（做完后填）

### 实际改动

### 给下一步的接力棒
- 4 个工具的输入 schema：
- session 框架接入点：
- ctx 注入方式：
- 待办或已知限制：
