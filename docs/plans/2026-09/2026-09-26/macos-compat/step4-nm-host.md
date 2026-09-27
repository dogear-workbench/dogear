---
step: 4
title: NM host 跨平台
status: done
---

## 目标
浏览器扩展通道在 mac 可用：管道、宿主脚本、注册三件套全部有 darwin 实现。

## 依赖上下文（接力棒输入）
- 审计依据：`20260926-main-process-audit.md` ❌-2；`20260926-build-frontend-audit.md` C1/B12
- 前置 step 产出：无强依赖（可与 step2/3 并行）

## 计划改动
- [ ] **管道地址抽象**：`electron/main/services/browser/nm-protocol.ts:1` 的 `\\.\pipe\dogear-nm-gateway` 抽成函数——win32 返回 named pipe；darwin 返回 `join(app.getPath('userData'), 'nm-gateway.sock')`。同步改三处消费点：`browser-gateway.ts:354-366`（listen 前 unlink 旧 socket 文件，关闭时清理）、`nm-bridge.ts:64`、`resources/nm-host/nm-bridge-worker.cjs`（worker 是独立进程，平台判断用自身 process.platform）
- [ ] **宿主脚本**：新增 `resources/nm-host/nm-host.sh`——`ELECTRON_RUN_AS_NODE=1 exec "<Dogear.app/Contents/MacOS/Dogear>" ...`，路径由 manifest 生成时写入（mac 的 NM manifest `path` 字段必须是**绝对路径**，Windows 才允许相对）；`scripts/build-nm-manifest.mjs:17` 按构建平台写 `nm-host.sh`/`nm-host.bat` 与绝对路径，产物 chmod +x
- [ ] **注册链路**：mac 无 NSIS 安装器环节，注册由应用运行时完成——新增 tipc procedure `registerNmHost()`：把 manifest JSON 写到 `~/Library/Application Support/{Google/Chrome, Microsoft/Edge}/NativeMessagingHosts/com.dogear.nmhost.json`（浏览器目录清单做成常量表，可扩展）；设置页浏览器扩展区域加「注册/注销」按钮（darwin 显示）
- [ ] **dev 注册**：`scripts/register-nm-dev.mjs` 加 darwin 分支（写测试浏览器目录 + 生成 dev 版 sh），或统一并入运行时注册（倾向后者，减少两套逻辑）
- [ ] Windows 回归：`build-nm-manifest.mjs` 产出 diff + 浏览器扩展连通一次（named pipe 路径不变）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **宿主脚本不在构建期产出，改为运行时渲染到 userData**：mac 的 NM manifest `path` 必须绝对路径（安装位置因人而异），且 socket 路径依赖本机 userData——两者在构建期均不可知，静态 nm-host.sh 无从安放正确路径。故 nm-host.sh 由 `registerNmHost()` 在注册时渲染写入 userData（内容含 execPath/worker/socket 绝对路径），升级/迁移后重注册即可。build-nm-manifest.mjs 零改动（Windows 产物天然不变；其生成的 com.dogear.nmhost.json 成为 allowed_origins 的单一来源，被 registerNmHost 读取）
  2. **socket 路径传递机制**：worker（独立进程）与 nm-bridge（bridge 进程不经 main-app 的 dev userData 隔离，getPath 不可靠）均无法自行推导 darwin socket 路径，统一支持 `--nm-gateway=<path>` argv 由宿主脚本渲染时传入；未传参时 fallback：worker 用固定 pipe（Windows 原行为零回归）、nm-bridge 用 `nmGatewayAddress(app.getPath('userData'))`（win32 下等价原 pipe）
  3. **register-nm-dev.mjs 不加 darwin 实现**：registerNmHost 在 dev/prod 均可用（dev execPath=项目 electron、worker=项目 resources、userData=Dogear-Dev 与网关一致），mac dev 注册统一走应用内按钮；脚本改为非 win32 早退并指引设置页注册，Windows 逻辑原样保留
  4. **browser-gateway 保持零 electron 依赖**：`initBrowserGateway(appVersion, userDataDir)` 增加第二参数由调用方传入，不在 gateway 内 import electron
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts`：`NM_GATEWAY_PIPE_PATH` 常量 → `nmGatewayAddress(userDataDir)` 函数（win32 固定 pipe / darwin `join(userDataDir, 'nm-gateway.sock')`）
  - `electron/main/services/browser/browser-gateway.ts`：listen 前 unlink 旧 socket 文件；`server.on('close')` 与 `closeBrowserGateway` 幂等清理 socket 文件（darwin only）
  - `electron/main/main-app.ts`：`initBrowserGateway(app.getVersion(), app.getPath('userData'))`
  - `electron/main/services/browser/nm-bridge.ts`：`resolveGatewayAddress()`（--nm-gateway argv 优先，fallback nmGatewayAddress）
  - `resources/nm-host/nm-bridge-worker.cjs`：`--nm-gateway` argv 优先，fallback 固定 pipe
  - `electron/main/services/browser/nm-host-register.ts`（新增）：`registerNmHost()` / `unregisterNmHost()`，浏览器目录常量表（Chrome/Edge），manifest 写 `~/Library/Application Support/{dir}/NativeMessagingHosts/com.dogear.nmhost.json`
  - `electron/main/tipc/browser.ts`：`registerNmHost` / `unregisterNmHost` 两个 procedure
  - `app/settings/BehaviorTab.tsx`：浏览器扩展区域 darwin-only「注册到浏览器 / 注销」按钮（`client.getPlatform()` 判平台，sonner toast 反馈）
  - `scripts/register-nm-dev.mjs`：非 win32 早退 + 指引应用内注册

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `nmGatewayAddress(userDataDir: string): string`（nm-protocol.ts；win32 pipe / darwin `join(userDataDir, 'nm-gateway.sock')`）
  - `initBrowserGateway(appVersion: string, userDataDir: string)`（签名已扩，两参均必传）
  - `registerNmHost(): { results: { browser, ok, error? }[]; hostScriptPath }` / `unregisterNmHost(): { browser, ok, error? }[]`（nm-host-register.ts，darwin 外抛错）
  - nm-host.sh 渲染模板：`#!/bin/bash` + `ELECTRON_RUN_AS_NODE=1` + `exec "<execPath>" "<worker.cjs>" --nm-gateway="<socket>"`，落 `userData/nm-host.sh`，chmod 0o755
- 下个 step 该从哪里继续：Step 5 更新通道；真机（Step 6）验证本 step：设置页注册 → 检查 `~/Library/Application Support/{Google/Chrome,Microsoft/Edge}/NativeMessagingHosts/com.dogear.nmhost.json` 与 `userData/nm-host.sh`（有 +x）→ 扩展点「连接此标签页」应连通
- 待办或已知限制：
  - app 更新后（bundle 路径不变但版本变化）注册的 sh 无需重写；若用户手动移动 /Applications/Dogear.app 位置则需重新注册（按钮重按即可，幂等覆盖）
  - darwin 链路未真机验证（本机 Windows）；Windows 回归已验：build:electron/lint 0 error、build-nm-manifest 产出零 diff、worker 不传参连通固定 pipe（exit 0）、传 `--nm-gateway` 报错路径即 argv 值
  - 卸载清理：mac 无卸载器，若用户删 App 前未点注销，浏览器目录残留一份 manifest 指向不存在脚本（浏览器侧表现为扩展连接失败，无崩溃）；可在后续版本考虑启动时自动重注册
