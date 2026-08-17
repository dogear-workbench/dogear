---
step: 3
title: 版本号 + 端到端验证
status: pending
---

## 目标
patch 版本 +1，对整套微信式托盘交互做完整手动回归，确认 macOS 零改动。

## 依赖上下文（接力棒输入）
- Step 1：托盘闪烁已接线，系统通知/flashFrame 已移除，提示音走 `notificationSoundEnabled`
- Step 2：气泡空闲不弹；点击会话跳转 + 标记已读；`markAgentIslandSessionViewed` 已导出
- 当前版本：`apps/electron/package.json` version = `0.17.26`

## 计划改动

### 1. `apps/electron/package.json`
- [ ] `version` 0.17.26 → 0.17.27

### 2. 构建与类型检查
- [ ] `bun run build:main && bun run build:preload` 通过
- [ ] `bun run typecheck` 通过
- [ ] `bun test` 通过（surface 测试已随 Step 1 更新）

### 3. Windows 端到端手动回归清单
- [ ] 托盘图标空闲时是普通图标（无任何色点）
- [ ] 发起一次 Agent 任务（running）→ 托盘不闪、图标不变色
- [ ] 任务完成（completed）→ 托盘开始闪烁；屏幕右下角**无**系统 Notification 弹窗；提示音按设置响/不响
- [ ] 悬停托盘 → 弹出气泡，列出该已完成会话；点它 → 打开对应会话；闪烁停止
- [ ] 权限确认场景（needs-interaction）→ 托盘闪烁；气泡里能看到「等待权限确认」；处理后闪烁收敛
- [ ] 出错场景（error）→ 托盘闪烁，气泡显示「需关注」
- [ ] 完全空闲（无 running、无待处理）→ 悬停托盘**不弹**气泡
- [ ] 设置里关闭 `notificationSoundEnabled` → 上述场景不再响提示音
- [ ] 托盘左键点击仍打开主窗口（行为不变）

### 4. macOS 零改动确认
- [ ] 全量 diff 无 macOS 路径改动；所有新增/删除逻辑都在 `process.platform === 'win32'` 守卫内或 Windows 专属文件里

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 完成总结
- 全步骤实际改动汇总 + 与原设计偏差
