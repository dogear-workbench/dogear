---
step: 3
title: 基础工具接入
status: done
---

## 目标

让 pi 会话具备真实可用的编码能力：文件读写编辑 + Bash + 搜索（Read/Write/Edit/Bash/Grep/Glob）+ 常驻的 `dogear-memory` 工具（RecallMemory/SaveMemory/ForgetMemory）。补全 `tool_use`/`tool_result` 两种 `ExtendedSessionMessage` 类型的转换。验收：pi 会话里能让模型读一个文件、改一行代码、跑一个 bash 命令、查一条记忆，前端正确显示工具调用过程和结果。

## 依赖上下文（接力棒输入）

- **前置产出**：[step1-walking-skeleton.md] 的 `PiSession` 骨架、[step2-skill-loader.md] 的工具列表组织方式（`createSkillTool` 之类，本步骤继续往同一个工具列表里加）。
- **关键调研结论（来自设计讨论，务必先重新确认再动手，pi 包可能已更新）**：`node_modules/@earendil-works/pi-agent-core/dist/harness/tools/read.js` 的 `createReadTool(options)` 是**独立于 `AgentHarness` 的工厂函数**（只 import `typebox`/`../types.js`/`utils/truncate.js`/`./image.js`/`./path-utils.js`，不 import `agent-harness.js`），产出的对象形状是 `{ name, label, description, parameters(TypeBox schema), execute(toolCallId, args, signal, onUpdate, { env }) }`——这已经是 pi `AgentTool` 期望的形状，理论上可以**不经过 `ToolDef`/zod 中间层，直接产出**。`bash.js`/`edit.js`/`write.js` 大概率是同样模式（**执行本步骤时先重新读一遍这几个文件确认**，不要凭本记录假设）。
- **需要先调研清楚的点（本步骤的第一件事，不是直接开始写业务代码）**：
  1. `createReadTool`/`createBashTool` 等工厂函数期望的 `env` 参数是什么接口（`readBinaryFile`/`writeFile` 等方法签名），dogear 需要写一个适配对象把这些方法接到真实文件系统 + 工作区路径边界校验（参考 `electron/main/services/workspace-fs-service.ts` 的安全路径验证逻辑，不能让 pi 会话绕过工作区边界读写任意文件）
  2. 这些工厂函数是否有除 `env` 外的其他隐藏依赖（比如权限检查回调、日志），执行前完整读一遍 `read.js`/`bash.js`/`edit.js`/`write.js`/`path-utils.js`/`truncate.js` 源码
  3. 如果调研后发现直接复用比预想的麻烦（比如 `env` 接口面很大、深度耦合 harness 的其他假设），退回到"自己写一个精简版 Read/Write/Edit/Bash/Grep/Glob 工具"（用 `ToolDef`/zod 走 `toPiTools`），不要在这上面死磕——这几个工具功能本身不复杂（文件 IO + 子进程），自己写的成本可控
- **`dogear-memory` 工具复用**：`electron/main/agents/tools/memory-tools.ts` 已经是阶段一中立化后的 `ToolDef[]` 形状（RecallMemory/SaveMemory/ForgetMemory），设计文档"回归红线"提到这个文件**主会话也在用**、`toSdkServer` 产出不能变——本步骤只是新增消费方（`toPiTools`），不能动这个文件本身的 `ToolDef` 定义。
- **Grep/Glob**：SDK 侧这两个是 CLI 内置工具，pi/harness 没有对应现成实现（`harness/tools/` 目录下只确认了 read/bash/edit/write/image，Grep/Glob 需要调研是否存在同名文件，若没有则自己写——用 Node 的 `fs`/现有项目里可能已引入的 glob 库，检查 `package.json` 是否已有 `fast-glob` 之类依赖可以直接用，避免新增依赖）

## 计划改动

- [x] 调研 `harness/tools/*.js` 的 `env` 接口面和其他依赖，决定"直接复用工厂函数"还是"自己写"，并记录决策理由
- [x] 新建 `electron/main/agents/pi-session/builtin-tools.ts`（或按调研结果决定文件组织）：实现/适配 Read/Write/Edit/Bash/Grep/Glob，产出 pi `AgentTool[]` 或 `ToolDef[]`（视上一步决策）
- [x] 工作区路径边界校验：确保这些工具的文件操作被限制在会话所属的工作区路径内，参考 `workspace-fs-service.ts` 现有的路径安全检查方式
- [x] `pi-session.ts` 组装工具列表时合并：`builtin-tools` + `skill-loader` 产出的 `Skill` 工具 + `toPiTools(memoryToolDefs)`
- [x] `message-converter.ts`（Step 1 产出）补充 `tool_use`/`tool_result` 两个分支的转换逻辑，对齐 `ExtendedSessionMessage` 里 `toolName`/`toolInput`/`toolOutput`/`toolUseId`/`isError` 字段
- [x] 手测：读文件、改文件、跑 `bun run lint` 之类命令、查一条已有记忆，确认前端工具卡片正确展示

## 实施回填（做完后填）

### 实际改动

**决策：Read/Write/Edit/Bash 直接复用 pi-agent-core 官方 harness 工厂函数，不自己写。**

调研发现两个关键事实推翻了"自己写更省事"的预设：
1. `createReadTool`/`createWriteTool`/`createEditTool`/`createBashTool` 全部从包的**主入口** `@earendil-works/pi-agent-core` 公开导出（`dist/index.js` 里 `export * from "./harness/tools/index.js"`），不是深路径 hack。
2. 包还从 `@earendil-works/pi-agent-core/node` 公开导出了 `NodeExecutionEnv`——一个跨平台的完整 `ExecutionEnv`（`FileSystem & Shell`）实现，覆盖了 Windows 下找 Git Bash、路径解析、截断安全读写、mutation queue 等一整套已验证逻辑。这几个工厂函数唯一需要的隐藏依赖就是 `execute(...,  { env })` 里的 `env: ExecutionEnv`，没有权限回调、没有日志钩子，也不依赖 `AgentHarness`/`Session` 状态机。

于是把"自己写 Read/Write/Edit/Bash"变成了"写一层带工作区边界校验的 `ExecutionEnv` 装饰器"，工作量小得多且更安全（复用了官方的 bash 跨平台探测，本机是 Windows，这块自己写风险最高）。`typebox` 不是 dogear 的直接依赖（`node -e "require.resolve('typebox')"` 在项目根目录下解析失败），所以适配层用 `any` + eslint-disable 桥接，不引入新依赖。

Grep/Glob 在 harness 里没有对应工厂，项目也没有 glob 库依赖，按计划手写（Node 原生 `fs` 递归 + 手写 glob→正则转换），走既有 `ToolDef`/zod 约定。

**新增文件：**
- `electron/main/agents/pi-session/workspace-boundary.ts` —— `resolveWithinWorkspace(workspacePath, candidatePath)`：先做 `path.relative` 语法穿越校验，再对已存在的最近祖先路径做 `fs.realpath` 校验防符号链接逃逸。Read/Write/Edit/Bash 和 Grep/Glob 共用这一份。
- `electron/main/agents/pi-session/workspace-execution-env.ts` —— `WorkspaceExecutionEnv implements ExecutionEnv`，包一层 `NodeExecutionEnv`，所有带路径参数的方法先过 `resolveWithinWorkspace` 再委托；`exec()` 额外校验 `options.cwd`（尽管 bash 工具本身总是传 `env.cwd`，这里是纵深防御）；`createTempDir`/`createTempFile` 直接透传（临时文件本就落在系统 tmp 目录，不是工作区内容）。
- `electron/main/agents/pi-session/builtin-tools.ts` —— `createBuiltinFileTools(workspacePath): AgentTool[]`，`wrapHarnessTool()` 把 harness 工具 5 参 `execute(...,context)` 绑好 `{ env }` 转成 pi 原生 4 参 `AgentTool.execute`。
- `electron/main/agents/pi-session/search-tools.ts` —— `createSearchToolDefs(workspacePath): ToolDef[]`（Glob + Grep）。遍历时永远跳过 `node_modules`/`.git`/`.dogear`，遇到符号链接（文件或目录）一律跳过不 follow；Grep 复用 pi-agent-core 公开导出的 `truncateLine`/`GREP_MAX_LINE_LENGTH` 保持截断口径一致；两者都有文件数/匹配数上限防止在大仓库里跑爆。

**修改的文件：**
- `pi-session.ts`：`PiSessionConfig` 加了必填 `workspacePath: string`；`start()` 里工具列表变成 `[...createBuiltinFileTools(workspacePath), ...toPiTools([skillTool, ...searchToolDefs, ...memoryToolDefs])]`。
- `message-converter.ts`：`convertPiEvent` 新增两个 `AgentEvent`（顶层事件，不是 `assistantMessageEvent`）分支：`tool_execution_start` → `{type:'tool_use', toolName, toolInput: args, toolUseId: toolCallId}`；`tool_execution_end` → `{type:'tool_result', toolUseId: toolCallId, toolOutput: <从 result.content 里提取的纯文本>, isError}`。
- `conversation-runtime-service.ts`：`attachPiConversation` 加了 `workspaceId` 参数（调用点 `attachConversation` 一并传入），内部用已有的 `workspaceJsonService.getById(workspaceId)` 解析出 `workspace.path` 传给 `piSessionManager.createSession`，与 SDK 侧 `buildConversationSessionConfig` 拿 workspacePath 的方式完全一致。

**未改动**：`memory-tools.ts`（只新增了 `toPiTools(createMemoryToolDefs(...))` 这一个消费方，`ToolDef` 定义和 `toSdkServer` 产出都没动）、`workspace-fs-service.ts`（新工具用的是独立的、带符号链接检测的 `resolveWithinWorkspace`，比 `resolveAndValidate` 多一层防御，两者并存不冲突）、`.claude/` 目录（完全没碰）。

**验证**：`bun run build:electron` 0 错误；`bun run lint` 0 error / 83 个既有 warning（未增加，新文件全部干净）。手测用临时冒烟脚本（跑完即删，未提交）覆盖了 15 项：Write/Read/Edit/Bash 基本读写改跑通、Glob 递归匹配、Grep 正则匹配多文件、RecallMemory 空结果不报错、SaveMemory 后 RecallMemory 能查到、`../` 路径穿越拒绝、绝对路径逃逸拒绝、**Windows junction 模拟符号链接逃逸拒绝**（真实验证了 realpath 防御，不是只有理论覆盖）、Bash 的 cwd 确实落在工作区目录、`convertPiEvent` 对 `tool_execution_start`/`tool_execution_end` 的转换正确。15/15 通过。

### 给下一步的接力棒

**工具列表组装的最终代码结构**（`pi-session.ts` `start()` 内）：

```ts
const toolDefs = [
  createSkillTool(skillEntries),
  ...createSearchToolDefs(this.config.workspacePath),   // Grep, Glob
  ...createMemoryToolDefs(this.config.workspacePath),   // RecallMemory, SaveMemory, ForgetMemory
];
const tools = [...createBuiltinFileTools(this.config.workspacePath), ...toPiTools(toolDefs)];
// tools: AgentTool[]，塞进 new Agent({ initialState: { systemPrompt, model, tools } })
```

- `createBuiltinFileTools` 产出的是**原生 `AgentTool[]`**（Read/Write/Edit/Bash，harness 工厂函数包了一层 env 绑定），不经过 `ToolDef`/`toPiTools`。
- 其余工具统一走 `ToolDef` → 一次 `toPiTools([...])` 转换，延续 Step 2 定下的"一次性转换、一次性赋值"约定。
- **Step 4 的 `beforeToolCall` 拦截点**：当前 `pi-session.ts` 用的是 `new Agent({ initialState: {...}, streamFn })`（`Agent` 类，不是 `AgentHarness`），`beforeToolCall` 是 `agent-loop.js` 里 `AgentLoopConfig` 的字段（`prepareToolCall` 函数会在校验完参数后调用 `config.beforeToolCall`），不是 `Agent` 构造参数——需要确认 `Agent` 类的 `prompt()`/构造选项里有没有透传 `AgentLoopConfig`（`agent.ts`/`agent-loop.ts` 是 pi-agent-core 的核心文件，不在 harness 目录下，Step 4 执行时应该先读一遍 `dist/agent.js`/`dist/agent-loop.d.ts` 确认 `Agent` 是否暴露了这个配置口子，而不是假设它能直接传）。权限卡片渲染可以复用 `message-converter.ts` 里 `tool_execution_start`/`tool_execution_end` 已经打通的 `toolUseId` 关联逻辑。
- Bash 工具当前没有沙箱（等同现有 SDK 侧 Bash 工具的信任边界），只保证 `cwd` 落在工作区内；Step 4 如果要对 Bash 做命令级别的权限确认，挂载点是 `beforeToolCall` 里按 `toolCall.name === 'bash'` 分流，不需要改 `builtin-tools.ts` 本身。
- `WorkspaceExecutionEnv`/`resolveWithinWorkspace` 是文件类工具专用的边界校验，与前端文件树用的 `workspace-fs-service.resolveAndValidate` 是两套独立实现（后者没有符号链接检测），如果之后要统一，需要评估会不会影响现有文件树的行为——本步骤没有改动 `workspace-fs-service.ts`。
