---
step: 1
title: 扩展仓库骨架 + NM host 布局 + dev 注册脚本
status: done
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
  1. background.js 未在 port 通路上调用 nm-protocol.js：`chrome.runtime.connectNative` 的 port 层由浏览器封装（收发已是解析后的 JSON 对象），SW 内手动帧编解码无处使用且会造成双重编码。nm-protocol.js 按拍板签名实现，作为协议语义的扩展侧基准实现保留，由 `resources/browser-eval/nm-protocol-smoke.mjs` 冒烟验证；step2 bridge 的 TS 实现可与之对拍。
  2. nm-protocol.js 用 Uint8Array/TextEncoder/DataView 而非 Buffer（Buffer 是 node API，SW 无此全局）；node ≥11 与 MV3 SW 两栖可用。encodeFrame 返回 Uint8Array（node 里与 Buffer 互通）。
  3. 扩展 ID 计算抽为 `scripts/nm-extension-id.mjs` 共享模块（build-nm-manifest 与 register-nm-dev 共用，避免双份算法漂移）。
  4. 冒烟脚本保留进 `resources/browser-eval/nm-protocol-smoke.mjs`（6/6 PASS），其粘包用例实测抓出 stale DataView bug（subarray 后旧 view 读错帧头），该 bug 已修——保留价值高。
  5. textPreview 在取 innerText 前 500 字之前先压缩空白（`\s+`→空格 + trim），否则预览常被导航/空白占满。
- 改动文件清单：
  - `extension/manifest.json`（内置 key，ID=jpabfficjncbbbkkdgjkhkmpmgehbfaa）
  - `extension/src/nm-protocol.js`（encodeFrame/makeDecoder，流式解码 + 64MB 上限 + 坏帧 protocol_error 语义）
  - `extension/src/background.js`（connectNative 单 port、welcome→注入→tab_snapshot、断连状态机、popup 消息协议 dogear_connect/dogear_get_state/dogear_state）
  - `extension/src/content-extract.js`（extractTabSnapshot 纯函数，executeScript 序列化注入）
  - `extension/popup.html` / `extension/popup.js`（连接按钮 + 状态区，3s ping 兼 SW 被杀）
  - `resources/nm-host/nm-host.bat`（CRLF，`"%~dp0..\..\Dogear.exe" --nm-host-bridge`）
  - `resources/nm-host/com.dogear.nmhost.json`（build-nm-manifest 生成物，path 相对、allowed_origins 锁定 ID）
  - `scripts/nm-extension-id.mjs`（共享 ID 计算）
  - `scripts/build-nm-manifest.mjs`（安装版 manifest 程序化生成）
  - `scripts/register-nm-dev.mjs`（dev 布局 build/nm-host-dev/ + HKCU Chrome/Edge 两键 + --unregister）
  - `resources/browser-eval/nm-protocol-smoke.mjs`（冒烟，node 直接跑）
  - `eslint.config.mjs`（globalIgnores 加 extension/**）
  - tsconfig.json / tsconfig.electron.json 无需改：include 均为白名单制，extension/ 天然不在内

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 帧协议（bridge TS 必须语义一致）：4B LE uint32 length + UTF-8 JSON；上限 64MB；坏帧发 `{type:'protocol_error', error}` 不断流（帧过长则清空缓冲）
  - 扩展→gateway：`{type:'hello', extensionVersion, tabId}` → `{type:'tab_snapshot', tabId, title, url, textPreview, extractError?}`
  - gateway→扩展：`{type:'welcome', appVersion}` / `{type:'goodbye'}`
  - gateway 单会话：扩展重连时先 disconnect 旧 port 再 connectNative，新 host 进程发新 hello；旧连接待 gateway 发 goodbye 关闭
  - bridge 分流 flag：`--nm-host-bridge`（安装版 bat 与 dev bat 都已带）；dev bat 会 `cd /d` 回仓库根再 `electron.exe . --nm-host-bridge`，主进程从 process.argv 识别 flag
  - pipe：`\\.\pipe\dogear-nm-gateway`（step2 主进程 server / bridge client）
  - bridge 连 pipe 失败重试窗口 ≤3s（覆盖「Dogear 正在启动」），仍失败即退出（stdio 关闭 → 扩展 onDisconnect → popup「Dogear 未运行」）
- 下个 step 该从哪里继续：实现 electron/main 入口 `--nm-host-bridge` 分流（必须在 requestSingleInstanceLock 之前）+ browser-gateway pipe server；协议对拍可用 `node resources/browser-eval/nm-protocol-smoke.mjs` 思路
- 待办或已知限制：
  - headful 手动验收未做（本 step 脚本自验全绿）：Edge 加载 extension/、点 popup、30s SW 死回「未连接」，需 Dogear 侧 bridge/gateway 就位后一并验
  - dev 使用顺序：`bun run build:electron` → `bun run dev` → `node scripts/register-nm-dev.mjs` → Edge 加载 `extension/`；停用 dev 注册：`node scripts/register-nm-dev.mjs --unregister`（自验后已清干净，未残留注册表键）
  - 安装版 NSIS 写键 + extraResources 属后续 step，resources/nm-host/ 两个文件已就位待打包
