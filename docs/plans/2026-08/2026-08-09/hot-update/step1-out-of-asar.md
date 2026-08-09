---
step: 1
title: out/ 移出 asar + 主进程加载路径改造
status: done
---

## 目标
把前端产物 `out/` 从 app.asar 内部移到 asar 外部（`resources/out/`），使其可被热更新覆盖。同时修改主进程加载路径。

## 依赖上下文（接力棒输入）
- 当前打包配置：`electron-builder.yml` 的 `files` 包含 `out/**/*`，`asar: true`
- 当前主进程加载前端：`electron/main/index.ts:91` — `mainWindow.loadFile(path.join(__dirname, '../../out/index.html'))`
- 打包后 `__dirname` = `resources/app.asar/dist/`，所以 `../../out/` = `resources/app.asar/out/`（asar 内部，只读）
- 其他窗口也引用 out/：`index.ts:132`（debug）、`index.ts:187`（agent-monitor）、`index.ts:239`（stocks）、`index.ts:274`（session-window）

## 计划改动

### electron-builder.yml
- [ ] 从 `files` 列表移除 `out/**/*`
- [ ] 在 `extraResources` 新增条目：`{ from: out/, to: out/ }`
- [ ] 验证：打包后 out/ 出现在 `resources/out/` 而非 `resources/app.asar/out/`

### electron/main/index.ts
- [ ] 新增 helper 函数 `getRendererPath()` 返回前端 index.html 路径：
  - 开发环境：`http://localhost:3000`（不变）
  - 生产环境：`path.join(process.resourcesPath, 'out', 'index.html')`
- [ ] 替换所有 5 处 out/ 引用（mainWindow / debugWindow / agentMonitorWindow / stockWindow / sessionWindow）
- [ ] 注意：`loadFile` 和 `loadURL` 的用法区分——主窗口用 `loadFile`，其他窗口用 `loadURL(file://...)`，都要改

### 验证清单
- [ ] `bun run build:renderer` + `bun run build:electron` 后手动检查 `resources/` 目录结构
- [ ] 应用能正常启动、各窗口能正常加载前端

## 实施回填（做完后填）

### 实际改动
- `electron-builder.yml`：files 移除 `out/**/*`，extraResources 新增 `{ from: out/, to: out/ }`
- `electron/main/index.ts`：新增 `getRendererPath()` 函数（dev→URL，prod→`process.resourcesPath/out/index.html`），替换全部 5 处窗口引用
- 与计划无差异

### 给下一步的接力棒
1. 打包后前端产物在 `resources/out/`（asar 外部），可被热更新直接覆盖
2. 热更新覆盖路径 = `path.join(process.resourcesPath, 'out')`
3. `getRendererPath()` 已集中管理所有前端路径，位置在 `index.ts:24`
