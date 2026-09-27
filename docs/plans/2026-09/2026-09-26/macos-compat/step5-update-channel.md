---
step: 5
title: 更新机制 mac 分支
status: pending
---

## 目标
mac 上热更新不破坏 app bundle 签名；全量更新有 mac 通道；发布脚本支持双平台。Windows 更新链路不变。

## 依赖上下文（接力棒输入）
- 审计依据：`20260926-main-process-audit.md` ❌-3/❌-4；`20260926-build-frontend-audit.md` B8/B9/B10/C2
- 前置 step 产出：step2 的 zip target 已配置

## 计划改动
- [ ] **热更 userData 化（darwin）**：`electron/main/tipc/updater.ts:49` applyHotfix 目标 darwin 改为 `join(userData, 'hotfix-out')`；`electron/main/main-app.ts:162-170` app:// 协议读取路径加优先级：darwin 先查 userData/hotfix-out → fallback resourcesPath/out。win32 完全不变。打包时 mac zip 里 resources/out 放空产物兜底（构建脚本）
- [ ] **全量更新**：`electron/main/services/update-service.ts:147-161` darwin 分支——下载 zip → 解压到临时目录 → 提示用户替换（v1 用 `open` 打开 dmg/解压目录引导手动替换，不做自动 .app 替换：权限+签名复杂度不值）；`checkForUpdates`（:39-58）按平台取 manifest 字段
- [ ] **manifest 平台维度**：`update-server/manifest.json` 结构加 `platforms: { win32: {...}, darwin: {...} }`（保持对旧字段向后兼容读取，服务端同步改）；发布侧 `scripts/release.mjs:129-156` 按当前构建平台收集产物（exe/blockmap/latest.yml vs dmg,zip/latest-mac.yml），找不到对应产物才 throw
- [ ] `scripts/serve-updates.mjs:9-18` MIME 表加 `.dmg → application/x-apple-diskimage`、`.zip`
- [ ] Windows 回归：一次完整 dry-run（checkForUpdates 读 manifest 兼容旧结构 + hotfix 应用流程）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
