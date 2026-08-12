---
step: 1
title: 门禁拆分 + 状态机 Windows 接入
status: done
---

## 目标
拆分 `isAgentIslandSupported()` 为两个函数，让 AgentIslandService 状态机在 Windows 上也初始化，pushState() 增加 Windows 出口。这一步不实现任何 surface 逻辑，只打通数据管道。

## 依赖上下文（接力棒输入）
- 设计文档：`docs/plans/2026-08/2026-08-12/proma-windows-agent-island-design.md`
- 当前门禁：`apps/electron/src/main/lib/macos-version.ts:11-13` 的 `isAgentIslandSupported()` 返回 `platform === 'darwin' && isMacOS26OrLater()`
- 初始化入口：`apps/electron/src/main/index.ts:687-699`，`if (isAgentIslandSupported())` 块同时做了 initAgentIslandService + startAgentIslandSurface
- pushState 耦合：`apps/electron/src/main/lib/agent-island-service.ts` 的 pushState() 末尾 `if (!isMacAgentIslandNativeHostReady()) return` + `publishMacAgentIslandSnapshot()`
- enabled 回调：`index.ts:696` 的 `enabled: () => isMacAgentIslandNativeHostReady() && getSettings().agentIsland?.enabled !== false`

## 计划改动

### 1. `apps/electron/src/main/lib/macos-version.ts`
- [ ] 新增 `isAgentIslandServiceSupported()`：macOS 和 Windows 都返回 true（状态机在这两个平台都初始化）
- [ ] 新增 `isMacAgentIslandSurfaceSupported()`：仅 macOS 26+（Swift helper 只在 Mac 启动），直接复用现有 `isAgentIslandSupported` 的逻辑
- [ ] 保留原 `isAgentIslandSupported()` 函数不删（可能有其他调用方），标记为 deprecated 或改为调用 `isMacAgentIslandSurfaceSupported()`

### 2. `apps/electron/src/main/lib/agent-island-service.ts`
- [ ] pushState() 末尾的 macOS 截断保留不动
- [ ] 在 macOS 截断之后新增 Windows 出口：
  ```typescript
  if (process.platform === 'win32') {
    publishWindowsAgentIslandSnapshot(buildNativeSnapshot(state, planning))
  }
  ```
- [ ] 新增 `publishWindowsAgentIslandSnapshot` 占位函数（暂存到模块级变量 + console.log，Step 2 接入真正的 surface）
- [ ] 检查 enabled 回调引用：确保 Windows 上 enabled 不被 `isMacAgentIslandNativeHostReady()` 掐断

### 3. `apps/electron/src/main/index.ts`
- [ ] 把 `if (isAgentIslandSupported())` 改为 `if (isAgentIslandServiceSupported())`（状态机 macOS+Windows 都初始化）
- [ ] 把 `startAgentIslandSurface()` 移到单独的 `if (isMacAgentIslandSurfaceSupported())` 块（Swift helper 仅 macOS）

### 4. 测试：`apps/electron/src/main/lib/macos-version.test.ts`（新增）
- [ ] `isAgentIslandServiceSupported('darwin', ...)` → true（macOS 任意版本）
- [ ] `isAgentIslandServiceSupported('win32', ...)` → true
- [ ] `isAgentIslandServiceSupported('linux', ...)` → false（暂不支持 Linux）
- [ ] `isMacAgentIslandSurfaceSupported('darwin', darwin25)` → true
- [ ] `isMacAgentIslandSurfaceSupported('darwin', darwin24)` → false
- [ ] `isMacAgentIslandSurfaceSupported('win32', ...)` → false

## 实施回填（做完后填）

### 实际改动
- 与计划差异（2 处，均合理）：
  1. **enabled 回调移除 `isMacAgentIslandNativeHostReady()`**：原计划意图是“确保 Windows 不被掐断”，实施时直接移除该判断，改为只看设置开关。原因：pushState() 内部已有平台分发（macOS 走 native host ready 检查，Windows 直接走 publish），enabled 再做 surface 就绪检查是冗余且会掐断 Windows。
  2. **pushState() 截断方式从提前 return 改为并列 if**：原代码 `if (!isMacAgentIslandNativeHostReady()) return` 若保留，Windows 出口永远不可达。改为 `if (isMacAgentIslandNativeHostReady()) publishMac(...)` + `if (win32) publishWindows(...)`，对 macOS 逻辑等价。
- 改动文件清单（proma 仓库 C:/proma）：
  1. `apps/electron/src/main/lib/macos-version.ts` — 拆分 3 函数
  2. `apps/electron/src/main/lib/agent-island-service.ts` — pushState 平台分发 + 占位函数
  3. `apps/electron/src/main/index.ts` — 初始化逻辑拆分
  4. `apps/electron/src/main/lib/macos-version.test.ts`（新增）— 9 测试
  5. `apps/electron/package.json` — 0.17.17 → 0.17.18

### 给下一步的接力棒
- `publishWindowsAgentIslandSnapshot(snapshot: NativeAgentIslandSnapshot)` 是 Step 2 接入点，当前为占位（存 `lastWindowsSnapshot` + console.log）。
- Windows 上 AgentIslandService 已正常初始化，事件流 → pushState → publishWindows 管道已打通。
- Step 2 应创建 `windows-agent-island-surface.ts`，替换占位体为真正的 onSnapshot 处理；`lastWindowsSnapshot` 可用于 surface 初始化时拉取最新快照。
