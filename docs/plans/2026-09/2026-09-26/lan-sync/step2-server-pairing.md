---
step: 2
title: 发现与服务
status: pending
---

## 目标
两台 Dogear 在同局域网互相发现并完成安全配对；HTTP 对等服务可交换握手与清单。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 的 `protocol.ts` 消息 schema（zod）与 `sync-state.ts`
- 关键决策回顾：不自动同步——发现对端有变化只通知，同步必须用户触发

## 计划改动
- [ ] 选型并安装 mDNS 库（bonjour-service 或 @homebridge/ciao，以主进程实测可用+维护活跃为准，二选一后在此回填）
- [ ] 新建 `electron/main/services/sync/discovery.ts`：广播 `_dogear._tcp`（端口=HTTP 服务端口，设备名取 `syncOptions.deviceName` 或 OS 主机名）；browse 对端 → 维护 `peers: PeerInfo[]`（name、ip、port、deviceId、lastSeen），变化时向渲染层广播事件
- [ ] 新建 `electron/main/services/sync/server.ts`：主进程 `http.createServer`——路由：`GET /info`（握手包）、`POST /pair-request`（发起方提交配对码摘要）、`POST /manifest`（交换清单）、`GET /file?path=`（流式取文件，gzip）、`POST /file`（收文件）；全部请求校验设备密钥 header（`/pair-request`、`/info` 除外）
- [ ] 配对流程：A 端发起 → 双方各显示 6 位码（一端生成，用户比对）→ 确认后交换设备密钥（持久化到 settings 的 `syncOptions.pairedDevices`）→ 之后互通。密钥生成：`crypto.randomBytes(32)` hex
- [ ] 设备 ID：首次启动生成 UUID 持久化（放 sync-state.json）
- [ ] 启动集成：`main-app.ts` app ready 后启动 discovery+server（可失败降级：端口占用/mDNS 不可用时面板显示原因，不影响主功能）
- [ ] 验证：Windows 单机自连（localhost 模拟两实例配对）+ 局域网两台 Windows/虚拟机若可行；防火墙拦截场景文案
- [ ] `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
