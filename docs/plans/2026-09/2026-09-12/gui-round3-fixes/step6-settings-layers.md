---
step: 6
title: 设置保存并退出与分层生效
status: done
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
- [x] 渲染层：合并「保存」「保存并重启」为单一「保存并退出」（保存+关设置页）；相关关闭确认弹窗文案核对
- [x] tipc updateSettings：落盘后 diff 新旧设置——纯 UI 域 → 仅广播 settingsChanged（热更新）；快照域 → 对受影响 PiSession 标脏；删除 restartSessions 参数与 restartActiveSessions/closeAll 触发链（grep closeAll 其他消费方，仅保必要入口）
- [x] 设置项域映射表：完整枚举设置键 → {ui | perCall | snapshot} 三类，快照域再细分「可热 setter」（permissionMode 走 setPermissionMode）与「需重建」（模型/effort/超时/压缩阈值/basicToolPermissions/subAgent.profiles）
- [x] PiSession 脏标记：下轮 sendMessage 前检测 → 按新设置重建（复用 failover 路径）；正在跑的轮不打断，跑完下轮生效
- [x] 验证：改主题即时生效；改模型后下一轮消息用新模型；保存时后台任务/子会话不被杀

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「复用 failover 路径」落为 PiSession 原位重建：不走 detach/attach 销毁重建（那会换 manager sessionId、牵动渲染层 attachment），而是复用其核心机制——start() 内 `repository.open(config.harnessSessionId)` 重开同一 JSONL（历史不丢）。PiSession 对象身份不变，manager 映射/attachment/渲染层订阅零扰动；重建失败回滚旧 adapter 沿用旧配置，发消息不致失败
  - settingsChanged 载荷从 `{restartSessions}` 改为 `null`；conversation-store 的 triggerSessionRestart 保留（failoverNotice 仍在消费），仅移除 settings-sync 侧调用
  - closeAll 仅保留 shutdownPiSessionManager（app 退出）入口；restartActiveSessions 路由整体删除
  - 新增 settings-diff.ts（域映射 + diff + 受影响判定）及单测 settings-diff.test.ts
- 改动文件清单：
  - 新增：electron/main/services/settings-diff.ts、settings-diff.test.ts
  - 主进程：tipc/settings.ts（updateSettings diff 分层 + 删 restartActiveSessions）、main-app.ts（broadcastSettingsChanged 去参）、tipc/renderer-handlers.ts（载荷 null）、pi-session.ts（脏标记 + 原位重建）、pi-session-manager.ts（applySettingsSnapshotDiff）
  - 渲染层：app/settings/page.tsx（单一「保存并退出」）、stores/settings-store.ts、lib/setup-settings-sync.ts、docs/codebase-map.md（两处过时描述）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `diffSettings(prev, next): SettingsSnapshotDiff`（effortChanged / permissionModeChanged / basicToolPermissionsChanged / changedProfileIds / defaultModelSelectionChanged / subAgentProfilesChanged / subAgentProfileIdsChanged）+ `isSessionSnapshotAffected(diff, view, next)` + `hasSnapshotChange(diff)`，在 electron/main/services/settings-diff.ts，域映射表全文见文件头注释与共享区 round3-step6-delivery.md
  - PiSession 新增公开面：`markSnapshotDirty()` / `getRole()` / `getConfigModelSelection()` / `getCurrentModelSelection()` / `getSubAgentProfileId()`；重建入口 `sendMessage` 内 `snapshotDirty && isIdle()` 时调私有 `rebuildForSettingsChange()`
  - PiSessionManager 新增 `applySettingsSnapshotDiff(diff, next)`：permissionMode 走热 setter，其余命中域标脏
  - tipc `updateSettings` 入参仅 `{ settings }`；`broadcastSettingsChanged()` 无参；`settingsChanged` 载荷 `null`
  - 渲染层保存链路：page.tsx `handleSaveAndClose`（saveToStore + closeSettings），关闭确认弹窗两按钮（放弃更改 / 保存并退出）
- 下个 step 该从哪里继续：step7（顶部消息中心）；与本 step 无代码耦合，仅需注意 settingsChanged 载荷已变为 null
- 待办或已知限制：
  - paused 会话标脏后，恢复暂停的那一轮仍用旧设置（isIdle 排除 paused，避免丢插话队列），再下一轮才重建
  - 重建会顺带刷新 agent.md/core-profile/系统提示词等 start() 时读取的内容（start() 全量重跑的自然结果）
  - 子会话绑定 profile 被删时重建回退 default；default 也不存在则回滚旧配置并 warn，不致崩
  - 主题热更/模型下轮生效/后台会话不杀三场景已按链路静态验证，待主会话 GUI 人工回归确认
