# 浏览器三期 P0（NM 扩展最小闭环）设计

**日期**：2026-09-05
**上游**：../2026-09-04/browser-phase3-kickoff.md（三期总纲 + 路线图拍板）、../2026-09-04/browser-nm-packaging-survey.md（勘查报告，结论全带实验标注）
**分期定位**：P0 地基——打通 Edge/Chrome 扩展 ↔ Dogear 主进程的 NM 链路，最小闭环 = 连接即读取当前标签页快照 + 设置页状态行可视化

## 背景

浏览器三期走「扩展 + Native Messaging」路线：agent 需要操作用户真实登录态的主浏览器（小红书等社交场景），而 playwright/patchright 无法附加到用户已运行的浏览器。NM 是浏览器官方唯一合法通道。P0 先把这条管道变成看得见、可验证的地基。

## 目标

1. 用户在 Edge/Chrome 开发者模式加载 `extension/`，点扩展 popup「连接此标签页」
2. Dogear 主进程收到连接 + 当前标签页快照（title / url / 正文前 500 字）
3. 设置页「受控浏览器」小节状态行如实显示连接状态与标签页信息
4. 断连（SW 30s 空闲被杀）后状态行回「未连接」
5. 安装版（NSIS）自动写 HKCU 注册表两键，扩展连接走安装版 exe

## 架构（链路全景）

```
用户点扩展 popup「连接此标签页」（activeTab 授权语义）
→ SW 调 chrome.runtime.connectNative('com.dogear.nmhost')
→ 浏览器查 HKCU\...\NativeMessagingHosts\com.dogear.nmhost → manifest → 启动 nm-host.bat
→ bat: "%~dp0..\..\Dogear.exe" --nm-host-bridge（stdio 继承，相对路径自愈）
→ bridge 进程（跳过单实例锁、无窗口）stdio(长度前缀 JSON) ↔ named pipe 转发
→ 主进程 browser-gateway（pipe server）回 welcome
→ SW 收 welcome 后向当前 tab 动态注入抽取函数（chrome.scripting.executeScript）
→ tab_snapshot 回传 → gateway 更新状态并广播
→ 设置页状态行：✅ 已连接 · 当前标签页：×××
```

**排除的选项**：
- 独立轻量 host exe（Go/Rust）——MVP 零额外分发优先，打磨期再评估（kickoff 已拍板）
- 自动重连（alarms 保活）——P1；P0 断了就断，点 popup 重连
- 完整域名授权模型 / 多会话——P1；P0 用 activeTab 天然单标签页授权 + 单会话语义（最新活跃连接）
- 扩展 TS 构建链——P0 <300 行原生 JS，零构建，lint/tsc 工程排除 `extension/`
- token 握手——无共享秘密传递通道，纯装饰；named pipe 本机同用户 ACL 已够

## 模块边界

| 模块 | 位置 | 说明 |
|---|---|---|
| 扩展仓库 | `extension/`（仓库根，与 electron/ 平级） | manifest.json（内置 key 固定 ID）/ popup.html+js（连接按钮+状态）/ background SW（connectNative + 长度前缀编解码 + 注入抽取）/ content 抽取函数（title/url/innerText 前 500 字）；原生 JS 零构建 |
| NM host 布局 | `resources/nm-host/` | `com.dogear.nmhost.json`（构建期程序化生成，防手拼 `\n` 转义坑——勘查实测踩过）+ `nm-host.bat`（相对路径调主 exe） |
| bridge 分流 | `electron/main/index.ts` 入口最前 | 检测 `--nm-host-bridge` → 在 `requestSingleInstanceLock` **之前**分流；禁硬件加速、不建窗口、不初始化任何服务；stdio ↔ `\\.\pipe\dogear-nm-gateway` 双向转发；stdin EOF 即退出 |
| gateway 服务 | `electron/main/services/browser/browser-gateway.ts`（新建） | app ready 起 pipe server；单会话状态机 `未连接 \| 已连接 { extensionVersion, tabId, title, url, textPreview, connectedAt }`；断连清理并广播；tipc 查询接口 + 状态变更推送（对齐 browser action stream 推送模式） |
| 设置页 | `app/settings/page.tsx` 「受控浏览器」小节 | 加一行「浏览器扩展：未连接 / ✅ 已连接 · 当前标签页：×××」，纯展示 |
| NSIS | `build/installer.nsh` + `electron-builder.yml` | customInstall 写 HKCU 两键（Google\Chrome + Microsoft\Edge，值 = `$INSTDIR\resources\nm-host\com.dogear.nmhost.json`）；customUnInstall DeleteRegKey；extraResources 加 nm-host/ |
| dev 注册 | `scripts/register-nm-dev.mjs` | dev 无安装器：手动写 HKCU 指向仓库内 dev bat（调 electron.exe --nm-host-bridge），勘查实验脚本改造复用；提供 `--unregister` |

## 协议（P0 消息集，NM payload）

```ts
// 扩展 → gateway                                  // gateway → 扩展
{ type: 'hello', extensionVersion: string, tabId: number }
{ type: 'tab_snapshot', tabId: number, title: string, url: string, textPreview: string }
                                                    { type: 'welcome', appVersion: string }
                                                    { type: 'goodbye' }
```

- 编码：4 字节 LE uint32 长度前缀 + UTF-8 JSON（勘查实验验证）
- P0 单会话：新 hello 到来时旧连接视为过期，gateway 只保留最新活跃连接
- 单条上限 64MB（Chrome 105+），tab_snapshot 远小于此，P0 无分片

## 数据流（状态行）

gateway 状态变更 → tipc 事件推送 → 设置页（挂载时查询一次 + 订阅变更）→ 状态行渲染。断连路径：SW 被杀 → NM 端口断 → bridge stdin EOF → bridge 退出 + pipe 断 → gateway 检测断连 → 广播「未连接」。

## 错误处理 / 边界情况

- **浏览器未起 Dogear 时点连接**：bat 拉起的主 exe 走 bridge 分支不建窗口——pipe server 不存在，bridge 连接失败 → 直接退出（stdio 语义关闭），popup 显示「Dogear 未运行」。可选优化（P0 做）：bridge 连 pipe 失败重试 3s 内，覆盖「Dogear 正在启动」窗口期
- **多浏览器同时连**（Edge+Chrome 都装扩展）：每次 connectNative 独立 host 进程并发（勘查实验证实），gateway 单会话语义——最新 hello 胜出，旧连接发 goodbye 后关闭
- **扩展重载/更新**（开发者模式 reload）：NM 断 → 同断连路径
- **bat/exe 路径漂移**（用户改安装目录）：manifest path 相对路径 + bat 内相对路径，天然自愈（勘查证实）
- **正文抽取跨域受限页**（chrome:// 等）：executeScript 报错 → SW 回 `{ type:'tab_snapshot', title, url, textPreview: '' , extractError }`（P0 协议加可选 `extractError?: string`），状态行仍显示已连接
- **dev 与安装版共存**：HKCU 指向同一 host 名，后写者胜——dev 注册脚本与安装器写同一键，注册脚本覆盖即切 dev，`--unregister` 后回落安装版

## 验收清单

1. dev：`bun run dev` + `node scripts/register-nm-dev.mjs` → Edge 加载 `extension/` → 点「连接此标签页」→ 设置页状态行 ✅ + 标题/URL/正文预览；等 30s SW 死 → 状态行回「未连接」
2. dev 反向：Dogear 未运行时点连接 → popup 显示「Dogear 未运行」
3. dist：`bun run dist` 装包 → 注册表两键就位 → 扩展连接走安装版 exe 全链路通；卸载 → 键清除
4. `bun run lint` / `bun run build:electron` / 管线回归 20/20 不破
5. bridge 分流不破坏正常启动（无 flag 时零行为变化）

## 未决问题（实施时补）

- popup「连接此标签页」是否同时显示 textPreview（当前倾向：只显示 title/url，正文预览只进设置页与日志）
- named pipe 缓冲区大小与背压策略（P0 流量极小，默认即可，遇到再说）
- Electron 主 exe 当 host 的冷启动耗时实测（预期 0.5~2s，若超预期在 P0 回填中记录，打磨期换独立桥 exe 的依据）
