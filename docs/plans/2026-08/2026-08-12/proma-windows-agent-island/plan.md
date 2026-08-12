# Proma Windows Agent 状态通知方案 — 实施计划

**目标**：为 proma Windows 版实现 Agent 状态通知系统（托盘图标状态化 + 悬停弹窗 + 主进程通知 + flashFrame），复用现有 AgentIslandService 状态机，macOS 零改动。

**架构思路**：AgentIslandService 状态机是平台无关的纯 TS，与 Swift 的耦合仅在 pushState() 末尾 2 行。拆开门禁让状态机在 Windows 也初始化，pushState() 加一条 Windows 出口指向新增的 WindowsAgentIslandSurface。Surface 是纯消费方，不产生状态。

**设计文档**：`docs/plans/2026-08/2026-08-12/proma-windows-agent-island-design.md`

**涉及模块**：`agent-island-service.ts` / `macos-version.ts` / `index.ts` / `tray.ts` / `ipc.ts` / `preload/index.ts` / `notifications.ts` / `useGlobalAgentListeners.ts` / `GeneralSettings.tsx` / `types/settings.ts` + 4 个新增文件

## 步骤索引

- [x] [Step 1: 门禁拆分 + 状态机 Windows 接入](./step1-gate-split.md) — 拆 isAgentIslandSupported，让状态机在 Windows 初始化，pushState 加 Windows 出口
- [ ] [Step 2: Surface 核心协调器 + phase 边沿检测](./step2-surface-core.md) — 新增 WindowsAgentIslandSurface，接收 snapshot，检测 phase 转移边沿
- [ ] [Step 3: 托盘图标状态化 + tooltip](./step3-tray-icon.md) — SVG 动态生成图标，按 priorityStatus 叠加色点
- [ ] [Step 4: 系统通知 + flashFrame + 提示音委托](./step4-notification-sound.md) — Electron Notification + flashFrame + IPC 委托渲染进程播放提示音
- [ ] [Step 5: 悬停弹窗](./step5-hover-window.md) — tray mouse-enter/leave + 无边框窗口 + 会话列表 React 组件
- [ ] [Step 6: 设置项 + 端到端集成](./step6-settings-integration.md) — GeneralSettings Windows 开关 + 集成验证

## 全局决策

### 项目路径
proma 在 `C:/proma`，不在当前 dogear 工作区内。所有代码改动在 proma 项目中执行。文档（本计划）在 dogear 工作区维护。

### 构建与测试
- 构建：`bun run build:main && bun run build:preload`（主进程用 esbuild，改 preload 后需重新构建 preload）
- 前端：`bun run dev:vite`（Vite dev server，仅前端热重载）
- 测试：`bun test`（bun:test，BDD 风格，`import { describe, expect, test } from 'bun:test'`）
- 类型检查：`bun run typecheck`
- 测试文件与源文件同目录，命名 `xxx.test.ts`

### IPC 四层契约（proma 专有）
新增 IPC 通道必须同步修改：
1. `apps/electron/src/types/` 或 `packages/shared/src/types/` — 通道常量
2. `apps/electron/src/main/ipc.ts` — `ipcMain.handle()` handler
3. `apps/electron/src/preload/index.ts` — `contextBridge` bridge API
4. renderer — 调用 `window.electronAPI.xxx()`

### 版本号
proma 规定每次改动递增 patch 版本（`apps/electron/package.json` 的 `version`）。

### macOS 不动原则
所有改动不能影响 macOS 现有行为。条件分支用 `process.platform === 'win32'` 精确限定，不写 `!isMac`。

### 测试策略
- 主进程纯逻辑（门禁函数、phase 边沿检测、SVG 生成、窗口定位计算）→ 单元测试
- 涉及 Electron API 的部分（Notification、Tray、BrowserWindow）→ 不做 mock 测试，靠手动验证 + typecheck
- 渲染进程 React 组件 → 不做自动化测试（proma 现有测试都是主进程纯逻辑）
