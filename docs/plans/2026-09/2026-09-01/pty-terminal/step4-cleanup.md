---
step: 4
title: 一期删除 + 打包善后
status: done
---

## 目标
删除一期卡片流全部残留，打包配置补 node-pty，修过时文档，整体回归。

## 依赖上下文（接力棒输入）
- 前置 step3 产出：新 TerminalPanel/XtermTerminal/terminal-store 已可用（读 step3 实施回填确认一期组件已无引用）
- 一期待删清单位置：`components/companion/TerminalCard.tsx`、`electron/main/services/terminal-stream-service.ts`（含 `terminal-store.test.ts` 旧用例）、`electron/main/tipc/terminal.ts`、`tipc/index.ts` 注册行、`renderer-handlers.ts` 的 `terminalStreamAppend` 事件、`pi-session.ts` 的 `forwardBashTerminalEvent` 方法与 doClose 里的 `terminalClearConversation` 调用（doClose 中 step2 已加 killConversationTerminals，删除旧的时别动新的）

## 计划改动
- [x] 删 `TerminalCard.tsx`、`terminal-stream-service.ts`、`tipc/terminal.ts` + index.ts 注册行、renderer-handlers 的 terminalStreamAppend 类型与广播调用、pi-session 的 forwardBashTerminalEvent 及 terminalClearConversation 引用
- [x] 删旧测试 `stores/terminal-store.test.ts` 中针对已删 store 逻辑的用例（step3 重写时已替换，跳过）
- [x] `bun remove ansi-to-react`（remove 前确认全库无残留 import）
- [x] `electron-builder` 配置：`electron-builder.yml` 新建 `asarUnpack` 段加 `**/node-pty/**`
- [x] `agent.md`：删「Bash 命令的 RTK 包装…」句（实际路径 `.dogear/workspaces/15d3447b…/agent.md`，工作区数据不入 git）
- [x] `docs/codebase-map.md` 同步（doc-sync）：8 处更新（删 TerminalCard/一期服务/terminal 路由条目，加 pty-service/pty 路由/XtermTerminal/新工具/双轨 bash）

## 验证
- [x] `bun run lint` + `bun run build:electron` + `bunx tsc --noEmit` 全绿
- [x] `bun test` 全量通过（264 pass 0 fail 1 skip；一期旧 terminal 测试已清，六符号全库 grep 生产代码零残留）
- [ ] 真机回归：agent 正常对话、快速命令（ls/build）行为与一期前一致、后台命令进终端、无 console 报错引用已删模块——需运行中 Electron 应用，留待用户
- [ ] `bun run dist` 打包产物安装后终端可用（node-pty asarUnpack 生效）——留待发版前验证

## 实施回填（做完后填）

### 实际改动
- 与计划差异（详见共享区 pty/step4-delivery.md）：
  - agent.md 实际在 `.dogear/workspaces/15d3447b…/agent.md`（非项目根，工作区数据不入 git）；AppData 运行时副本属用户数据未动
  - terminal-stream-service.test.ts 实际不存在（一期未写独立测试）
  - pty-service.ts 注释原引「与 terminal-stream-service 同策略」改为独立表述（计划外但必要，否则指向已删模块）
  - dist 两个孤儿产物（terminal.js/terminal-stream-service.js）手动删——tsc 增量不清理，不删会打进安装包
- 改动文件清单：
  - 删除：`components/companion/TerminalCard.tsx`、`electron/main/services/terminal-stream-service.ts`、`electron/main/tipc/terminal.ts`
  - 修改：`tipc/index.ts`（删注册行）、`renderer-handlers.ts`（删事件）、`pi-session.ts`（删旁路与清缓冲，保留 killConversationTerminals）、`pty-service.ts`（注释）、`package.json` + `bun.lock`（ansi-to-react 移除）、`electron-builder.yml`（asarUnpack）、`docs/codebase-map.md`（doc-sync）

### 给下一步的接力棒
- 关键签名 / 数据结构：终端二期全部落地，无后续 step；二期完整接力棒见共享区 pty/step1-4-delivery.md
- 下个 step 该从哪里继续：无（计划收尾）；待办见下
- 待办或已知限制：
  - 真机完整链路回归（agent 后台命令进终端/键盘交互/Ctrl+C/关会话 tab 消失/双窗口同看）与 bun run dist 安装包验证留给用户
  - read_terminal 截断 8KB 首版值待实测调；终端无 TTL 回收（自然退出实例留 Map 到 tab × 或会话清理）
