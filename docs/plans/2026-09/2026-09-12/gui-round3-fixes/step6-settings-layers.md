---
step: 6
title: 设置保存并退出与分层生效
status: pending
---

## 目标
设置页改「保存并退出」（零重启）；生效分层——纯 UI 即时热更新、agent 启动快照类标脏后下一轮 sendMessage 前重建会话（复用 failover 重建机制）；消灭保存时无差别 closeAll 杀后台会话的问题。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 6 节
- 现状链路：app/settings/page.tsx:145-148 saveToStore(local,{restartSessions:true})+关页 → tipc settings.ts updateSettings 落盘+broadcastSettingsChanged(true)（:27-40）→ 每窗口 restartActiveSessions → closeAll（pi-session-manager.ts:337-352，无差别杀）→ 各窗口 triggerSessionRestart 仅重建当前打开会话（setup-settings-sync.ts:21-29）
- 快照域现状（启动定型，无热 setter）：profiles（apiKey/baseUrl/piWireApi/piModels/apiTimeoutMs/autoCompactPercent）+ ai.effort（pi-session.ts:380-395/498-501）、permissionMode/basicToolPermissions/subAgent.profiles（conversation-runtime-service.ts:100-121，构造时缓存）、timeoutMinutes（派时读）
- 已有热 setter 先例：setPermissionMode（pi-session.ts:1146-1151）、updateWorkspacePaths（:171-174）；setModel 返回 needsRestart（:1195-1212）
- failover 重建先例：同 harnessSessionId 重 open 历史不丢（model-failover.ts:104-107）
- 纯 UI 热更新已就绪：setup-settings-sync.ts:39-58；按次读取天然即时：browserProxyServer 等（browser-tools.ts:151-156）

## 计划改动
- [ ] 渲染层：合并「保存」「保存并重启」为单一「保存并退出」（保存+关设置页）；相关关闭确认弹窗文案核对
- [ ] tipc updateSettings：落盘后 diff 新旧设置——纯 UI 域 → 仅广播 settingsChanged（热更新）；快照域 → 对受影响 PiSession 标脏；删除 restartSessions 参数与 restartActiveSessions/closeAll 触发链（grep closeAll 其他消费方，仅保必要入口）
- [ ] 设置项域映射表：完整枚举设置键 → {ui | perCall | snapshot} 三类，快照域再细分「可热 setter」（permissionMode 走 setPermissionMode）与「需重建」（模型/effort/超时/压缩阈值/basicToolPermissions/subAgent.profiles）
- [ ] PiSession 脏标记：下轮 sendMessage 前检测 → 按新设置重建（复用 failover 路径）；正在跑的轮不打断，跑完下轮生效
- [ ] 验证：改主题即时生效；改模型后下一轮消息用新模型；保存时后台任务/子会话不被杀

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
