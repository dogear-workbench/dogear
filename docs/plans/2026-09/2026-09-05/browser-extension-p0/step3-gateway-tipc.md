---
step: 3
title: browser-gateway 服务 + tipc 状态接口
status: pending
---

## 目标

主进程 pipe server 收敛 bridge 连接，维护单会话状态机，tipc 提供查询 + 变更推送；假扩展端 node 脚本直连 pipe 全协议走通。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-bridge-pipe.md] bridge 进程会把 NM 帧原样转进 pipe——gateway 收到的就是 NM 帧流（4B 长度 + JSON），gateway 侧要自带解码器
- 当前关键文件状态：tipc 路由集中在主进程 tipc 定义处（参考现有 browser action stream 的推送模式与渲染层订阅方式）；`browser-gateway.ts` 尚不存在
- 关键决策回顾：P0 单会话——新 hello 到来时向旧连接写 goodbye 并 destroy；状态含 extractError 可选字段（跨域页抽取失败不视为连接失败）

## 计划改动

- [ ] 新文件 `electron/main/services/browser/browser-gateway.ts`：
  - `initBrowserGateway()`（app ready 时调用一次）：创建 pipe server `\\.\pipe\dogear-nm-gateway`
  - 连接会话：解码帧 → `hello` 回 `welcome`（appVersion）并**重置状态为已连接**；`tab_snapshot` 更新快照字段；未知 type 忽略 + 日志
  - 状态机：`{ status: 'disconnected' } | { status: 'connected', extensionVersion, tabId, title, url, textPreview, extractError?, connectedAt }`；断连（pipe close）→ disconnected → 广播
  - 广播：EventEmitter `statusChanged`，供 tipc 层订阅转发渲染层
- [ ] tipc：`browser.getExtensionStatus()`（查询）+ 状态变更推送（对齐现有 action stream 的推送通道与渲染层订阅惯例，实施时看现有实现选型）
- [ ] 验证（dev 下）：临时 node 假扩展脚本直连 pipe 发 hello + tab_snapshot → tipc 查询返回 connected 状态；脚本退出 → 状态回 disconnected（脚本跑完删）
- [ ] `bun run build:electron` / lint 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
