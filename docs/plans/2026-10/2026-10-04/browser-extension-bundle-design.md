# 浏览器扩展随应用打包 + 设置页安装引导 设计

**背景**：扩展源码在项目 `extension/` 目录，但 `electron-builder.yml` 的 extraResources 未打包它——生产安装包里只有 NM host（`resources/nm-host/`），扩展本体不在安装目录，普通用户装完应用后无法完成扩展通道安装。设置页也只有连接状态行，无安装指引。

**目标**：扩展随应用分发到 resources 目录；设置页在未连接时展示安装引导卡（路径 + 复制 + 打开目录 + 三步指引），Windows / macOS 生产环境与 dev 环境路径全部自适应。

**架构**：

- 打包：`electron-builder.yml` extraResources 加 `extension/ → extension/`（与 `nm-host/` 并排，filter `**/*`，目录内全为源码文件无排除项）
- 路径定位：仿 `nm-host-register.ts` 的 `nmHostSourceDir()` 模式——
  - prod：`join(process.resourcesPath, 'extension')`（win `…\Programs\Dogear\resources\extension`，mac `/Applications/Dogear.app/Contents/Resources/extension`）
  - dev：`join(app.getAppPath(), 'extension')`（项目根源码目录，开发者直接加载）
- 打开目录：复用现有 IPC `client.openFileInFolder`（`tipc/file.ts`，`shell.openPath`），不新增动作
- 排除的选项：
  - 释放到 userData（模仿 darwin nm-host.sh 渲染）——引入版本同步问题，resources 直读天然随应用版本走
  - Chrome Web Store 分发——固定 ID 的 NM 扩展 + 国内访问不便

**模块边界**：

- `electron-builder.yml` — extraResources 条目
- `electron/main/tipc/browser.ts` — 新增 `getExtensionDirPath` IPC：返回 `{ path: string | null }`，prod/dev 自适应；目录不存在（existsSync 校验失败）返回 null，前端显示「未找到扩展目录」而非幽灵路径
- `app/settings/ExtensionStatusLine.tsx` — 未连接分支改造为安装引导卡：
  - 三步指引：① 打开 `chrome://extensions`（Edge 为 `edge://extensions`）→ ② 开启「开发者模式」→ ③ 点「加载已解压的扩展程序」选择下方目录
  - 路径行：等宽字体展示 + 复制按钮（`navigator.clipboard` + toast）+「打开扩展目录」按钮（`client.openFileInFolder`）
  - 辅助提示：应用更新后需重启浏览器加载新版扩展；macOS 需先点本区块下方「注册到浏览器」（NM host 注册），Windows 走 NSIS 安装器无需此步
  - 已连接分支维持现状
- `docs/codebase-map/browser.md` — 同步打包与设置页描述

**数据流**：设置页挂载 → `getExtensionDirPath` → tipc → 路径函数（isPackaged 分支 + existsSync）→ 渲染层展示；用户点「打开扩展目录」→ `openFileInFolder` → `shell.openPath` 打开资源管理器/Finder（mac 直接开到 .app 包内目录）。

**错误处理 / 边界情况**：

- 扩展目录缺失（打包遗漏/安装损坏）：IPC 返回 null，前端显示占位文案「未找到扩展目录，请重新安装应用」
- Windows NSIS 用户自改安装路径：路径运行时动态计算，不受影响
- macOS 路径深（.app 包内）：靠「打开扩展目录」按钮解决，不要求用户手动翻包内容
- 应用自动更新后扩展文件被替换：Chrome 需重启才加载新版，引导卡固定提示一句
- dev 环境：`getAppPath()` 指向项目根，加载的就是源码目录，改扩展代码即时可重新加载

**未决问题**：无。
