---
step: 5
title: NSIS 注册表 + extraResources + 打包验证
status: pending
---

## 目标

安装版全链路：装包自动写 HKCU 两键（Chrome/Edge），扩展连接走安装版 exe；卸载清键；dev 注册共存语义正确。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-status-ui-e2e.md] dev 端到端已验收通过；`resources/nm-host/`（bat + 构建生成的 manifest）布局就位
- 当前关键文件状态：`build/installer.nsh` 已用 customInit/customUnInstall 宏（customInstall/customUnInstall 挂载点已核实存在，勘查 §3）；`electron-builder.yml` 已有 extraResources 多项先例；打包 per-user NSIS、未签名
- 关键决策回顾：manifest path 相对（用户改安装目录自愈）；HKCU 两键 = `Google\Chrome` + `Microsoft\Edge` 下的 `NativeMessagingHosts\com.dogear.nmhost`；dev 与安装版同键名后写者胜

## 计划改动

- [ ] `build/installer.nsh`：`customInstall` 宏 `WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.dogear.nmhost" "" "$INSTDIR\resources\nm-host\com.dogear.nmhost.json"` + Edge 同款两键；`customUnInstall` 宏 `DeleteRegKey` 清两键
- [ ] `electron-builder.yml`：extraResources 加 `resources/nm-host/` → 安装版 `resources/nm-host/`
- [ ] 构建接线：`bun run dist` 前自动跑 `scripts/build-nm-manifest.mjs`（或并入现有构建脚本链，看现有 build 脚本结构选最小接入点）
- [ ] 验证（本机安装实测）：
  - 先 `node scripts/register-nm-dev.mjs --unregister` 清 dev 键
  - `bun run dist` → 安装 → `reg query` 两键值 = `$INSTDIR\resources\nm-host\com.dogear.nmhost.json`
  - Edge 扩展点「连接此标签页」→ 走安装版 exe → 设置页状态行 ✅
  - 卸载 → 键清除；残留时确认无安全影响（allowed_origins 锁死）
- [ ] 回归：`bun run lint` / `bun run build:electron` / 管线 20/20

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
