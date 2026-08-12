---
step: 3
title: 托盘图标状态化 + tooltip
status: pending
---

## 目标
根据 snapshot 的 `pill.priorityStatus` 动态生成带状态色点的托盘图标，更新 tooltip 显示聚合摘要。接入 Step 2 的 `onTrayUpdate` 回调。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-surface-core.md] `WindowsAgentIslandSurface` 已有 `onTrayUpdate?(pill: PillSnapshot)` 回调
- 现有托盘：`apps/electron/src/main/tray.ts`，`tray.setImage()` 和 `tray.setToolTip('Proma')` 的调用位置
- 现有 SVG→nativeImage 管道：`apps/electron/src/main/lib/dock-badge-service.ts:9` 的 `createBadgeOverlay()` — 用 SVG 字符串 → `nativeImage.createFromDataURL()`
- 托盘图标资源：`tray.ts:39-44` 用 `iconTemplate.png`（22×22 macOS menu bar 专用）

## 计划改动

### 1. `apps/electron/src/main/lib/windows-tray-icon.ts`（新增）

纯函数，不依赖 Electron API（便于测试）：

```typescript
type TrayPhase = 'idle' | 'running' | 'needs-interaction' | 'error' | 'completed'

// phase → 色点颜色
const PHASE_COLORS: Record<TrayPhase, string | null> = {
  idle: null,              // 无色点
  running: '#6BB7FF',      // 蓝
  'needs-interaction': '#FFA835', // 橙
  error: '#E5534B',        // 红
  completed: '#4ADE80',    // 绿
}

// 生成带色点的托盘图标 SVG 字符串
export function generateTrayIconSvg(phase: TrayPhase, baseIconSvg: string): string

// 生成 tooltip 文本
export function generateTrayTooltip(pill: PillSnapshot): string
// 例: "3 个会话执行中 · 1 个待处理" 或 "Proma"（idle）
```

图标生成策略：
- 基础图标用内置 SVG（不依赖外部 PNG 文件，跨平台一致）
- 在右下角叠加 6px 色点圆（idle 时不加）
- 生成两套尺寸：16×16 和 32×32（`nativeImage.createFromDataURL` 后 `addRepresentation` 或直接用 `@2x`）

### 2. `apps/electron/src/main/tray.ts`
- [ ] 暴露 `updateTrayIcon(phase: TrayPhase)` 方法
- [ ] 暴露 `updateTrayTooltip(text: string)` 方法
- [ ] Windows 上初始图标用 SVG 生成的版本（不用 iconTemplate.png）

### 3. `apps/electron/src/main/lib/windows-agent-island-surface.ts`
- [ ] `onTrayUpdate` 回调实现：调 `generateTrayIconSvg(pill.priorityStatus)` → `nativeImage` → `tray.updateTrayIcon()`，调 `generateTrayTooltip(pill)` → `tray.updateTrayTooltip()`

### 4. 测试：`apps/electron/src/main/lib/windows-tray-icon.test.ts`（新增）
- [ ] idle phase 的 SVG 不包含色点 circle 元素
- [ ] running phase 的 SVG 包含 fill="#6BB7FF" 的 circle
- [ ] needs-interaction phase 的 SVG 包含 fill="#FFA835"
- [ ] error phase 的 SVG 包含 fill="#E5534B"
- [ ] completed phase 的 SVG 包含 fill="#4ADE80"
- [ ] tooltip：0 个会话 → "Proma"
- [ ] tooltip：3 running + 0 interaction → "3 个会话执行中"
- [ ] tooltip：2 running + 1 interaction → "2 个会话执行中 · 1 个待处理"
- [ ] tooltip：0 running + 2 completed unread → "2 个任务已完成"

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- `updateTrayIcon` / `updateTrayTooltip` 的调用方式：
- `generateTrayIconSvg` 的最终签名和基础 SVG 模板：
- 下个 step 该从哪里继续：
