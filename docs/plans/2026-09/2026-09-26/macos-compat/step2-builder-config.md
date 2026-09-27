---
step: 2
title: 打包配置与资源
status: done
---

## 目标
`bun run dist` 在 mac 上产出可用的 dmg+zip（arm64、正确图标、不含 Windows 冗余资源）；Windows 打包产物不变。

## 依赖上下文（接力棒输入）
- 审计依据：`20260926-build-frontend-audit.md` B2/B3/B4、`20260926-main-process-audit.md` ❌-5
- 前置 step 产出：step1 的托盘 png 资源路径约定（`build/icon-tray.png`）

## 计划改动
- [ ] 生成 `build/icon.icns`：从现有 logo 源图（≥512px png，没有则从 icon.ico 提取最大帧）用 `iconutil`/`iconset` 生成；同时产出托盘 png（16/32/64 + template 版）放 `build/`
- [ ] `electron-builder.yml` 新增 mac 段：
  ```yaml
  mac:
    target: [{ target: dmg, arch: arm64 }, { target: zip, arch: arm64 }]
    icon: build/icon.icns
    identity: null
    category: public.app-category.productivity
  ```
- [ ] extraResources 平台过滤：`build/installers/`（Windows Git 离线包）与 `icon.ico` 加 mac 构建排除（用 electron-builder 的 per-platform extraResources 或 filter）；托盘 png **加入** extraResources；zip target 保留（更新通道用，Step 5 依赖）
- [ ] 验证：Windows 上 `bun run dist` 产物 diff（体积/内容不变）；mac 段无法在 Windows 完整验证，留给 Step 6 真机
- [ ] `scripts/kill-processes.mjs` 补 darwin 分支（`pkill -f` 按 Dogear 路径匹配），避免 mac 打包时文件占用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - icns 源图：项目内无 ≥512px png（build/ 仅 icon.ico），从 icon.ico 提取内嵌 256x256 PNG 帧作源，512 档为双线性上采样（满足 electron-builder ≥512 校验）；1024（ic10）不上采样不入 icns。本机无 iconutil，icns 用纯 Node 脚本手工构造容器（详见 scripts/generate-mac-icons.mjs）
  - extraResources 平台过滤：electron-builder 顶层与平台段 extraResources 是并集（源码 fileMatcher.js addPatterns concat 确认），无「mac 排除顶层条目」语法 → 改为把 Windows 专属条目（build/installers/、icon.ico）移入 win.extraResources，效果等同（审计 B4 备选方案）；托盘 png 放 mac.extraResources 而非顶层，保证 Windows 包不多文件
  - 托盘 png 仅产 32x32 单文件（16pt@2x，Step 1 代码只加载 icon-tray.png 一个文件名）
  - 新增 devDependency pngjs@^5.0.0（刻意用 v5 而非 v7：与 qrcode 传递依赖 pngjs@5 共享实例，v7 会改变 hoist 结构导致 asar 内容变化，Windows 产物就变了）
- 改动文件清单：
  - scripts/generate-mac-icons.mjs（新增：ico 提帧 → 双线性缩放 → icns 构造 + 托盘剪影图）
  - build/icon.icns、build/icon-tray.png（新增生成物，入库，mac 构建无需重新生成）
  - electron-builder.yml（顶层 extraResources 削减 + win.extraResources 新增 + mac 段新增）
  - scripts/kill-processes.mjs（darwin 分支：pgrep -f 按 ROOT 与 Dogear.app 路径匹配 → SIGKILL → sleep 1）
  - package.json + bun.lock（devDependencies 增 pngjs@^5.0.0，无解析条目变化）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - mac 段产物：release/Dogear-0.1.152-arm64.dmg + release/Dogear-0.1.152-arm64-mac.zip；resourcesPath 根新增 icon-tray.png（darwin 托盘 template image，RGB 全 0 + 源 alpha）
  - 图标再生成：`node scripts/generate-mac-icons.mjs`（源=build/icon.ico 内嵌 256 帧；换 logo 后重跑）
  - kill-processes：darwin 匹配模式 = 项目根路径 | `Dogear\.app/Contents/MacOS`（ERE）
- 下个 step 该从哪里继续：Step 3（按 plan.md 顺序）或 Step 6 真机验证：dmg 安装后图标/托盘/红绿灯三件套 + `bun run kill` 在 mac 的行为
- 待办或已知限制：
  - 512 图标为 256 上采样，Retina 大图标场景清晰度受限；若拿到 ≥1024 原版 logo，重跑生成脚本即可整体替换
  - mac 段 identity: null（ad-hoc 签名），非构建机分发会被 Gatekeeper 拦「已损坏」；zip target 已预留（Step 5 自动更新通道）
  - darwin 分支 kill-processes 未真机验证（本机 Windows）；Windows 回归已做 A/B 逐字节对比（asar/resources/unpacked 全一致），NSIS exe 全量 hash 有 688B 差异为安装器非确定性时间戳（133MB 的 0.0005%），内容级已证等价
