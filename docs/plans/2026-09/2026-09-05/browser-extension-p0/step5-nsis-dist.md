---
step: 5
title: NSIS 注册表 + extraResources + 打包验证
status: done
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
  1. 验证方式与计划完全不同：计划要求「本机安装实测 + 卸载验证」，但无人值守任务会话本身运行在用户安装版 Dogear 里——子会话执行「taskkill 安装版」时把宿主（任务系统）杀了（两次，第二次还因 electron-builder 静默安装忽略 /D= 参数、按卸载表旧路径原位更新了用户安装，卸载验证又删了用户卸载表条目，用户手动重装 0.1.100 恢复）。最终由主会话与用户协作收尾，安装/卸载行为在真机上被「事故式」验证
  2. dev 注册与安装版共存验证未显式做（dev 键已 --unregister，后写者胜语义与 step1 脚本验证一致）
- 改动文件清单：
  - `build/installer.nsh`（customInstall 写 HKCU Chrome/Edge 两键指向 `$INSTDIR\resources\nm-host\com.dogear.nmhost.json`；customUnInstall 内嵌 DeleteRegKey 清两键）
  - `electron-builder.yml`（extraResources 加 `resources/nm-host/` → 安装版 `resources/nm-host/`）
  - `package.json`（dist 链：`bun run build && node scripts/build-nm-manifest.mjs && electron-builder`，打包前自动重新生成 NM manifest 防过期）

### 验证结果（真机）
- `bun run dist` 构建成功：`release/Dogear Setup 0.1.100.exe`（含 nm-host 三件套）
- 安装写键：用户机器实装 0.1.100 后 reg query 实查，Chrome/Edge 两键默认值均 = `C:\Users\Dreama\AppData\Local\Programs\Dogear\resources\nm-host\com.dogear.nmhost.json`，安装目录三件套（bat/worker/manifest）齐全 ✅
- 卸载清键：子会话卸载事件中两键被清（事后重装已重新写入，其他 NM host 键 com.microsoft.browsercore/com.quark.hostclient 全程未受影响）✅
- 回归：lint 0 errors / build:electron 0 错误 / 管线 20/20 PASS ✅
- 无 flag 零行为变化：安装版正常启动主窗口（用户日常使用中）✅

### 事故记录（供后续计划线吸取，已存记忆）
- 无人值守任务会话的宿主 = 用户正在用的安装版应用：子会话 taskkill 应用名 = 自杀。后续涉及安装/卸载/杀进程的 step 必须显式禁止按进程名杀宿主，或要求用户提供专属验证环境
- electron-builder NSIS 静默安装（/S）会优先按卸载表旧路径安装，/D= 可能被忽略：想隔离安装验证用独立机器/VM，不要指望 /D

### 人工遗留验收项
1. 安装版扩展连接全链路：Edge `edge://extensions` 开发者模式加载 `C:\dogear\extension` → 任开一页 → 点「连接此标签页」→ 设置页「受控浏览器」状态行 ✅（条件已齐备：安装版 0.1.100 + NM 两键就位）
2. SW 空闲自然死亡断连观察（NM 连接保活下 SW 可能不死，杀 worker 路径已验）
3. 正常快照（有用户手势）与跨域受限页真机点连（step4 遗留，与本项 1 一起 2 分钟过完）
