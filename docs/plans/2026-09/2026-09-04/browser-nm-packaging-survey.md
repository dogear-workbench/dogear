# Dogear 二期「Chrome 扩展 + Native Messaging」路线勘查报告

> 勘查日期：2026-09-04 · 环境：Windows 11 (build 26200) · 只读调研，未改动任何工作区文件
> 证据标注约定：【实验】= 本机实测；【文档】= 官方文档引用；【知识·未核验】= 训练知识，因网络受限未能在线复核；【代码】= 项目源码引用

---

## 0. TL;DR

1. **NM 路线在当前打包方式（NSIS per-user、未签名）下完全走得通**：写 HKCU 注册表不需要管理员，electron-builder 的 `customInstall`/`customUnInstall` 宏挂载点已确认存在，项目 `installer.nsh` 已有同类先例。最小改动 ≈ 3 处（见 §8）。
2. **端到端实验一次打通**：HKCU 注册表 → manifest 相对 path → MV3 扩展 connectNative → 长度前缀 stdio 往返，在 Playwright Chromium 和 Edge stable 152 上均成功（§3）。
3. **最大风险不在 NM 本身，而在扩展分发**：本机 Chrome stable 152 实测**已禁用 `--load-extension`**【实验】，unpacked 加载每次启动弹「关闭开发者模式扩展」劝退提示【知识·未核验】。规模化分发正解是 Chrome Web Store（$5 一次性注册费，可选 unlisted）【知识·未核验】；Edge Add-ons 上架免费且 Edge 实测仍支持 `--load-extension`【实验】。
4. **意外发现一个现存问题**：当前 NSIS 安装包**没有携带 Playwright Chromium**（`release/win-unpacked/resources/` 下无 ms-playwright），装出的应用受控浏览器功能只能依赖用户机器上 `%LOCALAPPDATA%\ms-playwright` 的残留——这个问题与二期无关也应尽快修（§5、§6）。
5. 便携版（electron-builder portable target）+ NM **可行但明显劣于 NSIS**：portable 运行时解压到 `%TEMP%` 且退出即删【代码·模板】，NM host 必须常驻磁盘，需要额外的「host 落地+注册表自愈」机制（§4.2）。

---

## 1. Native Messaging 机制说明（Windows）

### 1.1 Host manifest 与注册表

- 注册表键：`HKCU|HKLM\SOFTWARE\<浏览器>\NativeMessagingHosts\<host_name>`，**键的默认值（REG_SZ）= manifest JSON 文件完整路径**。
  - HKCU：用户级，无需管理员 ← **本项目 per-user 安装的正确选择**
  - HKLM：机器级，需管理员
  - 【文档】Edge 官方给出了完整搜索顺序（找到即停）：
    `HKCU\...\Microsoft\Edge` → `HKCU\...\Chromium` → `HKCU\...\Google\Chrome` → `HKLM\SOFTWARE\WOW6432Node\{Edge,Chromium,Chrome}` → `HKLM\SOFTWARE\{Edge,Chromium,Chrome}`（共 9 级）。
    来源：https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging
  - **Edge 会 fallback 读 Google\Chrome 键**【文档+实验双重证实：实验中只写了 Chrome 键，Edge 152 通信成功】。因此 NSIS 只写 Chrome+Edge 两键即可覆盖 Chrome/Edge/Chromium 内核浏览器；Brave 等其他分支未验证，建议上线前实测。
  - 本机注册表佐证（真实世界样例）：`HKCU\...\Google\Chrome\NativeMessagingHosts` 下已有微软 `com.microsoft.browsercore` 与夸克 `com.quark.hostclient`；HKLM 下也有微软键【实验观测】。
- manifest JSON 字段：
  - `name`：host 名，仅 `[a-zA-Z0-9._]`，须与注册表键名及扩展 `connectNative()` 参数一致
  - `description`、`type: "stdio"`
  - `path`：**Windows 上可为相对路径（相对 manifest 所在目录）或绝对路径**【实验证实相对路径可用】。注意：path 不能带参数，host 必须是单个可执行文件（exe/bat）
  - `allowed_origins`：`["chrome-extension://<扩展ID>/"]`，**必须精确匹配 + 尾斜杠，不支持通配符**；可列多个 ID
- 生成 manifest 时务必用 `JSON.stringify`/正规序列化：实验中手写模板把 `path` 写成了 `"host\nm-host.bat"`（`\n` 被解析为换行符），Chrome 报 "Found manifest, but not the binary"，这是本次实验踩过的唯一坑【实验】。

### 1.2 扩展 ID 稳定性与 allowed_origins

| 加载方式 | ID 来源 | 稳定性 |
|---|---|---|
| Chrome Web Store 上架 | manifest `key`/上传公钥派生 | 稳定【知识·未核验】 |
| unpacked（开发者模式） | **绝对安装路径**哈希 | 移动目录即变；**在 manifest 写死 `key` 字段可固定 ID**【实验证实：预计算 ID 与实际加载 ID 一致】 |
| .crx 拖入安装 | crx 内公钥 | 稳定【知识·未核验】 |

- ID 算法（Chromium `id_util.cc`）：`SHA256(key 的 SPKI DER) 取前 32 个 hex 字符，每字符 v → chr('a'+v)`【实验中用该算法预计算成功，间接证实】。
- **结论：扩展源码 manifest 内置 `key` 字段，则 unpacked / crx / 商店三种方式 ID 全部一致且稳定**，`allowed_origins` 可以在构建期写死。

### 1.3 stdio 协议与 host 生命周期

- 消息 = 4 字节 **native-order（Windows 上 LE）uint32 长度前缀 + UTF-8 JSON**【实验证实往返成功】。
- host 启动参数：`argv[1] = 调用方 origin`（`chrome-extension://<id>/`），另观察到 `argv[2] = --parent-window=0`【实验观测】。
- 大小限制：host→Chrome 单条 **64MB**（Chrome 105 前为 1MB）；Chrome→host **4GB**【知识·未核验；对应官方文档 developer.chrome.com（本次网络不可达）】。大 DOM 序列化需注意分片。
- 生命周期：
  - `chrome.runtime.connectNative` = 长连接端口，端口断开（SW 被杀/主动 disconnect）→ host 的 stdin EOF，host 应自行退出
  - `chrome.runtime.sendNativeMessage` = 一次性请求，host 回一条后退出
  - **每次 connectNative 都启动一个全新的 host 进程，协议层无单实例约束**【实验证实：一次页面加载内两个 host 进程并发（PID 37572 / 40220）】→ Dogear 主进程需通过本地 socket/命名管道收敛多个 host 实例
- host 的 stderr 可自由写日志（不影响协议）。

### 1.4 MV3 下的变化与坑

- MV3 service worker 中 `connectNative` 完全可用【实验证实】。
- SW 默认空闲 ~30s 被杀 → NM 长连接断。**Chrome 116 起 NM 连接会重置 SW idle timer 保持存活**【知识·未核验；本轮网络无法打开 developer.chrome.com 复核，上线前需确认目标最低支持版本】。
- 扩展 manifest 需要声明 `"permissions": ["nativeMessaging"]`【实验证实：声明后无权限报错】。
- 分发相关的坑（比 API 层更痛）：
  - **Chrome stable 已忽略 `--load-extension`**【实验证实，Chrome 152 日志原文：`--load-extension is not allowed in Google Chrome, ignoring.`】。开发者模式手动加载（chrome://extensions）仍可用，但每次浏览器启动弹「停用开发者模式扩展」提示【知识·未核验】
  - Edge stable 152 实测仍支持 `--load-extension`【实验】
  - 规模化分发正解：Chrome Web Store（$5 一次性开发者注册费；可 unlisted 不公开列出）【知识·未核验】/ Edge Add-ons（免费）【知识·未核验】

---

## 2. 端到端实验记录（2026-09-04，本机）

**环境**：Windows 11 26200；Chrome stable 152.0.7977.82；Edge stable 152.0.4191.62；Playwright Chromium rev 1234（Chrome for Testing 151.0.7922.34）；node v25.2.1。

**设置**（全部在 `%TEMP%\nm-survey`，实验后已清理注册表键与临时目录）：
- MV3 扩展：manifest 内置 `key`（RSA-2048 SPKI）→ 预计算 ID `lhcdjicgkicoemekkabefadjmfmcleca`；`permissions: ["nativeMessaging"]`；SW 顶层 + `onInstalled` 各调一次 `connectNative`
- host：`nm-host.bat` 包装 node 脚本（模拟「manifest 指向单个可执行文件、无参数」约束），实现长度前缀解析+回显
- NM manifest：`path` 用**相对路径** `host\nm-host.bat`；`allowed_origins` 指向预计算 ID
- 注册表：`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.dogear.survey` 默认值 → manifest 绝对路径

**结果**：

| # | 观测 | 结论 |
|---|---|---|
| 1 | Playwright Chromium 读 HKCU Chrome 键，NM 往返成功 | HKCU 键 + 相对 path + bat host 全链路可用；Chromium 系（非 branded）同样读 Chrome 键 |
| 2 | 实际加载 ID == 预计算 ID | manifest `key` 固定 ID 的算法与实践成立 |
| 3 | 两个不同 hostPid 各回一条 REPLY | 每次 connectNative 独立进程、无单实例约束 |
| 4 | host argv = `[host, chrome-extension://<id>/, --parent-window=0]` | origin 参数可做调用方校验 |
| 5 | Edge 152（--load-extension 注入）NM 往返成功，且只写了 Chrome 键 | Edge 支持 --load-extension；Edge 官方 9 级搜索顺序 fallback 到 Chrome 键属实 |
| 6 | Chrome 152 日志：`--load-extension is not allowed in Google Chrome, ignoring.` | Chrome stable 已封禁该注入方式，分发必须走商店或手动开发者模式 |
| 7 | manifest path 转义错误时报 "Found manifest, but not the binary" | manifest 生成要程序化，别手拼字符串 |

---

## 3. 本项目打包配置现状摘要

来源：`package.json`、`electron-builder.yml`、`build/installer.nsh`、`scripts/*.mjs`、`release/` 产物。

- **打包器**：electron-builder 26.4.0，`dist` = `vite build` + `tsc` + `electron-builder`；输出 `release/`
- **Windows 目标**：仅 `nsis` x64；`perMachine: false`（per-user，装到 `%LOCALAPPDATA%\Programs`，**无需管理员**）；`oneClick: false` 且 `allowToChangeInstallationDirectory: true`（**用户可改安装路径**）；**未代码签名**（`signtoolOptions: null`）
- **asar**：开，仅 `node-pty` unpack；`node_modules/**`（含 playwright-core ~14MB JS）在 asar 内
- **extraResources 先例充分**：Git 离线安装包、icon、python 脚本、skill/agent 模板、前端产物 `out/` ——加一个 `nm-host/` 目录毫无风格障碍
- **NSIS 自定义脚本**：`build/installer.nsh` 已使用 `customInit`（装 Git）与 `customUnInstall`（补快捷方式清理）宏；模板挂载点已核实：`customInstall` 在 `app-builder-lib/templates/nsis/installSection.nsh:82`、`customUnInstall` 在 `uninstaller.nsh:157`【代码】
- **更新通道**：electron-updater 体系（`latest.yml` + `.blockmap` 差分），当前全量安装包 **135.8MB**（0.1.97）
- **⚠ 现存问题**：`release/win-unpacked/resources/` 下**没有 ms-playwright**，即当前安装版未分发 Playwright Chromium；`browser-manager.ts` 的 `launchPersistentContext` 未指定 `executablePath`/`channel`【代码：electron/main/services/browser/browser-manager.ts:144-149】→ 在没有 `%LOCALAPPDATA%\ms-playwright` 缓存的用户机上**受控浏览器功能必然启动失败**（只在开发者机/装过 Playwright 的机器上碰巧可用）
- **Playwright 浏览器解析逻辑**【代码：`node_modules/playwright-core/lib/coreBundle.js:32820-32834`】：默认 `%LOCALAPPDATA%\ms-playwright`；`PLAYWRIGHT_BROWSERS_PATH` 环境变量可覆盖（须在加载 playwright 模块前设置）；playwright 1.62 的 chromium 实为 **Chrome for Testing 151.0.7922.34**（rev 1234）

---

## 4. NM host 与两种分发形态的组合评估

### 4.1 NSIS 安装版 + NM —— 推荐，零障碍

- 安装：`installer.nsh` 加 `customInstall` 宏，用 NSIS `WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.dogear.nmhost" "" "$INSTDIR\resources\nm-host\com.dogear.nmhost.json"` 写键（Chrome、Edge 两键；Edge 官方 fallback 下写 Chrome 键已覆盖 Edge，但两键都写更稳、顺序上让 Edge 优先命中自家键）。
- manifest 的 `path` 用**相对路径**（相对 manifest 自身目录指向同目录 host exe/桥），用户改安装路径、升级覆盖、卸载重装都天然正确【实验证实 Windows 相对 path 可用】。
- 卸载：`customUnInstall` 里 `DeleteRegKey HKCU ...`（该宏挂载点已有先例【代码：installer.nsh】）。卸载后即使残留也只会导致扩展连接失败，无安全风险（`allowed_origins` 锁死自家 ID）。
- 每次升级覆盖安装重复写 HKCU 幂等无害；若用户曾改目录，旧路径注册被新路径覆盖，自愈。

### 4.2 便携版（portable target）+ NM —— 可行但代价高

electron-builder portable 的运行模型【代码：`app-builder-lib/templates/nsis/portable.nsi:35,73-87`】：启动器把应用解压到 `$TEMP\{UNPACK_DIR_NAME}`，`ExecWait` 等应用退出后 `RMDir /r` 删除；同时设置 `PORTABLE_EXECUTABLE_DIR` 指向启动器 exe 所在目录。由此：

- **解压目录里的任何 exe 都不能作为 NM host 的注册目标**（退出即删、路径随临时目录漂移）。
- NM host 进程由**浏览器拉起**（可能发生在 Dogear 未运行时），所以 host 可执行文件必须**常驻于稳定路径**。可行做法：
  1. 把轻量 host exe 作为便携目录内的资源文件，首启动复制到 `%LOCALAPPDATA%\Dogear\nm-host\`（稳定路径）；
  2. 每次应用启动校验 HKCU 键值是否等于当前稳定路径，不一致则重写（自愈，应对用户挪动便携目录后 host 未更新的情况）；
  3. host 与便携目录内的 Dogear 之间走 localhost socket/命名管道。
- 额外复杂度：host 文件版本的更新（便携版无安装器，只能靠应用启动时自复制）。
- **结论：NM 路线本身不是便携版的否决项，但会让便携版维护成本显著上升；若二期同时要便携版，建议 NM 功能在便携版上标记为「实验性」或延后。**

### 4.3 NM host 进程形态（两形态通用）

- **不要用 Electron 主 exe 直接当 NM host**：一是第二实例会被 `requestSingleInstanceLock` 拦截退出（NM 协议没法跑）；二是每个连接起一个 Electron 进程太重（~100MB 内存）。
- 两个可选项：
  - **A（MVP，零额外分发）**：主 exe 加 `--nm-host-bridge` 分支——main 入口最前面检测该 flag 时跳过单实例锁、不建窗口，进入「stdio ↔ 主进程 localhost socket」转发循环后退出。缺点：每个扩展连接起一个 Electron 进程（冷启动 0.5~2s、内存偏高），但 MVP 完全够用。
  - **B（打磨期）**：独立轻量桥 exe（Go/Rust/C# AOT，~5-10MB）放 `resources/nm-host/`，注册表 path 指向它。语义最干净，host 生命周期与 Dogear 解耦。
- 主进程侧用单 listener（named pipe 或 127.0.0.1 随机端口+握手）收敛多个 host 连接【实验已证并发多实例必然出现】。

---

## 5. Playwright Chromium 携带方式

实测基准：本机 `chromium-1234`（CFT 151）解压 **428MB**；官方分发的 `chromium-win64.zip` 为 **148.9MB（rev1194）/169.8MB（rev1200）**【npmmirror 目录观测】→ NSIS LZMA 压缩后估 140~170MB，随包后全量安装包约 **280~310MB**（当前 135.8MB）。

| 方案 | 安装包体积 | 离线可用 | 升级策略 | 其他 |
|---|---|---|---|---|
| A. extraResources 随包（`ms-playwright/` 进 resources，启动时设 `PLAYWRIGHT_BROWSERS_PATH=resourcesPath\ms-playwright`） | +140~170MB | ✅ | 随应用发版；blockmap 差分对整目录变动帮助有限 | 开箱即用；每次发版都背体积（哪怕 Playwright 没升级，因为 blockmap 按文件分块、多数文件不变时增量尚可） |
| B. 首启按需下载（默认 `%LOCALAPPDATA%\ms-playwright` 或自定义 `PLAYWRIGHT_BROWSERS_PATH` 指向 userData） | +0（装 playwright-core JS ~14MB，已在） | ❌ 首启需网络 | 升级 npm 包后首启自动取新 revision | 国内网络风险【实验】：npmmirror 镜像总体可用但 **rev 1234 恰好缺 win64 包**（1194/1200 全），需实现「镜像→官方 CDN」fallback 与失败重试 UI |
| C. `channel: 'chrome'/'msedge'` 用用户已装浏览器 | +0 | ✅ | 无 | 版本不可控（Playwright 对新 Chrome 兼容风险低）；未装浏览器时需降级路径。**与 NM 二期天然协同**：NM 路线本来就要求用户有真实 Chrome/Edge |

- 推荐组合：**B 为主（修现存缺失问题）+ C 为降级/可选项**；若二期要求「装完即用的受控浏览器（离线场景）」才考虑 A。
- SmartScreen/下载转化：SmartScreen 判定基于**代码签名与文件信誉（下载量累积）**，与安装包体积无关【知识·未核验】。本项目未签名，本来就有「更多信息→仍要运行」摩擦；携带 Chromium 不加重 SmartScreen 问题，但 135MB→~300MB 会影响下载转化与 CDN 成本——这是 A 方案的真实代价（体积本身，不是 SmartScreen）。

---

## 6. 结论矩阵

| 组合 | 可行性 | 关键依据 | 备注 |
|---|---|---|---|
| **NSIS + NM** | ✅ **推荐主线** | HKCU 无需管理员；`customInstall`/`customUnInstall` 挂载点已核实【代码】；项目已有 installer.nsh 先例；相对 path 实测可用 | 最小改动见 §8 |
| portable + NM | ⚠ 可行但高成本 | portable 解压目录临时且退出即删【代码·portable.nsi】；host 必须落地 `%LOCALAPPDATA%` 稳定路径 + 启动自愈重写注册表 | 建议标实验性或延后 |
| Chromium 携带：A extraResources | ✅ 稳 | 体积 +140~170MB（估，参照官方 zip 149~170MB） | 离线/开箱即用场景才值得 |
| Chromium 携带：B 首启下载 | ✅ **推荐默认** | 修复现存「安装版无浏览器」问题代价最小；需镜像 fallback（npmmirror 缺包实证） | 首启需网络 |
| Chromium 携带：C channel:chrome/msedge | ✅ 推荐作为降级 | 与 NM 二期用户画像重合（必有真实浏览器） | 版本不可控 |

---

## 7. 风险清单

1. **扩展分发是最大瓶颈**：Chrome stable 禁 `--load-extension`【实验】；unpacked 每次启动弹「停用开发者模式扩展」【知识·未核验】→ 真实用户分发必须走 Chrome Web Store（$5/审核/unlisted 可选）【知识·未核验】，或初期只支持 Edge（免费商店 + 实测友好）【实验】。
2. Chrome/Edge 政策持续收紧（137 禁 --load-extension 是前兆），NM/开发者模式未来可能进一步受限——立项时把「上架商店」列为正式工作项而非可选。
3. NM 消息 host→Chrome 上限 64MB【知识·未核验】，大 DOM/截图分片传输。
4. MV3 SW 空闲终止：需确认目标最低 Chrome 版本 ≥116（NM keep-alive）【知识·未核验】，否则长会话要靠扩展侧心跳保活。
5. NM host 多实例并发【实验】→ 主进程必须做连接收敛与互斥（尤其与现有 browser-manager 单例模型交互时）。
6. Electron 主 exe 当 host 有单实例锁冲突坑（§4.3），实现 bridge 分支时务必在 `requestSingleInstanceLock` 之前分流。
7. Brave/其他 Chromium 分支的注册表键未验证；Edge fallback 依赖其官方搜索顺序（152 实证 OK，低风险）。
8. npmmirror 个别 revision 缺 win64 包【实验】，首启下载需 fallback 官方 CDN + 明确的失败态 UI。
9. 现状安装版受控浏览器已处「依赖本机缓存」状态（§3），二期之前任何用户拿到安装包都可能踩到——建议独立于二期先修。
10. 未签名安装包的 SmartScreen 摩擦依旧存在（与体积无关），携带 Chromium 放大的是下载体积/转化成本而非拦截率。

---

## 8. 对二期立项的建议

**结论：NM 路线在当前 NSIS 打包方式下走得通，建议立项。** 前提是把「扩展如何到达用户浏览器」当作一等公民问题（商店上架流程提前启动，审核周期不可控）。

**走通的最小改动（估 3 个改动点 + 1 个前置修复）**：

1. **注册（NSIS）**：`build/installer.nsh` 增 `customInstall` 宏写 HKCU 两键（Google\Chrome、Microsoft\Edge，值为 `$INSTDIR\resources\nm-host\com.dogear.nmhost.json`）；`customUnInstall` 增 `DeleteRegKey`。manifest 由构建脚本程序化生成（`path` 相对路径、`allowed_origins` 写死内置 key 的扩展 ID）。
2. **NM host 桥（主进程）**：主入口最前加 `--nm-host-bridge` 分流（跳过单实例锁 → stdio↔本地 socket 转发）；主进程常驻侧起单 listener 收敛多连接。MVP 不新增 exe。
3. **扩展仓库**：manifest 内置 `key` 固定 ID（算法 §1.2，实验已验证）+ `permissions: ["nativeMessaging"]`；SW 内 connectNative + 重连逻辑（确认 Chrome ≥116 或加心跳）。
4. **前置修复（独立于二期）**：受控浏览器首启下载（方案 B：`PLAYWRIGHT_BROWSERS_PATH` + 镜像 fallback）或 `channel` 降级，消除「安装版无浏览器」现状问题。

**验证方式建议**：二期动工前无需再勘查，§2 实验脚本（临时目录 + HKCU）可直接复用为冒烟测试；上架 Chrome Web Store 的时间成本请提前评估。
