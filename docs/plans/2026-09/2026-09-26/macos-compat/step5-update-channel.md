---
step: 5
title: 更新机制 mac 分支
status: done
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
  1. **热更 zip 内嵌版本标记**（计划未提，新增）：`.hotfix-version` 文件由 release.mjs 写入热更 zip，app:// darwin 分支仅在其等于当前 app 版本时才加载 hotfix-out。原因：热更产物随 userData 持久化，「热更 153 → 全量替换 .app 到 154」后旧热更产物会与新主进程错配（app:// 优先级会加载旧前端），必须校验
  2. **manifest 顶层扁平字段固定镜像 win32**：旧客户端只读顶层，故顶层始终是 win 数据（旧客户端读新 manifest 等价读旧 manifest）；mac 发布不更新顶层 version，新客户端按 `platforms[process.platform]` 取；darwin 无平台段时 checkForUpdates 直接返回无更新（拦截「拿到 exe/dmg 之外的错平台产物」）
  3. **manifest 选取/版本比较抽为纯模块 `update-manifest.ts`**（零 electron 依赖）：供 Windows dry-run 直接 import dist 产物验证，update-service re-export 保持外部引用不变
  4. **mac 全量 full.url 指向 dmg**（zip 也收集进 update-server 但当前无消费方，留作未来通道）；dmg 缺失 throw，zip/latest-mac.yml 可选（latest-mac.yml 本就不生成，Step 2 已知）；热更 zip 命名 darwin 为 `update-<ver>-mac.zip` 避免与 win 热更 zip 同名互覆
  5. **resources/out 空产物兑底无需改动**：顶层 extraResources `out/` 为跨平台条目（Step 2 确认并集机制），mac 包内 Resources/out 天然携带完整产物；发布流程先 build:renderer 后 out/ 恒非空，无占位文件需求
- 改动文件清单：
  - `electron/main/services/update-manifest.ts`（新增）：ReleaseInfo/ManifestInfo/CheckResult 类型 + compareVersions + pickPlatformRelease
  - `electron/main/services/update-service.ts`：类型/比较函数迁移并 re-export；checkForUpdates 平台选取（darwin 无平台段 → hasUpdate:false）；downloadFullUpdate darwin 按 URL 扩展名落盘；runInstaller darwin 分支（zip→解压 tmp→open Finder / dmg→open 挂载，随后 app.quit）
  - `electron/main/tipc/updater.ts`：applyHotfix targetDir darwin → `join(userData, 'hotfix-out')`
  - `electron/main/main-app.ts`：app:// darwin 先查 hotfix-out（`.hotfix-version` 与 app.getVersion() 一致且文件存在才命中）→ fallback resourcesPath/out；win32 路径逐字符等价
  - `scripts/release.mjs`：manifest 平台化写回（读旧合并，旧扁平自动迁移为 platforms.win32，顶层镜像 win32）；热更 zip 按平台命名 + 内嵌版本标记；全量路径按 process.platform 分支收集（darwin: dmg 必须 + zip/latest-mac.yml 可选）
  - `scripts/serve-updates.mjs`：MIME 表增 `.dmg → application/x-apple-diskimage`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 新 manifest：`{ version, pubDate, platforms: { win32: ReleaseInfo, darwin: ReleaseInfo } }` + 顶层扁平镜像（type/hotfix/full = win32 的）；`ReleaseInfo = { version, type, pubDate, hotfix?, full? }`
  - `pickPlatformRelease(manifest, platform=process.platform)`：平台段优先 → win32 fallback 顶层 → darwin 无平台段返回 null
  - 热更 zip 根 = out/ 内容 + `.hotfix-version`；客户端 darwin 热更目录 = `<userData>/hotfix-out`，app:// 逐文件 fallback（粒度到单文件，半套产物也能兑底）
  - darwin 全量产物：`Dogear-<ver>-arm64.dmg`（full.url 指向）+ `Dogear-<ver>-arm64-mac.zip`；热更 zip：`update-<ver>-mac.zip`
- 下个 step 该从哪里继续：
  - Step 6 真机验证清单（本 step 部分）：① darwin 热更全链（检查更新→下载应用→reload 后前端来自 hotfix-out，`~/Library/Application Support/Dogear/hotfix-out/` 存在且含 .hotfix-version）② 全量更新链（检查→下载→dmg 挂载弹出→手动替换后 app 正常启动且不加载旧 hotfix-out）③ app:// fallback（无热更时页面正常加载自 Resources/out）④ release.mjs 在 mac 构建机跑通热更/全量两条路径，manifest 双平台字段正确
  - 注意：mac 热更后 targetDir 首次不存在，applyHotfix 的 rename-catch 分支已覆盖；userData 与 /tmp 跨卷时走 cp fallback（Windows 上已实测 EXDEV 场景）
- 待办或已知限制：
  - darwin 全链未真机验证（Windows 侧已验：编译/lint 零错、pickPlatformRelease 10 场景 dry-run、applyHotfix 3 场景真实验证、manifest 合并 5 场景、dev 冒烟、win 路径 diff 逐字符等价核对）
  - win 热更 zip 现在多一个 `.hotfix-version` 文件（解压进 resources/out 根），无功能影响；旧 win 客户端解压后同安
  - darwin 热更产物与「用户手动替换旧 .app」的版本校验只防错配不清理：不匹配的 hotfix-out 目录会残留（加载时被跳过），后续可在启动时顺手清理
  - full.sha256 在 darwin 未被客户端校验（与 win 现状一致，非本步引入）
