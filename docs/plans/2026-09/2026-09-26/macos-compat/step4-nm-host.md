---
step: 4
title: NM host 跨平台
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
