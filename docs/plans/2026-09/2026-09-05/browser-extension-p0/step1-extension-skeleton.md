---
step: 1
title: 扩展仓库骨架 + NM host 布局 + dev 注册脚本
status: pending
---

## 目标

`extension/` 可在 Edge 开发者模式加载无报错、扩展 ID 与 key 预计算一致；NM host manifest 与 bat 就位（安装版布局 + dev 布局）；HKCU 可由脚本写入/清除；帧协议模块 node 冒烟通过。

## 依赖上下文（接力棒输入）

- 无前置 step。设计依据：[../browser-extension-p0-design.md](../browser-extension-p0-design.md) + 勘查报告 §1（key/ID 算法、manifest 字段、bat 包装均实验验证）
- 当前关键文件状态：仓库根无 `extension/`；`resources/` 是 extraResources 惯例位置；`build/installer.nsh` 已有 customInit/customUnInstall 先例
- 关键决策回顾：path 不能带参数 → bat 包装；ID 由 manifest 内置 key 的 SPKI SHA256 前 32 hex 映射 a-z 派生（勘查 §1.2 算法），生成一次提交进仓库

## 计划改动

- [ ] `extension/manifest.json`：MV3；`key`（RSA-2048 SPKI base64）；`permissions: ["nativeMessaging", "activeTab", "scripting"]`；`action.default_popup`；`background.service_worker`
- [ ] `extension/src/nm-protocol.js`：`encodeFrame(obj) → Buffer` / `makeDecoder() → {push(chunk), onFrame(cb)}`（流式解码）；纯 node 环境可用，无浏览器 API
- [ ] `extension/src/background.js`：SW——popup 消息触发 `chrome.runtime.connectNative('com.dogear.nmhost')`；帧编解码用 nm-protocol；收到 welcome 后 `chrome.scripting.executeScript` 注入抽取函数并向当前 tab 取结果；结果组 `tab_snapshot` 回传；端口断开时通知 popup
- [ ] `extension/src/content-extract.js`：导出 `extractTabSnapshot()`，返回 `{ title, url, textPreview }`（`document.body.innerText` 前 500 字）；执行注入时被序列化传入，不依赖 import
- [ ] `extension/popup.html` + `extension/popup.js`：「连接此标签页」按钮 + 状态区（连接中 / 已连接 title+url / 失败原因——重点文案「Dogear 未运行」）
- [ ] `resources/nm-host/nm-host.bat`：`"%~dp0..\..\Dogear.exe" --nm-host-bridge`
- [ ] `scripts/build-nm-manifest.mjs`：从 `extension/manifest.json` 的 key 预计算扩展 ID → 生成安装版 `resources/nm-host/com.dogear.nmhost.json`（`path: "nm-host.bat"`、`allowed_origins: ["chrome-extension://<id>/"]`、`type: "stdio"`）；JSON.stringify 程序化生成（防手拼转义坑）
- [ ] `scripts/register-nm-dev.mjs`：生成 dev 布局到 `build/nm-host-dev/`（manifest path 指向 dev bat；bat 调 `node_modules/electron/dist/electron.exe --nm-host-bridge`，cwd 需在仓库根使 package.json main 生效——bat 内 `cd /d %~dp0\..\..`）；写 HKCU 两键指向 dev manifest 绝对路径；`--unregister` 清除（回落安装版）
- [ ] 冒烟脚本 `resources/browser-eval/` 或临时 node 脚本：nm-protocol 编解码往返断言（本 step 内跑完即弃则放 %TEMP%，若保留价值高则进 browser-eval）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
