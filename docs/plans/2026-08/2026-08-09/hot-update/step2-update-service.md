---
step: 2
title: 更新服务 + IPC 路由
status: done
---

## 目标
在主进程实现检查更新、下载热更新包、应用更新的完整逻辑，并通过 tipc 路由暴露给前端。

## 依赖上下文（接力棒输入）
- Step 1 产出：out/ 已在 `resources/out/`（asar 外），热更新覆盖路径 = `path.join(process.resourcesPath, 'out')`
- tipc 路由注册入口：`electron/main/tipc/index.ts`，在 router 对象里 spread + import
- manifest 格式见 plan.md 全局决策
- 更新服务地址在 settings.json 的 `update.serverUrl`

## 计划改动

### electron/main/services/update-service.ts（新建）
- [ ] `checkForUpdates(serverUrl)` → fetch manifest.json → 对比 app.getVersion() → 返回 `{ hasUpdate, type, info } | { hasUpdate: false }`
- [ ] `downloadHotfix(url, expectedSha256, onProgress)` → 下载 zip 到临时目录 → 校验 sha256 → 返回临时文件路径
- [ ] `applyHotfix(zipPath, targetDir)` → 解压 zip → 覆盖 `process.resourcesPath/out/` → 返回成功
  - 解压用 Node.js 内置能力或轻量库（如 `adm-zip` / `yauzl`）
  - 注意 Windows 文件锁：如果 out/ 下文件正在被读取，可能需要先写入临时目录再原子替换
- [ ] `downloadFullUpdate(url)` → 下载 exe → 运行安装（`shell.openExternal` 或 `child_process.exec`）
- [ ] 版本对比逻辑：semver compare（只比较版本号字符串即可，格式固定 `x.y.z`）

### electron/main/tipc/updater.ts（新建）
- [ ] `checkForUpdates` — 调 update-service，返回更新状态
- [ ] `downloadAndApplyHotfix` — 下载 + 应用热更新，通过 renderer handler 推送进度事件
- [ ] `getUpdateConfig` / `setUpdateConfig` — 读写 settings.json 的 `update.serverUrl`
- [ ] `getAppVersion` — 返回 `app.getVersion()`

### electron/main/tipc/renderer-handlers.ts
- [ ] 新增 `updateProgress` handler — 主进程向渲染层推送下载进度 `{ percent, transferred, total }`

### electron/main/tipc/index.ts
- [ ] import + spread `updaterRouter`

### electron/preload（如有需要）
- [ ] 确认 tipc 的 renderer handler 类型能正确推导

### types/settings.ts
- [ ] AppSettings 新增 `update?: { serverUrl: string }`，默认 `http://localhost:9527`

## 实施回填（做完后填）

### 实际改动

**新增文件：**
- `electron/main/services/update-service.ts` — 热更新核心服务
- `electron/main/tipc/updater.ts` — tipc 路由

**修改文件：**
- `electron/main/tipc/index.ts` — import + spread updaterRouter
- `electron/main/tipc/renderer-handlers.ts` — 新增 `updateProgress` handler
- `electron/main/services/settings-types.ts` — AppSettings 新增 `update?: { serverUrl: string }`，DEFAULT_SETTINGS 加默认值
- `types/settings.ts` — 同步新增 `update` 字段（前端用）
- `package.json` — 新增依赖 adm-zip + @types/adm-zip

### 给下一步的接力棒

前端可用的 tipc 路由：
- `getAppVersion()` → `{ version: string }`
- `checkForUpdates()` → `{ hasUpdate, type?, info?, error? }`
- `downloadAndApplyHotfix({ url, sha256 })` → 下载期间推送 `updateProgress` 事件 → `{ success, error? }`
- `downloadAndRunFullUpdate({ url })` → 下载期间推送 `updateProgress` 事件 → `{ success, error? }`
- `getUpdateConfig()` → `{ serverUrl }`
- `setUpdateConfig({ serverUrl })` → `{ success, error? }`

渲染层事件：
- `updateProgress: { percent, transferred, total }` — 下载进度推送

settings.json 新字段：`update.serverUrl`（默认 `http://localhost:9527`）

热更新应用后需调用 `mainWindow.reload()` 刷新页面（Step 3 前端侧决定调用时机）
