---
step: 4
title: 一期删除 + 打包善后
status: pending
---

## 目标
删除一期卡片流全部残留，打包配置补 node-pty，修过时文档，整体回归。

## 依赖上下文（接力棒输入）
- 前置 step3 产出：新 TerminalPanel/XtermTerminal/terminal-store 已可用（读 step3 实施回填确认一期组件已无引用）
- 一期待删清单位置：`components/companion/TerminalCard.tsx`、`electron/main/services/terminal-stream-service.ts`（含 `terminal-store.test.ts` 旧用例）、`electron/main/tipc/terminal.ts`、`tipc/index.ts` 注册行、`renderer-handlers.ts` 的 `terminalStreamAppend` 事件、`pi-session.ts` 的 `forwardBashTerminalEvent` 方法与 doClose 里的 `terminalClearConversation` 调用（doClose 中 step2 已加 killConversationTerminals，删除旧的时别动新的）

## 计划改动
- [ ] 删 `TerminalCard.tsx`、`terminal-stream-service.ts`、`tipc/terminal.ts` + index.ts 注册行、renderer-handlers 的 terminalStreamAppend 类型与广播调用、pi-session 的 forwardBashTerminalEvent 及 terminalClearConversation 引用
- [ ] 删旧测试 `stores/terminal-store.test.ts` 中针对已删 store 逻辑的用例（step3 重写时若已替换则跳过）
- [ ] `bun remove ansi-to-react`（确认全库无残留 import）
- [ ] `electron-builder` 配置（package.json build 段或 electron-builder.yml）：`asarUnpack` 加 `**/node-pty/**`（.node 原生模块）
- [ ] `agent.md`：删「Bash 命令的 RTK 包装由 pi-session 内部自动处理」句（RTK 已随 commit e31c616 移除，调研确认的过时残留）
- [ ] `docs/codebase-map.md` 同步（doc-sync）：删一期终端流服务条目，加 pty-service/pty 路由/XtermTerminal/新工具

## 验证
- [ ] `bun run lint` + `bun run build:electron` + `bunx tsc --noEmit` 全绿
- [ ] `bun test` 全量通过（一期旧 terminal 测试已清）
- [ ] 真机回归：agent 正常对话、快速命令（ls/build）行为与一期前一致、后台命令进终端、无 console 报错引用已删模块
- [ ] `bun run dist` 打包产物安装后终端可用（node-pty asarUnpack 生效）——本机可验则验，验不了标注留给发版前

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
