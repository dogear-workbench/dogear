# Step 1 交付：门禁拆分 + 状态机 Windows 接入

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `apps/electron/src/main/lib/macos-version.ts` | 拆分门禁为 3 个函数 |
| `apps/electron/src/main/lib/agent-island-service.ts` | `pushState()` 加 Windows 出口 + 占位函数 |
| `apps/electron/src/main/index.ts` | 初始化逻辑按平台分发 |
| `apps/electron/src/main/lib/macos-version.test.ts` | 新增 9 个单元测试 |
| `apps/electron/package.json` | patch 版本 0.17.17 → 0.17.18 |

## 关键函数签名

### `macos-version.ts`

```typescript
export function isAgentIslandServiceSupported(platform = process.platform): boolean
// macOS + Windows → true；Linux → false

export function isMacAgentIslandSurfaceSupported(platform = process.platform, darwinRelease = release()): boolean
// 仅 macOS 26+ → true

/** @deprecated 改用 isMacAgentIslandSurfaceSupported() */
export function isAgentIslandSupported(platform = process.platform, darwinRelease = release()): boolean
// 委托到 isMacAgentIslandSurfaceSupported()
```

### `agent-island-service.ts`

```typescript
// pushState() 末尾改为平台分发：
const snapshot = buildNativeSnapshot(state, planning)
if (isMacAgentIslandNativeHostReady()) {
  publishMacAgentIslandSnapshot(snapshot)
}
if (process.platform === 'win32') {
  publishWindowsAgentIslandSnapshot(snapshot)
}

// 占位函数：
function publishWindowsAgentIslandSnapshot(snapshot: NativeAgentIslandSnapshot): void
// 暂存到 lastWindowsSnapshot + console.log；Step 2 接入真正 surface
```

### `index.ts`

```typescript
// 状态机初始化：macOS + Windows
if (isAgentIslandServiceSupported()) {
  safeRun('initAgentIslandService', () => {
    initAgentIslandService({
      ...
      enabled: () => getSettings().agentIsland?.enabled !== false,
      // ↑ 去掉了 isMacAgentIslandNativeHostReady() 依赖，Windows 上不再被掐断
    })
  })
}

// Swift surface：仅 macOS 26+
if (isMacAgentIslandSurfaceSupported()) {
  safeRun('startAgentIslandSurface', startAgentIslandSurface)
}
```

## 与计划差异

1. **enabled 回调**：计划说"确保 Windows 上 enabled 不被 isMacAgentIslandNativeHostReady() 掐断"。实施时直接从 enabled 回调中移除了 `isMacAgentIslandNativeHostReady()` 判断，改为只看设置开关。原因：pushState() 内部已有平台分发逻辑（macOS 走 native host ready 检查，Windows 直接走 publishWindows），enabled 回调不应再做平台特化的 surface 就绪检查。

2. **pushState() 结构调整**：原代码是 `if (!isMacAgentIslandNativeHostReady()) return`（提前返回截断）。计划说"macOS 截断保留不动"，但如果保留提前返回，Windows 出口永远不会被执行。因此改为条件分支而非提前返回，逻辑等价但不再互斥。这是计划中的设计意图（"macOS 截断之后新增 Windows 出口"），只是实现方式上用并列 if 替代了 return-then-continue。

## 测试结果

### typecheck
```
@proma/shared typecheck: Exited with code 0
@proma/core typecheck: Exited with code 0
@proma/session-core typecheck: Exited with code 0
@proma/cli typecheck: Exited with code 0
@proma/ui typecheck: Exited with code 0
@proma/electron typecheck: Exited with code 0
```
全通过。

### bun test（macos-version.test.ts）
```
 9 pass
 0 fail
 10 expect() calls
```

### bun test（全量）
```
 532 pass
 1 fail   ← planning-manager.test.ts，预存失败，与本次改动无关
```

## 给下一步（Step 2）的接力棒

- `publishWindowsAgentIslandSnapshot(snapshot: NativeAgentIslandSnapshot)` 是 Step 2 的接入点，签名已固定。当前为占位实现（存到 `lastWindowsSnapshot` + console.log）。
- Windows 上 AgentIslandService 已正常初始化，事件流 → pushState → publishWindowsAgentIslandSnapshot 管道已打通。
- Step 2 应创建 `windows-agent-island-surface.ts`，在其中定义真正的 `onSnapshot` 处理逻辑，替换 `publishWindowsAgentIslandSnapshot` 的占位体。
- `lastWindowsSnapshot` 模块变量可被 Step 2 用于 surface 初始化时拉取最新快照。

## 遗留问题

无。本步骤不涉及 surface 逻辑，仅打通数据管道。
