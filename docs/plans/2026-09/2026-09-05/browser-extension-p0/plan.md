# 浏览器三期 P0（NM 扩展最小闭环）实施计划

**目标**：打通 Edge/Chrome 扩展 ↔ Dogear 主进程的 NM 链路——点扩展 popup「连接此标签页」，主进程收到标签页快照，设置页状态行可视化；安装版自动写注册表。

**架构思路**：扩展（原生 JS 零构建）经 NM 连接 → 浏览器按 HKCU 拉起 `nm-host.bat` → 调主 exe `--nm-host-bridge` 分流进程（stdio ↔ named pipe 转发）→ 主进程 browser-gateway 单会话收敛 → tipc 推送设置页状态行。设计全文见 [../browser-extension-p0-design.md](../browser-extension-p0-design.md)。排除：独立 host exe（打磨期）、自动重连（P1）、域名授权模型（P1）、token 握手（无传递通道，纯装饰）。

**涉及模块**：`extension/`（新建仓库目录）、`resources/nm-host/`、`scripts/register-nm-dev.mjs`、`electron/main/index.ts`（入口分流）、`electron/main/services/browser/browser-gateway.ts`（新建）、tipc 路由、`app/settings/page.tsx`、`build/installer.nsh`、`electron-builder.yml`。

## 步骤索引

- [x] [Step 1: 扩展仓库骨架 + NM host 布局 + dev 注册脚本](./step1-extension-skeleton.md) — extension/ 四件套 + key 固定 ID + 帧协议模块 + register-nm-dev
- [x] [Step 2: bridge 分流 + named pipe 转发](./step2-bridge-pipe.md) — 主入口最前分流，stdio ↔ pipe 双向转发，stdin EOF 退出（实施修正：NM host 改 ELECTRON_RUN_AS_NODE worker 形态）
- [x] [Step 3: browser-gateway 服务 + tipc 状态接口](./step3-gateway-tipc.md) — pipe server + 单会话状态机 + 查询/推送
- [x] [Step 4: 设置页状态行 + dev 端到端验收](./step4-status-ui-e2e.md) — 状态行 UI + 全链路 dev 验收 + 回归（headful CDP 自动化 5 用例全绿，4 项人工遗留见 step4 回填）
- [x] [Step 5: NSIS 注册表 + extraResources + 打包验证](./step5-nsis-dist.md) — 安装版两键写入/清除 + dist 全链路验证（无人值守安装验证两次自杀事故，最终真机验证完成，事故记录见回填）

## 全局决策

- **不写注释**；UI 文案中文；工具/服务错误返回值语义化，不抛异常
- **协议帧**：4 字节 LE uint32 长度前缀 + UTF-8 JSON；帧编解码在 `extension/src/nm-protocol.js`（纯 JS，node 可直接 import 测试）与主进程 TS 各有一份对应实现（环境不同不共享文件，语义必须一致）
- **固定标识**：NM host 名 `com.dogear.nmhost`；pipe `\\.\pipe\dogear-nm-gateway`（主进程 server / bridge client）；分流 flag `--nm-host-bridge`
- **P0 单会话**：最新 hello 胜出，旧连接发 goodbye 后关闭；多浏览器并发不处理
- **分流纪律**：入口检测必须在 `requestSingleInstanceLock` 之前；无 flag 时主进程零行为变化
- **`extension/` 不进** tsc / eslint 工程（独立交付物，原生 JS）
- **runner/验证脚本一律 `node`** 执行（playwright/Bun 兼容纪律沿用）；主进程改动后 `bun run build:electron`
- **浏览器侧验证一律 headful 手动**（NM/扩展无 headless 等价路径），脚本辅助断言注册表与帧协议
- **红线沿用**：不绕风控；扩展只读当前授权标签页（activeTab），无后台常驻采集

## 完成总结（2026-09-05）

P0 最小闭环全部落地：Edge/Chrome 扩展（`extension/`，ID jpabfficjncbbbkkdgjkhkmpmgehbfaa）经 NM → `nm-host.bat`（ELECTRON_RUN_AS_NODE worker 形态，`nm-bridge-worker.cjs`）→ named pipe → 主进程 browser-gateway（单会话状态机）→ tipc 查询/推送 → 设置页「受控浏览器」状态行。安装版（NSIS）自动写/清 HKCU Chrome+Edge 两键，extraResources 携带 nm-host 三件套，dist 链自动生成 NM manifest。

关键架构修正（step2 实测）：Electron app 模式 Windows stdout 固有 `\r\n` 污染破坏 NM 帧协议 → NM host 改 `ELECTRON_RUN_AS_NODE=1` + electron.exe 跑纯 Node worker（asar 外 `resources/nm-host/`）；`--nm-host-bridge` app 分流保留为防御路径（index.ts 拆 main-app.ts）。

验收状态：dev 链路 headful Edge CDP 自动化 5 用例全绿（step4）；安装版注册表/打包真机验证完成（step5，含两次无人值守事故——子会话误杀宿主与静默安装原位更新，详见 step5 回填）；管线回归 20/20。人工遗留：真机点连扩展（2 分钟）、SW 自然死亡观察。

后续（P1）：自动重连（alarms 保活）、域名授权模型、多会话、独立轻量 host exe 评估。
