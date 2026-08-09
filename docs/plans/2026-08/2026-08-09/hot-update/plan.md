# 热更新系统 实施计划

**目标**：日常前端改动只需打包 zip（几秒），客户端自动下载覆盖；主进程/依赖变动时自动走全量 NSIS 打包。

**架构思路**：
- 把 `out/`（前端产物）从 asar 内部移到 asar 外部（`resources/out/`），使其可被热更新覆盖
- 发布脚本自动检测 `dist/`（主进程产物）hash 是否变化，决定走热更新（zip）还是全量（exe）
- 客户端通过本地 HTTP 服务检查版本，拉取 manifest 后判断更新类型
- 排除了 electron-updater + differentialPackage 方案：该方案打包仍全量（慢），只优化下载，不解决核心痛点

**涉及模块**：
- `electron-builder.yml` — out/ 移出 asar
- `electron/main/index.ts` — 前端加载路径改为 resourcesPath
- `electron/main/services/update-service.ts` — 新建，热更新/全量更新逻辑
- `electron/main/tipc/updater.ts` — 新建，IPC 路由
- `electron/main/tipc/index.ts` — 注册 updater 路由
- `app/settings/page.tsx` — 新增「关于」Tab
- `app/settings/AboutTab.tsx` — 新建，检查更新 UI
- `package.json` — release / serve-updates 脚本
- `scripts/release.mjs` — 新建，智能发布脚本
- `scripts/serve-updates.mjs` — 新建，本地 HTTP 服务

## 步骤索引

- [x] [Step 1: out/ 移出 asar + 主进程加载路径改造](./step1-out-of-asar.md) — 让前端产物可被覆盖
- [ ] [Step 2: 更新服务 + IPC 路由](./step2-update-service.md) — 主进程检查/下载/应用更新逻辑
- [ ] [Step 3: 设置页「关于」Tab](./step3-about-ui.md) — 前端检查更新入口
- [ ] [Step 4: 智能发布脚本 + 本地 HTTP 服务](./step4-release-script.md) — 自动判断热更新/全量，产物发布

## 全局决策

### 版本号格式
`package.json` 的 `version` 字段（semver），每次 release 自动 patch +1。

### manifest 格式（服务端版本信息）
`manifest.json` 放在 HTTP 服务根目录：
```json
{
  "version": "0.1.2",
  "type": "hotfix",
  "pubDate": "2026-08-09T15:30:00Z",
  "hotfix": {
    "url": "http://localhost:9527/update-0.1.2.zip",
    "size": 1234567,
    "sha256": "abc123..."
  }
}
```
type 为 `hotfix` 时有 hotfix 字段；type 为 `full` 时有 full 字段（指向 exe + blockmap）。

### 更新服务地址
本地固定 `http://localhost:9527`。地址写在 settings.json 的 `update.serverUrl` 字段，可从设置页修改。

### 热更新覆盖路径
打包后 out/ 在 `resources/out/`。热更新下载 zip 后解压覆盖到 `process.resourcesPath/out/`。

### 热更新应用方式
覆盖文件后通过 `mainWindow.reload()` 刷新页面（不需要重启 Electron 进程）。若热更新涉及主进程代码则不会生效（那种情况已被发布脚本判定为 full）。
