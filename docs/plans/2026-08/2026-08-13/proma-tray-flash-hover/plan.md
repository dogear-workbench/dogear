# Proma Windows 托盘微信式提示 实施计划

**目标**：把 Windows 托盘的 Agent 状态提示改成微信式——图标不显示色点，需要用户介入时托盘闪烁，状态只显示在悬停气泡里，点气泡会话即跳转并标记已读，去掉系统通知弹窗。

**架构思路**：状态机 `agent-island-service.ts` 完全不动（继续产出 `snapshot.state.sessions[].attention`），只改消费端——`WindowsAgentIslandSurface` 新增 `onTrayFlash` 回调，`tray.ts` 新增 `setTrayFlash`，`index.ts` 重新接线；打开会话链路打通「标记已读」让闪烁自动收敛。

**设计文档**：`docs/plans/2026-08/2026-08-13/proma-tray-flash-hover-design.md`

**涉及模块**：`tray.ts` / `windows-tray-icon.ts` / `windows-agent-island-surface.ts`(+test) / `agent-status-hover-window.ts` / `agent-island-service.ts` / `ipc.ts` / `index.ts` / `package.json`

## 步骤索引

- [x] [Step 1: 托盘去色点 + 闪烁接线](./step1-tray-flash.md) — tray 新增 setTrayFlash、去色点；surface 新增 onTrayFlash、简化 processNotification；index.ts 重新接线
- [x] [Step 2: 悬停气泡空闲不弹 + 点击标记已读](./step2-hover-mark-viewed.md) — hover window 空闲不弹；导出 markViewed 并在 OPEN_SESSION handler 调用
- [ ] [Step 3: 版本号 + 端到端验证](./step3-version-verify.md) — patch 版本 +1，完整手动回归

## 全局决策

- 所有代码改动在 `C:/proma` 仓库执行；本计划文档在 dogear 工作区维护。
- 构建：`bun run build:main && bun run build:preload`；测试：`bun test`；类型检查：`bun run typecheck`。
- Windows 专有改动用 `process.platform === 'win32'` 限定，不写 `!isMac`；macOS 行为零改动。
- 闪烁判断唯一依据：`snapshot.state.sessions` 中存在 `attention === true` 的会话。
- 提示音由 `notificationSoundEnabled` 设置门控（主进程发送 PLAY_SOUND 前判断），不新增设置项。
- 不写注释（除非 WHY 非显而易见）；不留半成品和空 stub。
- 版本号规则：每次改动递增 patch（当前 0.17.26）。
