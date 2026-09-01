---
step: 2
title: bash 双轨 + agent 管理工具 + 生命周期
status: done
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
- [x] `builtin-tools.test.ts` 冒烟（mock pty-service）：同步路径透传参数不变、后台路径返回文本含 terminalId、read_terminal strip-ANSI 与状态、kill_terminal 错误分支
- [x] `bun run lint` + `bun run build:electron` 通过（10 pass 0 fail；全量 bun test 无新增失败，terminal-store 2 fail 为 pre-existing）
- [ ] 真机：跑一个 agent 会话让它「后台启动 bun run dev，然后 read_terminal 看输出」——主进程 console 确认 PTY 创建与广播（UI 要等 step3）——留待 step3 完成后与 UI 联调一并真机验证

## 实施回填（做完后填）

### 实际改动
- 与计划差异（详见共享区 pty/step2-delivery.md）：
  - 错误通道用 throw 而非返回 isError——AgentToolResult 类型无 isError 字段且 agent-loop 硬编码 isError:false，仅 throw 才转 isError:true（与原版 bash 错误通道一致）
  - 子会话白名单靠 bash 联动激活：enabledBasicTools 含 'bash' 时联动 add read_terminal/kill_terminal（Set 仅对用户配置交集过滤，新名字永远不在配置里）
  - 概览/kill 按会话 conversationId 过滤，防 agent 误杀用户 shell；带 id 的 read 不限归属（uuid 不可枚举、只读无害）
  - conversationId 查证：execute context 只有 {env}，走工厂参数闭包注入（workspaceRoots 同批注入，与 env.allowedPaths 同源）
  - 前端工具面板零改动：bash 本就不在 registerTools 注册中心，read_terminal/kill_terminal 呈现方式与 bash 一致
  - stripAnsi 补 CRLF→LF 归一（否则 Windows ConPTY 普通输出整行被 \r 覆盖逻辑误删，测试暴露的真 bug）
- 改动文件清单：
  - 重写 `electron/main/agents/pi-session/builtin-tools.ts`（createPtyBashTool 同名替换 + createReadTerminalTool + createKillTerminalTool + BuiltinFileToolsOptions）
  - 新增 `electron/main/agents/pi-session/builtin-tools.test.ts`（10 用例，mock.module 替换 pty-service）
  - 修改 `electron/main/agents/pi-session/pi-session.ts`（4 处：import / 白名单 Set+bash 联动 / createBuiltinFileTools 注入 conversationId+workspaceRoots / doClose 挂 killConversationTerminals）

### 给下一步的接力棒
- 关键签名 / 数据结构：agent 后台终端的 conversationId = `PiSessionConfig.conversationId`（step3 渲染层「会话」tab 分组、doClose 清理、工具归属校验三方同源）；后台 PTY cols/rows 缺省 80x24；read_terminal 输出格式见交付文档
- 下个 step 该从哪里继续：Step 3 渲染层（terminal-store 重写 + XtermTerminal + TerminalPanel 重写），接口见共享区 pty/step1-delivery.md（tipc 上行六个 procedure + 下行三事件）
- 待办或已知限制：
  - 真机冒烟未做（需运行中应用 + LLM），留待 step3 后 UI 联调
  - read_terminal 截断 8KB 首版值待实测调
  - terminal-store.test.ts 全量跑 2 用例 pre-existing 失败（干净基线复现），step3 重写 store 时顺带消解
  - 一期 forwardBashTerminalEvent 对后台 bash 仍触发 start/end（立即结束无 update），step4 删一期时一并处理
