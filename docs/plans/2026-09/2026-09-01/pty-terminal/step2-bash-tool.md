---
step: 2
title: bash 双轨 + agent 管理工具 + 生命周期
status: pending
---

## 目标
agent 侧接入：bash 工具加 `run_in_background` 分流（同步零改动、后台走 PTY 立即返回），新增 read_terminal/kill_terminal 工具，会话关闭清理其 PTY。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：`pty-service.ts` 的 createTerminal/writeTerminal/killTerminal/getBuffer/listTerminals/killConversationTerminals 签名（读 step1 实施回填的接力棒）
- 关键决策：同名替换而非并存——AgentHarness 对重复工具名抛错（`agent-harness.js:144` validateUniqueNames），做法是**不调用** pi-agent-core 的 `createBashTool()` 原样注册，而是自写同名工具（schema 兼容 command + timeout? + 新增 run_in_background?）
- 权限确认、事件流、`toolName==='bash'` 过滤只认名字，零改动自动生效
- 现状参照：`electron/main/agents/pi-session/builtin-tools.ts:14`（createBashTool 注册处）、`pi-session.ts:423`（tools 数组注入 toolContext env）
- pi-agent-core bash 工具接口：`tool.execute(id, args, signal, onUpdate, context)`，`context.env.cwd` 拿工作目录

## 计划改动
- [ ] `builtin-tools.ts` 重写 bash 工厂为 `createPtyBashTool()`（保持导出名/挂载点不变，减小调用方震动）：
  - schema：command: string、timeout?: number、run_in_background?: boolean
  - description 教 LLM：「跑 dev server/watch/长驻服务时传 run_in_background: true，命令会在后台终端立即启动并持续运行；用 read_terminal 查看输出与状态；其余命令正常同步等待结果」
  - execute 分流：run_in_background falsy → 委托内部创建的原版 `createBashTool()` 实例的 execute（同步路径一行不改）；truthy → pty-service.createTerminal({ conversationId: 从 context 取（见下）, command, cwd: context.env.cwd }) → 返回文本「已在后台终端 #<terminalId> 启动，用 read_terminal 查看输出」
  - conversationId 来源：查 tool execute 的 context 里有没有 conversationId（pi-session 构造工具时的闭包/上下文）；若 context 不带，在 pi-session.ts 组装 tools 时用工厂参数闭包注入本会话 conversationId（builtin-tools 工厂加参数）
- [ ] `builtin-tools.ts` 新增 `createReadTerminalTool()` / `createKillTerminalTool()`：
  - read_terminal：入参 terminalId?（不传=listTerminals 概览）；返回 strip-ANSI 尾部文本（自写 ~30 行：去 CSI/OSC 序列 + \r 处理）+ 状态行（running / exited with code N）+ 尾部截断上限（先 8KB，实测调）
  - kill_terminal：killTerminal(id)，返回确认文本；未知 id 返回 isError: true（项目硬决策：工具错误返回 isErrue 不抛异常——注意拼写 isError）
  - 两个工具同 bash 一起进 tools 数组；`computeSubAgentActiveTools` 的 BUILTIN_FILE_TOOLS 白名单加 'read_terminal'/'kill_terminal'
- [ ] `pi-session.ts` doClose()：调 `killConversationTerminals(conversationId)`（紧挨现有 terminalClearConversation 调用处；一期删除在 step4，此处只加不清）
- [ ] 前端工具面板呈现：查 bash 当前是否出现在工具列表（registerTools/getRegisteredTools 链路），read_terminal/kill_terminal 与 bash 保持一致

## 验证
- [ ] `builtin-tools.test.ts` 冒烟（mock pty-service）：同步路径透传参数不变、后台路径返回文本含 terminalId、read_terminal strip-ANSI 与状态、kill_terminal isError 分支
- [ ] `bun run lint` + `bun run build:electron` 通过
- [ ] 真机：跑一个 agent 会话让它「后台启动 bun run dev，然后 read_terminal 看输出」——主进程 console 确认 PTY 创建与广播（UI 要等 step3）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
