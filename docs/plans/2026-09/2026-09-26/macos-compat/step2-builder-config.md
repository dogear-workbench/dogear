---
step: 2
title: 打包配置与资源
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
